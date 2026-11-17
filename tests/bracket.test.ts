import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { createTestDb } from "./helpers/db";
import { castVote } from "@/lib/services/voting";
import { buildSchedule } from "@/lib/services/schedule";
import {
  advanceDueRounds,
  getBracket,
  getTournamentState,
  lockSeedingAndStart,
  roundName,
  seedPositions,
  selectFieldSize,
} from "@/lib/services/bracket";

let db: Db;
// Noon Eastern in January, so day boundaries are exact multiples of 24 hours.
const T0 = new Date("2030-01-01T17:00:00Z");
const day = (d: number, base = T0) => new Date(base.getTime() + d * 86400000);

beforeEach(async () => {
  db = await createTestDb();
});

async function makeTournament(approved: number, opts: { fieldSize?: number; roundDays?: number } = {}) {
  const [t] = await db.query<{ id: string }>(
    `insert into tournaments (slug, name, category, status, field_size, round_days)
     values ('pizza', 'Pizza', 'pizza', 'nominations', $1, $2) returning id`,
    [opts.fieldSize ?? 64, opts.roundDays ?? 3],
  );
  // entrant i has upvote_count (approved - i + 1) so entrant 1 is seed 1; handles are p01, p02, ...
  for (let i = 1; i <= approved; i++) {
    await db.query(
      `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count, first_nominated_at)
       values ($1, $2, $3, 'approved', $4, $5::timestamptz)`,
      [t.id, `p${String(i).padStart(2, "0")}`, `Place ${i}`, approved - i + 1, T0.toISOString()],
    );
  }
  return t.id;
}

async function seedId(tid: string, seed: number) {
  const [e] = await db.query<{ id: string }>(`select id from entrants where tournament_id = $1 and seed = $2`, [tid, seed]);
  return e.id;
}

async function voters(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [v] = await db.query<{ id: string }>(`insert into voters (cookie_id) values ($1) returning id`, [`c${i}-${Math.random()}`]);
    ids.push(v.id);
  }
  return ids;
}

async function vote(matchupId: string, voterId: string, choice: "a" | "b", excluded = false) {
  await db.query(`insert into votes (matchup_id, voter_id, choice, ip_hash, excluded) values ($1,$2,$3,'x',$4)`, [
    matchupId,
    voterId,
    choice,
    excluded,
  ]);
}

async function roundMatchups(tid: string, number: number) {
  return db.query<{
    id: string; slot: number; entrant_a_id: string | null; entrant_b_id: string | null;
    winner_id: string | null; decided_by: string | null; votes_a: number; votes_b: number; region: number | null;
    status: string; opens_at: Date; closes_at: Date;
  }>(
    `select m.* from matchups m join rounds r on r.id = m.round_id where r.tournament_id = $1 and r.number = $2 order by slot`,
    [tid, number],
  );
}

describe("seedPositions", () => {
  for (const n of [16, 32, 64]) {
    it(`is a valid bracket order for ${n}`, () => {
      const p = seedPositions(n);
      expect(p).toHaveLength(n);
      expect(new Set(p).size).toBe(n);
      expect(p[0]).toBe(1);
      // seed 1 meets seed n, seed 2 meets seed n - 1
      expect(p[1]).toBe(n);
      expect(p[p.indexOf(2) ^ 1]).toBe(n - 1);
      for (let i = 0; i < n; i += 2) expect(p[i] + p[i + 1]).toBe(n + 1);
      // seeds 1 to 4 in four different quarters
      const quarters = [1, 2, 3, 4].map((s) => Math.floor((p.indexOf(s) * 4) / n));
      expect(new Set(quarters).size).toBe(4);
      // 1 and 2 can only meet in the final: opposite halves
      expect(Math.floor((p.indexOf(1) * 2) / n)).not.toBe(Math.floor((p.indexOf(2) * 2) / n));
    });
  }
  it("rejects non powers of two", () => {
    expect(() => seedPositions(12)).toThrow();
  });
});

describe("roundName", () => {
  it("names rounds by matchup count", () => {
    expect([32, 16, 8, 4, 2, 1].map(roundName)).toEqual([
      "Round of 64", "Round of 32", "Sweet 16", "Elite 8", "Final Four", "Championship",
    ]);
  });
  it("names rounds created for a 16 field", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const r = await db.query<{ name: string }>(`select name from rounds where tournament_id = $1 order by number`, [tid]);
    expect(r.map((x) => x.name)).toEqual(["Sweet 16", "Elite 8", "Final Four", "Championship"]);
  });
});

describe("field size selection", () => {
  it.each([[70, 64], [64, 64], [40, 32], [20, 16]])("%i approved gives %i", async (approved, expected) => {
    expect(selectFieldSize(approved, 64)).toBe(expected);
    const tid = await makeTournament(approved);
    const res = await lockSeedingAndStart(tid, T0);
    expect(res.fieldSize).toBe(expected);
    const [{ c }] = await db.query<{ c: number | string }>(`select count(*) c from entrants where tournament_id = $1 and seed is not null`, [tid]);
    expect(Number(c)).toBe(expected);
  });

  it("throws with 10 approved and leaves the tournament in nominations", async () => {
    const tid = await makeTournament(10);
    await expect(lockSeedingAndStart(tid, T0)).rejects.toThrow(/16/);
    const [t] = await db.query<{ status: string }>(`select status from tournaments where id = $1`, [tid]);
    expect(t.status).toBe("nominations");
    const rounds = await db.query(`select 1 from rounds where tournament_id = $1`, [tid]);
    expect(rounds).toHaveLength(0);
  });

  it("respects a smaller configured field size", () => {
    expect(selectFieldSize(70, 32)).toBe(32);
  });

  it("excludes pending, rejected and withdrawn entrants", async () => {
    const tid = await makeTournament(16);
    for (const [i, status] of [["x1", "pending"], ["x2", "rejected"], ["x3", "withdrawn"]]) {
      await db.query(
        `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count) values ($1,$2,$2,$3,9999)`,
        [tid, i, status],
      );
    }
    const res = await lockSeedingAndStart(tid, T0);
    expect(res.fieldSize).toBe(16);
    const seeded = await db.query<{ ig_handle: string }>(`select ig_handle from entrants where tournament_id = $1 and seed is not null`, [tid]);
    expect(seeded).toHaveLength(16);
    expect(seeded.some((s) => s.ig_handle.startsWith("x"))).toBe(false);
  });

  it("does not count non approved entrants toward the minimum", async () => {
    const tid = await makeTournament(15);
    await db.query(`insert into entrants (tournament_id, ig_handle, display_name, status) values ($1,'pend','p','pending')`, [tid]);
    await expect(lockSeedingAndStart(tid, T0)).rejects.toThrow();
  });

  it("breaks upvote ties by earlier nomination", async () => {
    const [t] = await db.query<{ id: string }>(
      `insert into tournaments (slug, name, category, status) values ('tie','Tie','pizza','nominations') returning id`,
    );
    for (let i = 1; i <= 16; i++) {
      // all tied on upvotes; handle i nominated i minutes after T0, inserted in reverse order
      const h = 17 - i;
      await db.query(
        `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count, first_nominated_at)
         values ($1, $2, $2, 'approved', 5, $3::timestamptz)`,
        [t.id, `h${String(h).padStart(2, "0")}`, new Date(T0.getTime() + h * 60000).toISOString()],
      );
    }
    await lockSeedingAndStart(t.id, T0);
    const seeded = await db.query<{ ig_handle: string; seed: number }>(
      `select ig_handle, seed from entrants where tournament_id = $1 order by seed`, [t.id],
    );
    expect(seeded.map((s) => s.ig_handle)).toEqual(Array.from({ length: 16 }, (_, i) => `h${String(i + 1).padStart(2, "0")}`));
  });
});

describe("lockSeedingAndStart", () => {
  it("creates all rounds and matchups with windows, regions and statuses", async () => {
    const tid = await makeTournament(64);
    const res = await lockSeedingAndStart(tid, T0);
    expect(res.startsAt).toBe(T0.toISOString());
    const [t] = await db.query<{ status: string; bracket_starts_at: Date }>(
      `select status, bracket_starts_at from tournaments where id = $1`, [tid],
    );
    expect(t.status).toBe("bracket");
    expect(new Date(t.bracket_starts_at).getTime()).toBe(T0.getTime());

    const rounds = await db.query<{ number: number; status: string; opens_at: Date; closes_at: Date }>(
      `select number, status, opens_at, closes_at from rounds where tournament_id = $1 order by number`, [tid],
    );
    expect(rounds).toHaveLength(6);
    // Only the first round has anything open; the rest are scheduled.
    expect(rounds.map((r) => r.status)).toEqual(["open", "scheduled", "scheduled", "scheduled", "scheduled", "scheduled"]);
    // Round fields mirror their matchups: earliest open, latest close.
    const opens = [0, 4, 6, 8, 9, 12];
    const closes = [4, 6, 8, 9, 11, 14];
    rounds.forEach((r, i) => {
      expect(new Date(r.opens_at).getTime()).toBe(day(opens[i]).getTime());
      expect(new Date(r.closes_at).getTime()).toBe(day(closes[i]).getTime());
    });

    const m1 = await roundMatchups(tid, 1);
    expect(m1).toHaveLength(32);
    expect(m1.every((m) => m.entrant_a_id && m.entrant_b_id)).toBe(true);
    expect(new Set(m1.map((m) => m.region))).toEqual(new Set([1, 2, 3, 4]));
    expect(m1[0].region).toBe(1);
    expect(m1[31].region).toBe(4);
    // Day 0 matchups (region 1) are open straight away, the rest wait.
    expect(m1.filter((m) => m.status === "open").map((m) => m.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(m1.filter((m) => m.status === "scheduled")).toHaveLength(24);
    expect(new Date(m1[8].opens_at).getTime()).toBe(day(1).getTime());
    expect(new Date(m1[8].closes_at).getTime()).toBe(day(2).getTime());
    expect((await roundMatchups(tid, 4))[3].region).toBe(4);
    expect((await roundMatchups(tid, 5)).map((m) => m.region)).toEqual([null, null]);
    expect((await roundMatchups(tid, 6))[0].region).toBeNull();
    expect((await roundMatchups(tid, 2)).every((m) => m.status === "scheduled" && !m.entrant_a_id && !m.entrant_b_id)).toBe(true);
    // seed 1 vs seed 64 in slot 0
    expect(m1[0].entrant_a_id).toBe(await seedId(tid, 1));
    expect(m1[0].entrant_b_id).toBe(await seedId(tid, 64));
  });

  it("defaults the start to the next noon Eastern and keeps everything scheduled when it is in the future", async () => {
    const tid = await makeTournament(16);
    const now = new Date("2030-01-01T10:00:00Z"); // 5 AM Eastern
    const res = await lockSeedingAndStart(tid, now);
    expect(res.startsAt).toBe("2030-01-01T17:00:00.000Z");
    const [{ n }] = await db.query<{ n: number | string }>(
      `select count(*) n from matchups m join rounds r on r.id = m.round_id where r.tournament_id = $1 and m.status <> 'scheduled'`, [tid],
    );
    expect(Number(n)).toBe(0);
    const [r1] = await db.query<{ status: string }>(`select status from rounds where tournament_id = $1 and number = 1`, [tid]);
    expect(r1.status).toBe("scheduled");
    await advanceDueRounds(T0);
    expect((await roundMatchups(tid, 1)).filter((m) => m.status === "open")).toHaveLength(4);
  });

  it("honours an explicit startAt", async () => {
    const tid = await makeTournament(32);
    const startAt = day(3);
    await lockSeedingAndStart(tid, T0, startAt);
    const m = await roundMatchups(tid, 1);
    expect(m.filter((x) => x.status === "open")).toHaveLength(0);
    expect(new Date(m[0].opens_at).getTime()).toBe(startAt.getTime());
    await advanceDueRounds(day(3));
    expect((await roundMatchups(tid, 1)).filter((x) => x.status === "open")).toHaveLength(8);
  });

  it("refuses to start twice", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    await expect(lockSeedingAndStart(tid, T0)).rejects.toThrow();
  });
});

describe("advanceDueRounds", () => {
  it("does nothing before a matchup closes or opens", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    expect(await advanceDueRounds(day(0.5))).toEqual([]);
    expect(await advanceDueRounds(new Date(day(1).getTime() - 1))).toEqual([]);
    expect((await roundMatchups(tid, 1)).filter((m) => m.status === "open")).toHaveLength(4);
  });

  it("ties go to the better seed, and excluded votes are not counted", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const [v1, v2, v3] = await voters(3);
    const m = await roundMatchups(tid, 1);
    // slot 0: 1 v 16, tie 1 to 1 -> seed 1
    await vote(m[0].id, v1, "a");
    await vote(m[0].id, v2, "b");
    // slot 1: b wins 1-0 by votes
    await vote(m[1].id, v1, "b");
    // slot 2: two b votes are excluded, so a wins 1-0 even though the cached counter says 99
    await vote(m[2].id, v1, "a");
    await vote(m[2].id, v2, "b", true);
    await vote(m[2].id, v3, "b", true);
    await db.query(`update matchups set votes_b = 99 where id = $1`, [m[2].id]);
    // slot 3: no votes at all -> better seed
    const res = await advanceDueRounds(day(1));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ closedRoundNumber: 1, decided: 4, nextRoundNumber: 2, completed: false });

    const after = await roundMatchups(tid, 1);
    const seedOf = async (id: string | null) =>
      (await db.query<{ seed: number }>(`select seed from entrants where id = $1`, [id]))[0].seed;
    expect(after[0]).toMatchObject({ status: "closed", decided_by: "seed_tiebreak", votes_a: 1, votes_b: 1 });
    expect(await seedOf(after[0].winner_id)).toBe(1);
    expect(after[1]).toMatchObject({ decided_by: "votes", votes_a: 0, votes_b: 1, winner_id: after[1].entrant_b_id });
    expect(after[2]).toMatchObject({ decided_by: "votes", votes_a: 1, votes_b: 0, winner_id: after[2].entrant_a_id });
    expect(after[3]).toMatchObject({ decided_by: "seed_tiebreak", votes_a: 0, votes_b: 0 });

    // winners moved on to the next round; day 1 matchups opened
    const r2 = await roundMatchups(tid, 2);
    expect(r2[0].entrant_a_id).toBe(after[0].winner_id);
    expect(r2[0].entrant_b_id).toBe(after[1].winner_id);
    expect(r2[1].entrant_a_id).toBe(after[2].winner_id);
    expect(r2[1].entrant_b_id).toBe(after[3].winner_id);
    expect(r2.every((x) => x.status === "scheduled")).toBe(true);
    expect(after.slice(4).every((x) => x.status === "open")).toBe(true);
    const [round1] = await db.query<{ status: string }>(`select status from rounds where tournament_id = $1 and number = 1`, [tid]);
    expect(round1.status).toBe("open");
  });

  it("a withdrawn entrant loses even with more votes", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const [v1, v2] = await voters(2);
    const m = await roundMatchups(tid, 1);
    await vote(m[0].id, v1, "a");
    await vote(m[0].id, v2, "a");
    await db.query(`update entrants set status = 'withdrawn' where id = $1`, [m[0].entrant_a_id]);
    await advanceDueRounds(day(1));
    const after = await roundMatchups(tid, 1);
    expect(after[0]).toMatchObject({ winner_id: m[0].entrant_b_id, decided_by: "withdrawal" });
  });

  it("preserves an admin_override winner", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const [v1, v2] = await voters(2);
    const m = await roundMatchups(tid, 1);
    await vote(m[0].id, v1, "a");
    await vote(m[0].id, v2, "a");
    await db.query(`update matchups set winner_id = $1, decided_by = 'admin_override' where id = $2`, [m[0].entrant_b_id, m[0].id]);
    await advanceDueRounds(day(1));
    const after = await roundMatchups(tid, 1);
    expect(after[0]).toMatchObject({ winner_id: m[0].entrant_b_id, decided_by: "admin_override", votes_a: 2 });
    expect((await roundMatchups(tid, 2))[0].entrant_a_id).toBe(m[0].entrant_b_id);
  });

  it("a scheduled matchup whose time has come but lacks an entrant waits for its feeders", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    // Pull Elite 8 slot 0 forward so it is due now, long before its feeders have been decided.
    await db.query(
      `update matchups set opens_at = $2::timestamptz where round_id = (select id from rounds where tournament_id = $1 and number = 2) and slot = 0`,
      [tid, T0.toISOString()],
    );
    await advanceDueRounds(T0);
    let e8 = await roundMatchups(tid, 2);
    expect(e8[0]).toMatchObject({ status: "scheduled", entrant_a_id: null, entrant_b_id: null });
    await advanceDueRounds(day(0.9));
    e8 = await roundMatchups(tid, 2);
    expect(e8[0].status).toBe("scheduled");
    // Feeders (Sweet 16 slots 0 and 1) close at day 1; then it opens right away.
    await advanceDueRounds(day(1));
    e8 = await roundMatchups(tid, 2);
    expect(e8[0].status).toBe("open");
    expect(e8[0].entrant_a_id).not.toBeNull();
    expect(e8[0].entrant_b_id).not.toBeNull();
    expect(e8[1].status).toBe("scheduled");
  });

  it("catches up through several closes and opens in one call", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const res = await advanceDueRounds(day(3));
    expect(res.map((r) => [r.closedRoundNumber, r.decided])).toEqual([[1, 8], [2, 4]]);
    expect((await roundMatchups(tid, 3)).every((m) => m.status === "open")).toBe(true);
    expect((await roundMatchups(tid, 4))[0].status).toBe("scheduled");
  });

  it("two concurrent calls decide each matchup exactly once", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const [v1] = await voters(1);
    const m = await roundMatchups(tid, 1);
    await vote(m[0].id, v1, "b");
    const [a, b] = await Promise.all([advanceDueRounds(day(3)), advanceDueRounds(day(3))]);
    const decided = [...a, ...b].reduce((n, r) => n + r.decided, 0);
    expect(decided).toBe(12); // 8 Sweet 16 + 4 Elite 8, not 24
    const closed = await db.query<{ id: string; decided_by: string | null }>(
      `select m.id, m.decided_by from matchups m join rounds r on r.id = m.round_id where r.tournament_id = $1 and m.status = 'closed'`, [tid],
    );
    expect(closed).toHaveLength(12);
    expect(closed.every((c) => c.decided_by)).toBe(true);
    const audits = await db.query(`select 1 from audit_log where action = 'close_matchups'`);
    expect(audits).toHaveLength(2); // one per round that closed, written once
    const statuses = await db.query<{ number: number; status: string }>(
      `select number, status from rounds where tournament_id = $1 order by number`, [tid],
    );
    expect(statuses.map((r) => r.status)).toEqual(["closed", "closed", "open", "scheduled"]);
  });
});

describe("full tournament", () => {
  it("runs 64 entrants through 15 days one day at a time to a single champion", async () => {
    const tid = await makeTournament(64);
    await lockSeedingAndStart(tid, T0, T0);
    const schedule = buildSchedule(64, T0);
    const [voter] = await voters(1);

    const expectedOpenCounts = [8, 8, 8, 8, 8, 8, 4, 4, 4, 2, 2, 0, 1, 1, 0];
    const key = (r: number, s: number) => `${r}:${s}`;
    const feederClosed = new Map<string, boolean>();
    let upsetSeed64Slot0Winner: string | null = null;

    for (let d = 0; d < 15; d++) {
      const now = day(d);
      if (d > 0) await advanceDueRounds(now);

      // On day 0 one voter upsets the 1 seed on the open slot 0 matchup.
      if (d === 0) {
        const m1 = await roundMatchups(tid, 1);
        expect(m1[0].status).toBe("open");
        const res = await castVote({ matchupId: m1[0].id, choice: "b", voterId: voter, ipHash: "ip", now });
        expect(res.kind).toBe("ok");
        upsetSeed64Slot0Winner = m1[0].entrant_b_id;
      }

      const open = await db.query<{ number: number; slot: number }>(
        `select r.number, m.slot from matchups m join rounds r on r.id = m.round_id
         where r.tournament_id = $1 and m.status = 'open' order by r.number, m.slot`, [tid],
      );
      const expected = schedule
        .filter((x) => x.opensAt.getTime() <= now.getTime() && now.getTime() < x.closesAt.getTime())
        .map((x) => key(x.roundNumber, x.slot))
        .sort();
      expect(open.map((o) => key(o.number, o.slot)).sort(), `open matchups on day ${d}`).toEqual(expected);
      expect(open, `open count on day ${d}`).toHaveLength(expectedOpenCounts[d]);

      // Winners reach later matchups as soon as their feeders close, before those open.
      const all = await db.query<{ number: number; slot: number; status: string; a: string | null; b: string | null }>(
        `select r.number, m.slot, m.status, m.entrant_a_id a, m.entrant_b_id b
         from matchups m join rounds r on r.id = m.round_id where r.tournament_id = $1`, [tid],
      );
      for (const m of all) feederClosed.set(key(m.number, m.slot), m.status === "closed");
      for (const m of all.filter((x) => x.number > 1)) {
        expect(m.a !== null, `round ${m.number} slot ${m.slot} entrant a on day ${d}`).toBe(feederClosed.get(key(m.number - 1, 2 * m.slot)));
        expect(m.b !== null, `round ${m.number} slot ${m.slot} entrant b on day ${d}`).toBe(feederClosed.get(key(m.number - 1, 2 * m.slot + 1)));
        if (m.status !== "scheduled") expect(m.a && m.b).toBeTruthy();
      }
      if (d === 1) {
        // Region 1 of the Round of 64 is done: Round of 32 slot 0 is staffed but not open until day 4.
        const r2 = all.find((x) => x.number === 2 && x.slot === 0)!;
        expect(r2).toMatchObject({ status: "scheduled" });
        expect(r2.a && r2.b).toBeTruthy();
        expect(r2.a).toBe(upsetSeed64Slot0Winner);
        const r2far = all.find((x) => x.number === 2 && x.slot === 8)!;
        expect(r2far.a).toBeNull();
      }
      if (d === 11) {
        const s = await getTournamentState("pizza", now);
        expect(s!.live).toEqual([]);
        expect(s!.currentRound).toMatchObject({ number: 6, name: "Championship" });
        expect(s!.nextOpensAt).toBe(day(12).toISOString());
      }
    }

    const [t] = await db.query<{ status: string }>(`select status from tournaments where id = $1`, [tid]);
    expect(t.status).toBe("complete");
    const closed = await db.query<{ winner_id: string | null }>(
      `select m.winner_id from matchups m join rounds r on r.id = m.round_id where r.tournament_id = $1 and m.status = 'closed'`, [tid],
    );
    expect(closed).toHaveLength(63);
    expect(closed.every((c) => c.winner_id)).toBe(true);
    const rounds = await db.query<{ status: string }>(`select status from rounds where tournament_id = $1`, [tid]);
    expect(rounds.every((r) => r.status === "closed")).toBe(true);

    // The 1 seed lost on day 0, so seed 2 wins every tie it plays and takes the title.
    const state = await getTournamentState("pizza", day(14));
    expect(state!.tournament.status).toBe("complete");
    expect(state!.currentRound).toBeNull();
    expect(state!.champion).toMatchObject({ seed: 2 });
    expect(state!.live).toEqual([]);
    expect(state!.upNext).toEqual([]);
    expect(state!.nextOpensAt).toBeNull();
    expect(state!.latestResults).toHaveLength(1);
    expect(state!.latestResults[0]).toMatchObject({ roundName: "Championship", status: "closed" });
    expect(await advanceDueRounds(day(365))).toEqual([]);

    const bracket = await getBracket("pizza");
    expect(bracket!.rounds).toHaveLength(6);
    expect(bracket!.rounds.every((r) => r.status === "closed")).toBe(true);
    expect(bracket!.rounds[0].matchups[0]).toMatchObject({ votesA: 0, votesB: 1, status: "closed" });
  });
});

describe("read models", () => {
  it("getTournamentState reports live, upNext and latestResults", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const [v1] = await voters(1);

    let s = (await getTournamentState("pizza", T0))!;
    expect(s.live.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    expect(s.live.every((c) => c.status === "open" && c.roundName === "Sweet 16" && c.votesA === 0 && c.votesB === 0)).toBe(true);
    expect(s.live[0].a).toMatchObject({ seed: 1 });
    expect(s.live[0].closesAt).toBe(day(1).toISOString());
    expect(s.upNext.map((c) => c.slot)).toEqual([4, 5, 6, 7]);
    expect(s.upNext.every((c) => c.status === "scheduled" && c.votesA === null && c.votesB === null)).toBe(true);
    expect(s.upNext.every((c) => c.opensAt === day(1).toISOString())).toBe(true);
    expect(s.upNext[0].a).not.toBeNull();
    expect(s.latestResults).toEqual([]);
    expect(s.nextOpensAt).toBe(day(1).toISOString());
    expect(s.currentRound).toMatchObject({ number: 1, name: "Sweet 16" });

    const m = await roundMatchups(tid, 1);
    await castVote({ matchupId: m[1].id, choice: "b", voterId: v1, ipHash: "ip", now: T0 });
    s = (await getTournamentState("pizza", T0))!;
    expect(s.live[1]).toMatchObject({ votesA: 0, votesB: 1, winnerId: null });

    await advanceDueRounds(day(1));
    s = (await getTournamentState("pizza", day(1)))!;
    expect(s.live.map((c) => c.slot)).toEqual([4, 5, 6, 7]);
    // Elite 8 is next; the first two games have both teams, the others wait on live feeders.
    expect(s.upNext.map((c) => c.roundName)).toEqual(Array(4).fill("Elite 8"));
    expect(s.upNext.map((c) => [c.a !== null, c.b !== null])).toEqual([[true, true], [true, true], [false, false], [false, false]]);
    expect(s.nextOpensAt).toBe(day(2).toISOString());
    expect(s.latestResults.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    expect(s.latestResults[1]).toMatchObject({ status: "closed", votesA: 0, votesB: 1, winnerId: m[1].entrant_b_id });
    expect(s.latestResults.every((c) => c.winnerId)).toBe(true);
    expect(s.currentRound).toMatchObject({ number: 1 });

    // Time passes with nothing scheduled in between: still nothing open, next up is the Final Four.
    await advanceDueRounds(day(2));
    await advanceDueRounds(day(3));
    s = (await getTournamentState("pizza", day(3)))!;
    expect(s.live.map((c) => c.roundName)).toEqual(["Final Four", "Final Four"]);
    expect(s.upNext).toHaveLength(1);
    expect(s.upNext[0]).toMatchObject({ roundName: "Championship", a: null, b: null, opensAt: day(6).toISOString() });
    expect(s.latestResults.map((c) => c.roundName)).toEqual(Array(4).fill("Elite 8"));
    expect(s.currentRound).toMatchObject({ number: 3, name: "Final Four" });
  });

  it("getBracket carries status and windows, with votes null only when scheduled", async () => {
    const tid = await makeTournament(16);
    await lockSeedingAndStart(tid, T0);
    const [v1] = await voters(1);
    const m = await roundMatchups(tid, 1);
    await castVote({ matchupId: m[0].id, choice: "a", voterId: v1, ipHash: "ip", now: T0 });
    const b = await getBracket("pizza");
    expect(b!.rounds[0].matchups[0]).toMatchObject({
      status: "open", votesA: 1, votesB: 0, winnerId: null,
      opensAt: T0.toISOString(), closesAt: day(1).toISOString(),
    });
    expect(b!.rounds[0].matchups[4]).toMatchObject({ status: "scheduled", votesA: null, votesB: null, opensAt: day(1).toISOString() });
    expect(b!.rounds[0].status).toBe("open");
    expect(b!.rounds[1].status).toBe("scheduled");
    expect(b!.rounds[1].matchups[0]).toMatchObject({ status: "scheduled", votesA: null, votesB: null, a: null, b: null });
    expect(b!.rounds[0].matchups[0].a).toMatchObject({ seed: 1 });
    await advanceDueRounds(day(1));
    const c = await getBracket("pizza");
    expect(c!.rounds[0].matchups[0]).toMatchObject({ status: "closed", votesA: 1, votesB: 0 });
    expect(c!.rounds[1].matchups[0]).toMatchObject({ status: "scheduled", votesA: null, votesB: null });
    expect(c!.rounds[1].matchups[0].a).not.toBeNull();
    expect(await getBracket("nope")).toBeNull();
    expect(await getTournamentState("nope")).toBeNull();
  });
});

describe("scores cache helpers", () => {
  it("scoresCacheControl clamps between 5 and 600 seconds", async () => {
    const { scoresCacheControl } = await import("@/lib/services/bracket");
    const now = new Date("2030-01-01T00:00:00Z");
    expect(scoresCacheControl(null, now)).toBe("public, s-maxage=600, stale-while-revalidate=30");
    expect(scoresCacheControl(new Date(now.getTime() + 3600_000), now)).toContain("s-maxage=600,");
    expect(scoresCacheControl(new Date(now.getTime() + 90_000), now)).toContain("s-maxage=90,");
    expect(scoresCacheControl(new Date(now.getTime() + 1_000), now)).toContain("s-maxage=5,");
    expect(scoresCacheControl(new Date(now.getTime() - 1_000), now)).toContain("s-maxage=5,");
  });
});
