import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { castVote, castVoteWithNext, nextMatchup } from "@/lib/services/voting";
import { resolveVoter, signCookieValue, verifyCookieValue } from "@/lib/voter";
import { createTestDb } from "./helpers/db";

let db: Db;
let tid: string;
let roundId: string;
let m: string[];

async function voter(c: string, fp: string = c) {
  const [v] = await db.query<{ id: string }>(
    `insert into voters (cookie_id, fingerprint_hash) values ($1, $2) returning id`,
    [c, fp],
  );
  return v.id;
}

beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.query<{ id: string }>(
    `insert into tournaments (slug, name, category, status) values ('p', 'P', 'pizza', 'bracket') returning id`,
  );
  tid = t.id;
  const ents: string[] = [];
  for (let i = 0; i < 6; i++) {
    const [e] = await db.query<{ id: string }>(
      `insert into entrants (tournament_id, ig_handle, display_name, status, seed) values ($1, $2, $3, 'approved', $4) returning id`,
      [tid, `e${i}`, `E${i}`, i + 1],
    );
    ents.push(e.id);
  }
  const [r] = await db.query<{ id: string }>(
    `insert into rounds (tournament_id, number, name, opens_at, closes_at, status)
     values ($1, 1, 'Sweet 16', now() - interval '1 hour', now() + interval '1 day', 'open') returning id`,
    [tid],
  );
  roundId = r.id;
  m = [];
  for (let s = 0; s < 3; s++) {
    const [x] = await db.query<{ id: string }>(
      `insert into matchups (round_id, slot, entrant_a_id, entrant_b_id, opens_at, closes_at, status)
       values ($1, $2, $3, $4, now() - interval '1 hour', now() + interval '1 day', 'open') returning id`,
      [roundId, s, ents[s * 2], ents[s * 2 + 1]],
    );
    m.push(x.id);
  }
});

describe("castVote", () => {
  it("counts a vote and refuses a repeat without double counting", async () => {
    const v = await voter("c1");
    const a = await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" });
    expect(a).toEqual({ kind: "ok", votesA: 1, votesB: 0 });
    const b = await castVote({ matchupId: m[0], choice: "b", voterId: v, ipHash: "ip" });
    expect(b).toEqual({ kind: "already", votesA: 1, votesB: 0 });
  });

  it("concurrent identical votes count once", async () => {
    const v = await voter("c2");
    const args = { matchupId: m[0], choice: "a" as const, voterId: v, ipHash: "ip" };
    const res = await Promise.all([castVote(args), castVote(args)]);
    expect(res.filter((r) => r.kind === "ok")).toHaveLength(1);
    expect(res.filter((r) => r.kind === "already")).toHaveLength(1);
    const [row] = await db.query<{ votes_a: number }>(`select votes_a from matchups where id = $1`, [m[0]]);
    expect(row.votes_a).toBe(1);
    const [c] = await db.query<{ n: number }>(`select count(*)::int as n from votes where matchup_id = $1`, [m[0]]);
    expect(c.n).toBe(1);
  });

  it("refuses votes on a closed matchup", async () => {
    const v = await voter("c3");
    await db.query(`update matchups set status = 'closed' where id = $1`, [m[0]]);
    expect(await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" })).toEqual({ kind: "closed" });
    const [row] = await db.query<{ votes_a: number }>(`select votes_a from matchups where id = $1`, [m[0]]);
    expect(row.votes_a).toBe(0);
  });

  it("refuses votes on a scheduled matchup, even one whose window has started", async () => {
    const v = await voter("c3b");
    await db.query(`update matchups set status = 'scheduled' where id = $1`, [m[0]]);
    expect(await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" })).toEqual({ kind: "closed" });
    await db.query(`update matchups set opens_at = now() + interval '1 day', closes_at = now() + interval '2 days' where id = $1`, [m[0]]);
    expect(await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" })).toEqual({ kind: "closed" });
    const [c] = await db.query<{ n: number }>(`select count(*)::int as n from votes where matchup_id = $1`, [m[0]]);
    expect(c.n).toBe(0);
  });

  it("refuses votes past the matchup's own closes_at even if still marked open", async () => {
    const v = await voter("c4");
    await db.query(`update matchups set closes_at = now() - interval '1 minute' where id = $1`, [m[0]]);
    expect(await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" })).toEqual({ kind: "closed" });
    // The round window does not matter; the matchup's does.
    await db.query(`update rounds set closes_at = now() - interval '1 day' where id = $1`, [roundId]);
    expect((await castVote({ matchupId: m[1], choice: "a", voterId: v, ipHash: "ip" })).kind).toBe("ok");
  });

  it("returns not_found for an unknown matchup", async () => {
    const v = await voter("c5");
    const r = await castVote({
      matchupId: "00000000-0000-0000-0000-000000000000",
      choice: "a",
      voterId: v,
      ipHash: "ip",
    });
    expect(r.kind).toBe("not_found");
  });

  it("caps votes from the same network and same device fingerprint at 5 per matchup", async () => {
    for (let i = 0; i < 5; i++) {
      const v = await voter(`dev${i}`, "same-phone");
      expect((await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "wifi" })).kind).toBe("ok");
    }
    const v = await voter("dev-over", "same-phone");
    expect((await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "wifi" })).kind).toBe("rate_limited");
    // A different phone on the same wifi still votes, and so does the same model on another network.
    const other = await voter("dev-other", "other-phone");
    expect((await castVote({ matchupId: m[0], choice: "a", voterId: other, ipHash: "wifi" })).kind).toBe("ok");
    const away = await voter("dev-away", "same-phone");
    expect((await castVote({ matchupId: m[0], choice: "a", voterId: away, ipHash: "lte" })).kind).toBe("ok");
  });

  it("rate limits votes per matchup per ip hash at 30", async () => {
    for (let i = 0; i < 30; i++) {
      const v = await voter(`rl${i}`);
      expect((await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "same" })).kind).toBe("ok");
    }
    const v = await voter("rl-over");
    expect(await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "same" })).toEqual({
      kind: "rate_limited",
    });
    // Different ip still fine, other matchup still fine.
    expect((await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "other" })).kind).toBe("ok");
    const v2 = await voter("rl-other");
    expect((await castVote({ matchupId: m[1], choice: "b", voterId: v2, ipHash: "same" })).kind).toBe("ok");
  });
});

describe("nextMatchup", () => {
  it("never returns a voted matchup and reports remaining", async () => {
    const v = await voter("n1");
    const seen = new Set<string>();
    let r = await nextMatchup("p", v);
    expect(r.kind === "ok" && r.remaining).toBe(3);
    for (let expected = 3; expected > 0; expected--) {
      r = await nextMatchup("p", v);
      if (r.kind !== "ok" || !r.matchup) throw new Error("expected matchup");
      expect(r.remaining).toBe(expected);
      expect(seen.has(r.matchup.id)).toBe(false);
      expect(r.matchup.roundName).toBe("Sweet 16");
      expect(r.matchup.a.seed).not.toBeNull();
      seen.add(r.matchup.id);
      await castVote({ matchupId: r.matchup.id, choice: "a", voterId: v, ipHash: "ip" });
    }
    expect(await nextMatchup("p", v)).toEqual({ kind: "ok", matchup: null, remaining: 0, nextOpensAt: null });
  });

  it("skips matchups without both entrants and unknown slugs are not_found", async () => {
    const v = await voter("n2");
    await db.query(`update matchups set entrant_b_id = null where id = $1`, [m[0]]);
    const r = await nextMatchup("p", v);
    expect(r.kind === "ok" && r.remaining).toBe(2);
    expect((await nextMatchup("nope", v)).kind).toBe("not_found");
  });
});

describe("nextMatchup with a staggered schedule", () => {
  it("returns only open matchups, uses the matchup's own closesAt, and reports nextOpensAt", async () => {
    const v = await voter("s1");
    const [t] = await db.query<{ id: string }>(`select id from tournaments where slug = 'p'`);
    const ents = await db.query<{ id: string }>(`select id from entrants where tournament_id = $1 order by seed`, [t.id]);
    const soon = new Date(Date.now() + 6 * 3600_000);
    const later = new Date(Date.now() + 30 * 3600_000);
    // m[0] open, m[1] scheduled for later, m[2] closed.
    await db.query(`update matchups set status = 'scheduled', opens_at = $2::timestamptz, closes_at = $3::timestamptz where id = $1`, [
      m[1], later.toISOString(), new Date(later.getTime() + 86400_000).toISOString(),
    ]);
    await db.query(`update matchups set status = 'closed' where id = $1`, [m[2]]);
    // An extra scheduled matchup that opens sooner, and one with a missing entrant.
    await db.query(
      `insert into matchups (round_id, slot, entrant_a_id, entrant_b_id, opens_at, closes_at, status)
       values ($1, 3, $2, $3, $4::timestamptz, $5::timestamptz, 'scheduled')`,
      [roundId, ents[0].id, null, soon.toISOString(), new Date(soon.getTime() + 86400_000).toISOString()],
    );
    const own = new Date(Date.now() + 3 * 3600_000);
    await db.query(`update matchups set closes_at = $2::timestamptz where id = $1`, [m[0], own.toISOString()]);

    const r = await nextMatchup("p", v);
    if (r.kind !== "ok" || !r.matchup) throw new Error("expected matchup");
    expect(r.remaining).toBe(1);
    expect(r.matchup.id).toBe(m[0]);
    expect(r.matchup.closesAt).toBe(own.toISOString());
    expect(r.nextOpensAt).toBe(soon.toISOString());

    await castVote({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" });
    const done = await nextMatchup("p", v);
    expect(done).toEqual({ kind: "ok", matchup: null, remaining: 0, nextOpensAt: soon.toISOString() });
  });

  it("does not return an open matchup past its closes_at", async () => {
    const v = await voter("s2");
    await db.query(`update matchups set closes_at = now() - interval '1 minute' where id = $1`, [m[0]]);
    const r = await nextMatchup("p", v);
    expect(r.kind === "ok" && r.remaining).toBe(2);
    expect(r.kind === "ok" && r.matchup?.id).not.toBe(m[0]);
  });
});

describe("voter cookie", () => {
  const req = (headers: Record<string, string> = {}) => new Request("http://x/api", { headers });

  it("round trips a signed cookie and tampering is rejected", async () => {
    const signed = signCookieValue("abc");
    expect(verifyCookieValue(signed)).toBe("abc");
    expect(verifyCookieValue(signed.replace("abc", "abd"))).toBeNull();
    expect(verifyCookieValue(signed.slice(0, -2) + "xx")).toBeNull();
    expect(verifyCookieValue("abc")).toBeNull();
    expect(verifyCookieValue("abc.")).toBeNull();
    expect(verifyCookieValue(null)).toBeNull();
  });

  it("issues a cookie to new voters and recognizes it afterwards", async () => {
    const first = await resolveVoter(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }));
    expect(first.setCookie).toMatch(/^v=.+; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax/);
    const cookie = first.setCookie!.split(";")[0];
    const again = await resolveVoter(req({ cookie, "x-forwarded-for": "1.2.3.4" }));
    expect(again.voterId).toBe(first.voterId);
    expect(again.ipHash).toBe(first.ipHash);
    expect(again.setCookie).toBeUndefined();
  });

  it("a tampered cookie yields a new voter", async () => {
    const first = await resolveVoter(req());
    const cookie = first.setCookie!.split(";")[0];
    const bad = await resolveVoter(req({ cookie: cookie.slice(0, -3) + "AAA" }));
    expect(bad.voterId).not.toBe(first.voterId);
    expect(bad.setCookie).toBeDefined();
  });

  it("never merges two cookieless visitors on a shared fingerprint", async () => {
    const first = await resolveVoter(req({ "x-fp": "fp-1" }));
    const second = await resolveVoter(req({ "x-fp": "fp-1" }));
    expect(second.voterId).not.toBe(first.voterId);
    expect(second.setCookie).toBeDefined();
  });

  it("does not reuse a voter when the fingerprint matches more than one", async () => {
    await db.query(`insert into voters (cookie_id, fingerprint_hash) values ('d1','h'), ('d2','h')`);
    const r = await resolveVoter(req({ "x-fp": "whatever" }));
    expect(r.setCookie).toBeDefined();
  });
});

describe("castVoteWithNext", () => {
  it("returns the next matchup computed after the vote, also for a repeat", async () => {
    const v = await voter("w1");
    const first = await castVoteWithNext({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" });
    if (first.kind !== "ok") throw new Error("expected ok");
    expect(first.next.remaining).toBe(2);
    expect(first.next.matchup && first.next.matchup.id).not.toBe(m[0]);
    const again = await castVoteWithNext({ matchupId: m[0], choice: "b", voterId: v, ipHash: "ip" });
    if (again.kind !== "already") throw new Error("expected already");
    expect(again.votesA).toBe(1);
    expect(again.next.remaining).toBe(2);
  });

  it("passes through closed and not_found without a next payload", async () => {
    const v = await voter("w2");
    await db.query(`update matchups set status = 'closed' where id = $1`, [m[0]]);
    expect(await castVoteWithNext({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" })).toEqual({ kind: "closed" });
    expect(
      await castVoteWithNext({
        matchupId: "00000000-0000-0000-0000-000000000000",
        choice: "a",
        voterId: v,
        ipHash: "ip",
      }),
    ).toEqual({ kind: "not_found" });
  });

  it("is empty after the last matchup is voted", async () => {
    const v = await voter("w3");
    await castVoteWithNext({ matchupId: m[0], choice: "a", voterId: v, ipHash: "ip" });
    await castVoteWithNext({ matchupId: m[1], choice: "a", voterId: v, ipHash: "ip" });
    const last = await castVoteWithNext({ matchupId: m[2], choice: "a", voterId: v, ipHash: "ip" });
    if (last.kind !== "ok") throw new Error("expected ok");
    expect(last.next).toEqual({ matchup: null, remaining: 0, nextOpensAt: null });
  });
});
