import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { createTestDb } from "./helpers/db";

const lockSeedingAndStart = vi.fn(async (_id: string, _now: Date, _startAt?: Date) => undefined);
vi.mock("@/lib/services/bracket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/bracket")>()),
  lockSeedingAndStart: (id: string, now: Date, startAt?: Date) => lockSeedingAndStart(id, now, startAt),
}));

import * as admin from "@/lib/services/admin";
import {
  adminPost,
  checkPassword,
  loginBlocked,
  recordLoginFailure,
  requireAdmin,
  resetLoginLimiter,
  signAdminCookie,
  verifyAdminCookie,
} from "@/lib/admin-auth";
import { z } from "zod";

let db: Db;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  lockSeedingAndStart.mockClear();
});

async function mkTournament(status = "nominations"): Promise<string> {
  n++;
  const r = await db.query<{ id: string }>(
    "insert into tournaments (slug, name, category, status) values ($1, 'T', 'pizza', $2) returning id",
    [`t-${n}`, status],
  );
  return r[0].id;
}
async function mkEntrant(tid: string, handle: string, status = "pending", upvotes = 0): Promise<string> {
  const r = await db.query<{ id: string }>(
    "insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count) values ($1, $2, $3, $4, $5) returning id",
    [tid, handle, handle.toUpperCase(), status, upvotes],
  );
  return r[0].id;
}
async function mkVoter(): Promise<string> {
  n++;
  const r = await db.query<{ id: string }>("insert into voters (cookie_id) values ($1) returning id", [`c-${n}`]);
  return r[0].id;
}
async function mkRound(tid: string, number: number, status: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into rounds (tournament_id, number, name, opens_at, closes_at, status)
     values ($1, $2, $3, now() - interval '1 day', now() + interval '2 days', $4) returning id`,
    [tid, number, `R${number}`, status],
  );
  return r[0].id;
}
async function mkMatchup(
  roundId: string,
  slot: number,
  a: string | null,
  b: string | null,
  status: "scheduled" | "open" | "closed" = "open",
  opensAt = "2030-01-01T17:00:00Z",
  closesAt = "2030-01-02T17:00:00Z",
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into matchups (round_id, slot, entrant_a_id, entrant_b_id, status, opens_at, closes_at)
     values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz) returning id`,
    [roundId, slot, a, b, status, opensAt, closesAt],
  );
  return r[0].id;
}
async function auditActions(): Promise<{ action: string; actor: string }[]> {
  return db.query("select action, actor from audit_log order by created_at, id");
}

describe("entrant moderation", () => {
  it("approve, reject, withdraw, rename write audit rows", async () => {
    const t = await mkTournament();
    const e1 = await mkEntrant(t, "one");
    const e2 = await mkEntrant(t, "two");
    await admin.approveEntrant(e1);
    await admin.rejectEntrant(e2);
    await admin.withdrawEntrant(e1);
    await admin.restoreEntrant(e1);
    await admin.renameEntrant(e1, "  Nice Name ");
    const rows = await db.query<{ id: string; status: string; display_name: string }>("select id, status, display_name from entrants");
    expect(rows.find((r) => r.id === e1)).toMatchObject({ status: "approved", display_name: "Nice Name" });
    expect(rows.find((r) => r.id === e2)?.status).toBe("rejected");
    const log = await auditActions();
    expect(log.map((l) => l.action)).toEqual([
      "entrant.approve",
      "entrant.reject",
      "entrant.withdraw",
      "entrant.restore",
      "entrant.rename",
    ]);
    expect(log.every((l) => l.actor === "admin")).toBe(true);
  });

  it("refuses impossible transitions without auditing", async () => {
    const t = await mkTournament();
    const e = await mkEntrant(t, "one", "approved");
    await expect(admin.approveEntrant(e)).rejects.toThrow();
    expect(await auditActions()).toHaveLength(0);
  });

  it("bulk add normalizes handles, skips invalid lines and duplicates, reports them", async () => {
    const t = await mkTournament();
    await mkEntrant(t, "existing", "approved");
    const res = await admin.bulkAddEntrants(
      t,
      [
        "@Pizza.Place, Pizza Place",
        "https://www.instagram.com/Second_Spot/?hl=en, Second Spot",
        "existing, Already Here",
        "pizza.place, Same Again",
        "bad handle!, Nope",
        "nocomma",
        "nameless,",
        "",
      ].join("\n"),
    );
    expect(res.added).toEqual([
      { handle: "pizza.place", name: "Pizza Place" },
      { handle: "second_spot", name: "Second Spot" },
    ]);
    expect(res.skipped.map((s) => s.reason)).toEqual([
      "Duplicate handle",
      "Duplicate handle",
      "Not a valid handle",
      "Needs a handle, a comma, then a name",
      "Name is missing or too long",
    ]);
    const rows = await db.query<{ ig_handle: string; status: string }>(
      "select ig_handle, status from entrants where tournament_id = $1 order by ig_handle",
      [t],
    );
    expect(rows.map((r) => r.ig_handle)).toEqual(["existing", "pizza.place", "second_spot"]);
    expect(rows.filter((r) => r.ig_handle !== "existing").every((r) => r.status === "approved")).toBe(true);
    expect((await auditActions()).map((a) => a.action)).toEqual(["entrant.bulk_add"]);
  });

  it("add entrant creates approved and rejects duplicates", async () => {
    const t = await mkTournament();
    await admin.addEntrant(t, "@Foo", "Foo");
    await expect(admin.addEntrant(t, "foo", "Foo 2")).rejects.toThrow(/already/);
    await expect(admin.addEntrant(t, "not valid!", "X")).rejects.toThrow(/valid/);
  });

  it("startBracket calls lockSeedingAndStart and audits", async () => {
    const t = await mkTournament();
    const now = new Date("2026-01-01T00:00:00Z");
    await admin.startBracket(t, now);
    expect(lockSeedingAndStart).toHaveBeenCalledWith(t, now, undefined);
    expect((await auditActions()).map((a) => a.action)).toEqual(["tournament.start_bracket"]);
    const t2 = await mkTournament();
    const startAt = new Date("2026-01-05T17:00:00Z");
    await admin.startBracket(t2, now, startAt);
    expect(lockSeedingAndStart).toHaveBeenLastCalledWith(t2, now, startAt);
    const draft = await mkTournament("draft");
    await expect(admin.startBracket(draft)).rejects.toThrow();
  });

  it("create and open nominations", async () => {
    const { id } = await admin.createTournament({ name: "N", slug: "n-1", category: "pizza", fieldSize: 16, roundDays: 3 });
    await expect(admin.createTournament({ name: "N", slug: "n-1", category: "pizza", fieldSize: 16, roundDays: 3 })).rejects.toThrow();
    await admin.openNominations(id);
    const t = await admin.getTournament(id);
    expect(t.status).toBe("nominations");
    const list = await admin.listTournaments();
    expect(list[0]).toMatchObject({ approved_count: 0, pending_count: 0, total_votes: 0 });
  });
});

describe("merge", () => {
  it("moves upvotes without double counting", async () => {
    const t = await mkTournament();
    const a = await mkEntrant(t, "a", "approved", 2);
    const b = await mkEntrant(t, "b", "pending", 3);
    const [v1, v2, v3, v4] = [await mkVoter(), await mkVoter(), await mkVoter(), await mkVoter()];
    for (const v of [v1, v2]) await db.query("insert into upvotes (entrant_id, voter_id, ip_hash) values ($1, $2, 'x')", [a, v]);
    for (const v of [v2, v3, v4]) await db.query("insert into upvotes (entrant_id, voter_id, ip_hash) values ($1, $2, 'x')", [b, v]);
    const res = await admin.mergeEntrants(a, b);
    expect(res).toEqual({ moved: 2, upvoteCount: 4 });
    const rows = await db.query<{ id: string; upvote_count: number; status: string }>("select id, upvote_count, status from entrants");
    expect(rows.find((r) => r.id === a)).toMatchObject({ upvote_count: 4 });
    expect(rows.find((r) => r.id === b)).toMatchObject({ upvote_count: 0, status: "rejected" });
    const cnt = await db.query<{ n: number }>("select count(*)::int as n from upvotes where entrant_id = $1", [a]);
    expect(cnt[0].n).toBe(4);
    expect((await auditActions()).map((x) => x.action)).toEqual(["entrant.merge"]);
  });
});

describe("override winner", () => {
  /** Two round 1 matchups feeding a final. `m1Status` is the state of the first one. */
  async function setup(m1Status: "scheduled" | "open" | "closed", finalStatus: "scheduled" | "open" | "closed" = "scheduled") {
    const t = await mkTournament("bracket");
    const [e1, e2, e3, e4] = [
      await mkEntrant(t, "e1", "approved"),
      await mkEntrant(t, "e2", "approved"),
      await mkEntrant(t, "e3", "approved"),
      await mkEntrant(t, "e4", "approved"),
    ];
    const r1 = await mkRound(t, 1, "open");
    const r2 = await mkRound(t, 2, "scheduled");
    const m1 = await mkMatchup(r1, 0, e1, e2, m1Status);
    const m2 = await mkMatchup(r1, 1, e3, e4, "open");
    const final = await mkMatchup(r2, 0, null, null, finalStatus, "2030-01-03T17:00:00Z", "2030-01-05T17:00:00Z");
    return { t, e1, e2, e3, e4, m1, m2, final };
  }
  const row = async (id: string) =>
    (await db.query<{ status: string; winner_id: string | null; decided_by: string | null; entrant_a_id: string | null; entrant_b_id: string | null; closes_at: Date }>(
      "select status, winner_id, decided_by, entrant_a_id, entrant_b_id, closes_at from matchups where id = $1", [id],
    ))[0];

  it("on a closed matchup swaps the winner and updates the next matchup slot", async () => {
    const s = await setup("closed");
    await db.query("update matchups set winner_id = $2, decided_by = 'votes' where id = $1", [s.m1, s.e1]);
    await db.query("update matchups set entrant_a_id = $2 where id = $1", [s.final, s.e1]);
    await admin.overrideWinner(s.m1, s.e2);
    expect(await row(s.m1)).toMatchObject({ winner_id: s.e2, decided_by: "admin_override", status: "closed" });
    expect(await row(s.final)).toMatchObject({ entrant_a_id: s.e2, entrant_b_id: null });
    expect((await auditActions()).map((x) => x.action)).toEqual(["matchup.override"]);
  });

  it("is refused when the next matchup already has votes", async () => {
    const s = await setup("closed");
    await db.query("update matchups set winner_id = $2, decided_by = 'votes' where id = $1", [s.m1, s.e1]);
    await db.query("update matchups set status = 'open', entrant_a_id = $2, entrant_b_id = $3 where id = $1", [s.final, s.e1, s.e3]);
    const v = await mkVoter();
    await db.query("insert into votes (matchup_id, voter_id, choice, ip_hash) values ($1, $2, 'a', 'x')", [s.final, v]);
    await expect(admin.overrideWinner(s.m1, s.e2)).rejects.toThrow(/next matchup/);
    expect((await row(s.m1)).winner_id).toBe(s.e1);
    expect(await auditActions()).toHaveLength(0);
  });

  it("on an open matchup closes it immediately, sets the winner and moves them on", async () => {
    const s = await setup("open");
    const now = new Date("2030-01-01T20:00:00Z");
    await expect(admin.overrideWinner(s.m1, s.e4, now)).rejects.toThrow(); // not in this matchup
    const v = await mkVoter();
    await db.query("insert into votes (matchup_id, voter_id, choice, ip_hash) values ($1, $2, 'b', 'x')", [s.m1, v]);
    await admin.overrideWinner(s.m1, s.e1, now);
    const m = await row(s.m1);
    expect(m).toMatchObject({ status: "closed", winner_id: s.e1, decided_by: "admin_override" });
    expect(new Date(m.closes_at).getTime()).toBe(now.getTime()); // ended early
    expect((await row(s.final)).entrant_a_id).toBe(s.e1);
    // The vote stays recorded, and the counters were written from it.
    const [mu] = await db.query<{ votes_a: number; votes_b: number }>("select votes_a, votes_b from matchups where id = $1", [s.m1]);
    expect(mu).toEqual({ votes_a: 0, votes_b: 1 });
    // The final waits for the other feeder.
    expect((await row(s.final)).status).toBe("scheduled");
    // Later, normal advancement leaves the override alone.
    const { advanceDueRounds } = await import("@/lib/services/bracket");
    await advanceDueRounds(new Date("2030-01-03T00:00:00Z"));
    expect(await row(s.m1)).toMatchObject({ winner_id: s.e1, decided_by: "admin_override" });
    expect(await row(s.m2)).toMatchObject({ status: "closed" });
    expect(await row(s.final)).toMatchObject({ status: "scheduled" });
    const [rd] = await db.query<{ status: string }>("select status from rounds where number = 1");
    expect(rd.status).toBe("closed");
  });

  it("overriding an open matchup opens the next one once both feeders are done and it is due", async () => {
    const s = await setup("open");
    await db.query("update matchups set opens_at = '2030-01-01T17:00:00Z' where id = $1", [s.final]);
    await admin.overrideWinner(s.m1, s.e1, new Date("2030-01-01T20:00:00Z"));
    expect((await row(s.final)).status).toBe("scheduled");
    await admin.overrideWinner(s.m2, s.e4, new Date("2030-01-01T21:00:00Z"));
    expect(await row(s.final)).toMatchObject({ status: "open", entrant_a_id: s.e1, entrant_b_id: s.e4 });
    const [rd] = await db.query<{ status: string }>("select status from rounds where number = 2");
    expect(rd.status).toBe("open");
  });

  it("refuses a matchup that has not opened", async () => {
    const s = await setup("scheduled");
    await expect(admin.overrideWinner(s.m1, s.e1)).rejects.toThrow(/not opened/);
    expect((await row(s.m1)).winner_id).toBeNull();
    expect(await auditActions()).toHaveLength(0);
  });
});

describe("schedule editing", () => {
  const D0 = "2030-01-01T17:00:00Z";
  const D1 = "2030-01-02T17:00:00Z";
  const D2 = "2030-01-03T17:00:00Z";
  async function setup() {
    const t = await mkTournament("bracket");
    const e = [];
    for (let i = 0; i < 4; i++) e.push(await mkEntrant(t, `s${i}`, "approved"));
    const r = await mkRound(t, 1, "open");
    const day0a = await mkMatchup(r, 0, e[0], e[1], "open", D0, D1);
    const day0b = await mkMatchup(r, 1, e[2], e[3], "open", D0, D1);
    const day1a = await mkMatchup(r, 2, e[0], e[1], "scheduled", D1, D2);
    const day1b = await mkMatchup(r, 3, e[2], e[3], "scheduled", D1, D2);
    return { t, day0a, day0b, day1a, day1b };
  }
  const times = async (id: string) =>
    (await db.query<{ opens_at: Date; closes_at: Date }>("select opens_at, closes_at from matchups where id = $1", [id]))[0];

  it("lists matchups grouped by game day with status and window", async () => {
    const s = await setup();
    const days = await admin.listSchedule(s.t);
    expect(days.map((d) => [d.key, d.status, d.matchups.length])).toEqual([
      [new Date(D0).toISOString(), "open", 2],
      [new Date(D1).toISOString(), "scheduled", 2],
    ]);
    expect(days[0].closes_at.getTime()).toBe(new Date(D1).getTime());
    expect(days[0].matchups[0]).toMatchObject({ slot: 0, live_a: 0, live_b: 0, round_name: "R1" });
  });

  it("moves a whole scheduled game day and refreshes the round", async () => {
    const s = await setup();
    const to = { opensAt: new Date("2030-01-04T17:00:00Z"), closesAt: new Date("2030-01-05T17:00:00Z") };
    await admin.moveGameDay({ tournamentId: s.t, groupOpensAt: new Date(D1), ...to });
    for (const id of [s.day1a, s.day1b]) {
      const x = await times(id);
      expect([new Date(x.opens_at).getTime(), new Date(x.closes_at).getTime()]).toEqual([to.opensAt.getTime(), to.closesAt.getTime()]);
    }
    const x = await times(s.day0a);
    expect(new Date(x.opens_at).getTime()).toBe(new Date(D0).getTime());
    const [r] = await db.query<{ opens_at: Date; closes_at: Date }>("select opens_at, closes_at from rounds where tournament_id = $1", [s.t]);
    expect(new Date(r.opens_at).getTime()).toBe(new Date(D0).getTime());
    expect(new Date(r.closes_at).getTime()).toBe(to.closesAt.getTime());
    expect((await auditActions()).map((a) => a.action)).toEqual(["schedule.move_day"]);
  });

  it("refuses to move a game day that has started, or with bad times", async () => {
    const s = await setup();
    const to = { opensAt: new Date("2030-01-04T17:00:00Z"), closesAt: new Date("2030-01-05T17:00:00Z") };
    await expect(admin.moveGameDay({ tournamentId: s.t, groupOpensAt: new Date(D0), ...to })).rejects.toThrow(/already started/);
    await db.query("update matchups set status = 'closed' where id = $1", [s.day1a]);
    await expect(admin.moveGameDay({ tournamentId: s.t, groupOpensAt: new Date(D1), ...to })).rejects.toThrow(/already started/);
    await db.query("update matchups set status = 'scheduled' where id = $1", [s.day1a]);
    await expect(
      admin.moveGameDay({ tournamentId: s.t, groupOpensAt: new Date(D1), opensAt: to.closesAt, closesAt: to.opensAt }),
    ).rejects.toThrow(/after it opens/);
    await expect(
      admin.moveGameDay({ tournamentId: s.t, groupOpensAt: new Date("2031-01-01T00:00:00Z"), ...to }),
    ).rejects.toThrow(/not found/);
    expect(await auditActions()).toHaveLength(0);
  });

  it("changes the close time of an open game day only", async () => {
    const s = await setup();
    const closesAt = new Date("2030-01-02T23:00:00Z");
    await admin.changeGameDayClose({ tournamentId: s.t, groupOpensAt: new Date(D0), closesAt });
    expect(new Date((await times(s.day0a)).closes_at).getTime()).toBe(closesAt.getTime());
    expect(new Date((await times(s.day0b)).closes_at).getTime()).toBe(closesAt.getTime());
    expect(new Date((await times(s.day1a)).closes_at).getTime()).toBe(new Date(D2).getTime());
    await expect(admin.changeGameDayClose({ tournamentId: s.t, groupOpensAt: new Date(D1), closesAt })).rejects.toThrow(/open/);
    await expect(
      admin.changeGameDayClose({ tournamentId: s.t, groupOpensAt: new Date(D0), closesAt: new Date("2030-01-01T10:00:00Z") }),
    ).rejects.toThrow(/after/);
    expect((await auditActions()).map((a) => a.action)).toEqual(["schedule.change_close"]);
  });
});

describe("flagged votes", () => {
  it("exclude group sets excluded only on the targeted votes, restore reverses", async () => {
    const t = await mkTournament("bracket");
    const ea = await mkEntrant(t, "ea", "approved");
    const eb = await mkEntrant(t, "eb", "approved");
    const r = await mkRound(t, 1, "open");
    const m = await mkMatchup(r, 0, ea, eb);
    const other = await mkMatchup(r, 1, ea, eb);
    const hour = "2026-03-01T14:00:00Z";
    const insert = async (matchup: string, ip: string, at: string, choice = "a") => {
      const v = await mkVoter();
      await db.query("insert into votes (matchup_id, voter_id, choice, ip_hash, created_at) values ($1, $2, $3, $4, $5)", [matchup, v, choice, ip, at]);
    };
    for (let i = 0; i < 10; i++) await insert(m, "bad", `2026-03-01T14:${10 + i}:00Z`);
    await insert(m, "bad", "2026-03-01T15:05:00Z"); // same ip, other hour
    await insert(m, "good", "2026-03-01T14:30:00Z", "b"); // other ip
    await insert(other, "bad", "2026-03-01T14:30:00Z"); // other matchup
    await db.query("update matchups set votes_a = 11, votes_b = 1 where id = $1", [m]);

    const flagged = await admin.listFlagged(t);
    expect(flagged.votes).toHaveLength(1);
    expect(flagged.votes[0]).toMatchObject({ total: 10, for_a: 10, for_b: 0, ip_hash: "bad" });

    const res = await admin.setVoteGroupExcluded({ matchupId: m, ipHash: "bad", hour: new Date(hour), excluded: true });
    expect(res.changed).toBe(10);
    const ex = await db.query<{ n: number }>("select count(*)::int as n from votes where excluded");
    expect(ex[0].n).toBe(10);
    const total = await db.query<{ n: number }>("select count(*)::int as n from votes");
    expect(total[0].n).toBe(13); // nothing deleted
    const mu = await db.query<{ votes_a: number; votes_b: number }>("select votes_a, votes_b from matchups where id = $1", [m]);
    expect(mu[0]).toEqual({ votes_a: 1, votes_b: 1 });

    await admin.setVoteGroupExcluded({ matchupId: m, ipHash: "bad", hour: new Date(hour), excluded: false });
    const ex2 = await db.query<{ n: number }>("select count(*)::int as n from votes where excluded");
    expect(ex2[0].n).toBe(0);
    expect((await auditActions()).map((a) => a.action)).toEqual(["votes.exclude", "votes.restore"]);
  });

  it("only looks at matchups that are open, and only lets open ones be changed", async () => {
    const t = await mkTournament("bracket");
    const ea = await mkEntrant(t, "fa", "approved");
    const eb = await mkEntrant(t, "fb", "approved");
    const r = await mkRound(t, 1, "open");
    const closed = await mkMatchup(r, 0, ea, eb, "closed");
    const open = await mkMatchup(r, 1, ea, eb, "open");
    for (const m of [closed, open]) {
      for (let i = 0; i < 10; i++) {
        const v = await mkVoter();
        await db.query("insert into votes (matchup_id, voter_id, choice, ip_hash, created_at) values ($1, $2, 'a', 'ip', $3)", [m, v, `2026-03-01T14:${10 + i}:00Z`]);
      }
    }
    const flagged = await admin.listFlagged(t);
    expect(flagged.votes.map((g) => g.matchup_id)).toEqual([open]);
    await expect(
      admin.setVoteGroupExcluded({ matchupId: closed, ipHash: "ip", hour: new Date("2026-03-01T14:00:00Z"), excluded: true }),
    ).rejects.toThrow(/open/);
  });

  it("flags upvote groups of 10 or more per hour during nominations", async () => {
    const t = await mkTournament("nominations");
    const e = await mkEntrant(t, "e", "approved");
    for (let i = 0; i < 10; i++) {
      const v = await mkVoter();
      await db.query("insert into upvotes (entrant_id, voter_id, ip_hash, created_at) values ($1, $2, 'ip', $3)", [e, v, `2026-03-01T14:${10 + i}:00Z`]);
    }
    const f = await admin.listFlagged(t);
    expect(f.upvotes).toHaveLength(1);
    expect(f.upvotes[0].total).toBe(10);
  });
});

describe("admin auth", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { ...env };
  afterEach(() => {
    for (const k of ["COOKIE_SECRET", "ADMIN_PASSWORD", "NODE_ENV"]) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
    resetLoginLimiter();
  });

  it("signs and verifies a cookie", () => {
    env.COOKIE_SECRET = "s3cret";
    const now = new Date("2026-01-01T00:00:00Z");
    const c = signAdminCookie(now)!;
    expect(verifyAdminCookie(c, now)).toBe(true);
    expect(verifyAdminCookie(c, new Date(now.getTime() + 29 * 24 * 3600_000))).toBe(true);
  });

  it("rejects tampered, expired, malformed and wrong secret cookies", () => {
    env.COOKIE_SECRET = "s3cret";
    const now = new Date("2026-01-01T00:00:00Z");
    const c = signAdminCookie(now)!;
    const [exp, sig] = c.split(".");
    expect(verifyAdminCookie(`${Number(exp) + 100000000}.${sig}`, now)).toBe(false);
    expect(verifyAdminCookie(`${exp}.${sig.slice(0, -1)}x`, now)).toBe(false);
    expect(verifyAdminCookie(c, new Date(now.getTime() + 30 * 24 * 3600_000 + 1))).toBe(false);
    expect(verifyAdminCookie("garbage", now)).toBe(false);
    expect(verifyAdminCookie("", now)).toBe(false);
    expect(verifyAdminCookie(undefined, now)).toBe(false);
    env.COOKIE_SECRET = "other";
    expect(verifyAdminCookie(c, now)).toBe(false);
  });

  it("requireAdmin checks the cookie header", () => {
    env.COOKIE_SECRET = "s3cret";
    const good = signAdminCookie()!;
    const ok = new Request("http://x/api/admin/y", { headers: { cookie: `a=b; adm=${good}` } });
    expect(requireAdmin(ok)).toBeNull();
    expect(requireAdmin(new Request("http://x/api/admin/y"))?.status).toBe(401);
    expect(requireAdmin(new Request("http://x/api/admin/y", { headers: { cookie: "adm=nope" } }))?.status).toBe(401);
  });

  it("password check is exact, and missing ADMIN_PASSWORD always fails", () => {
    env.ADMIN_PASSWORD = "hunter2";
    expect(checkPassword("hunter2")).toBe(true);
    expect(checkPassword("hunter3")).toBe(false);
    expect(checkPassword("")).toBe(false);
    delete env.ADMIN_PASSWORD;
    expect(checkPassword("")).toBe(false);
    expect(checkPassword("anything")).toBe(false);
  });

  it("blocks after 10 failures in 15 minutes", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 9; i++) recordLoginFailure("ip", now);
    expect(loginBlocked("ip", now)).toBe(false);
    recordLoginFailure("ip", now);
    expect(loginBlocked("ip", now)).toBe(true);
    expect(loginBlocked("other", now)).toBe(false);
    expect(loginBlocked("ip", new Date(now.getTime() + 15 * 60_000 + 1))).toBe(false);
  });

  it("adminPost requires a cookie and a JSON content type", async () => {
    env.COOKIE_SECRET = "s3cret";
    const handler = adminPost(z.object({ a: z.string() }), async ({ a }) => ({ a }));
    const cookie = `adm=${signAdminCookie()!}`;
    const mk = (headers: Record<string, string>, body = '{"a":"x"}') =>
      new Request("http://x/api/admin/y", { method: "POST", headers, body });
    expect((await handler(mk({ "content-type": "application/json" }))).status).toBe(401);
    expect((await handler(mk({ cookie, "content-type": "text/plain" }))).status).toBe(415);
    expect((await handler(mk({ cookie, "content-type": "application/json" }, "{}"))).status).toBe(400);
    const res = await handler(mk({ cookie, "content-type": "application/json" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: "x" });
  });
});
