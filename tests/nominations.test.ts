import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { listEntrants, nominate, upvote } from "@/lib/services/nominations";
import { createTestDb } from "./helpers/db";

let db: Db;
let tid: string;

async function voter(c: string) {
  const [v] = await db.query<{ id: string }>(`insert into voters (cookie_id, fingerprint_hash) values ($1, $1) returning id`, [c]);
  return v.id;
}
const nom = (voterId: string, handle: string, ipHash = "ip") =>
  nominate({ slug: "p", handle, displayName: "Name", voterId, ipHash });

beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.query<{ id: string }>(
    `insert into tournaments (slug, name, category, status) values ('p', 'P', 'pizza', 'nominations') returning id`,
  );
  tid = t.id;
});

describe("nominate", () => {
  it("creates a pending entrant with one upvote", async () => {
    const v = await voter("a");
    const r = await nom(v, "@Pizza.Joint");
    expect(r.kind).toBe("created_pending");
    const [e] = await db.query<{ ig_handle: string; status: string; upvote_count: number }>(
      `select ig_handle, status, upvote_count from entrants where tournament_id = $1`,
      [tid],
    );
    expect(e).toMatchObject({ ig_handle: "pizza.joint", status: "pending", upvote_count: 1 });
    const [c] = await db.query<{ n: number }>(`select count(*)::int as n from upvotes`);
    expect(c.n).toBe(1);
    // Pending is not public.
    const list = await listEntrants("p", v);
    expect(list.kind === "ok" && list.entrants).toEqual([]);
  });

  it("nominating an existing handle upvotes it, and repeats do not double count", async () => {
    const a = await voter("a");
    const b = await voter("b");
    await nom(a, "joint");
    expect((await nom(b, "https://instagram.com/joint/?hl=en")).kind).toBe("upvoted");
    expect((await nom(b, "joint")).kind).toBe("already_upvoted");
    const [e] = await db.query<{ upvote_count: number }>(`select upvote_count from entrants`);
    expect(e.upvote_count).toBe(2);
  });

  it("returns rejected for rejected or withdrawn handles and changes nothing", async () => {
    const v = await voter("a");
    await db.query(
      `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count) values
       ($1,'bad','Bad','rejected',3), ($1,'gone','Gone','withdrawn',3)`,
      [tid],
    );
    expect((await nom(v, "bad")).kind).toBe("rejected");
    expect((await nom(v, "gone")).kind).toBe("rejected");
    const [c] = await db.query<{ n: number }>(`select count(*)::int as n from upvotes`);
    expect(c.n).toBe(0);
  });

  it("validates handle, phase and tournament", async () => {
    const v = await voter("a");
    expect((await nom(v, "not valid!")).kind).toBe("invalid_handle");
    expect((await nominate({ slug: "zzz", handle: "x", voterId: v, ipHash: "ip" })).kind).toBe("not_found");
    await db.query(`update tournaments set nominations_close_at = now() - interval '1 minute'`);
    expect((await nom(v, "x")).kind).toBe("closed");
    await db.query(`update tournaments set nominations_close_at = null, status = 'bracket'`);
    expect((await nom(v, "x")).kind).toBe("closed");
  });

  it("limits new nominations to 5 per voter per day", async () => {
    const v = await voter("a");
    for (let i = 0; i < 5; i++) expect((await nom(v, `h${i}`)).kind).toBe("created_pending");
    expect((await nom(v, "h5")).kind).toBe("rate_limited");
    // Upvoting an existing handle is not a new nomination.
    const other = await voter("b");
    await nom(other, "h0");
    expect((await nom(v, "h0")).kind).toBe("already_upvoted");
  });

  it("concurrent nominations of one new handle create one entrant and two upvotes", async () => {
    const a = await voter("a");
    const b = await voter("b");
    const res = await Promise.all([nom(a, "race"), nom(b, "race")]);
    expect(res.map((r) => r.kind).sort()).toEqual(["created_pending", "upvoted"]);
    const [e] = await db.query<{ upvote_count: number }>(`select upvote_count from entrants`);
    expect(e.upvote_count).toBe(2);
  });
});

describe("upvote", () => {
  async function approved(handle: string, count = 0) {
    const [e] = await db.query<{ id: string }>(
      `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count)
       values ($1, $2, $2, 'approved', $3) returning id`,
      [tid, handle, count],
    );
    return e.id;
  }

  it("double upvote does not double count, including concurrently", async () => {
    const v = await voter("a");
    const id = await approved("x");
    expect(await upvote({ entrantId: id, voterId: v, ipHash: "ip" })).toEqual({ kind: "ok", upvoteCount: 1 });
    expect(await upvote({ entrantId: id, voterId: v, ipHash: "ip" })).toEqual({ kind: "already", upvoteCount: 1 });
    const w = await voter("b");
    const res = await Promise.all([
      upvote({ entrantId: id, voterId: w, ipHash: "ip" }),
      upvote({ entrantId: id, voterId: w, ipHash: "ip" }),
    ]);
    expect(res.map((r) => r.kind).sort()).toEqual(["already", "ok"]);
    const [e] = await db.query<{ upvote_count: number }>(`select upvote_count from entrants where id = $1`, [id]);
    expect(e.upvote_count).toBe(2);
  });

  it("rate limits 40 upvotes per entrant per ip hash per hour", async () => {
    const id = await approved("x");
    for (let i = 0; i < 40; i++) {
      const v = await voter(`v${i}`);
      expect((await upvote({ entrantId: id, voterId: v, ipHash: "same" })).kind).toBe("ok");
    }
    const v = await voter("over");
    expect((await upvote({ entrantId: id, voterId: v, ipHash: "same" })).kind).toBe("rate_limited");
  });

  it("only approved entrants in an open nominations phase", async () => {
    const v = await voter("a");
    const [p] = await db.query<{ id: string }>(
      `insert into entrants (tournament_id, ig_handle, display_name) values ($1,'pend','Pend') returning id`,
      [tid],
    );
    expect((await upvote({ entrantId: p.id, voterId: v, ipHash: "ip" })).kind).toBe("not_found");
    const id = await approved("x");
    await db.query(`update tournaments set status = 'bracket'`);
    expect((await upvote({ entrantId: id, voterId: v, ipHash: "ip" })).kind).toBe("closed");
  });
});

describe("listEntrants", () => {
  it("sorts by upvotes desc then first_nominated_at asc and flags upvotedByMe", async () => {
    const v = await voter("a");
    await db.query(
      `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count, first_nominated_at) values
       ($1,'low','Low','approved',1, now()), ($1,'old','Old','approved',5, now() - interval '2 days'),
       ($1,'new','New','approved',5, now() - interval '1 day')`,
      [tid],
    );
    const [mine] = await db.query<{ id: string }>(`select id from entrants where ig_handle = 'low'`);
    await upvote({ entrantId: mine.id, voterId: v, ipHash: "ip" });
    const r = await listEntrants("p", v);
    if (r.kind !== "ok") throw new Error("not ok");
    expect(r.entrants.map((e) => e.igHandle)).toEqual(["old", "new", "low"]);
    expect(r.entrants.map((e) => e.upvotedByMe)).toEqual([false, false, true]);
    expect((await listEntrants("nope", v)).kind).toBe("not_found");
  });
});
