import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { getDb } from "@/lib/db";
import { normalizeHandle } from "@/lib/handles";
import { seedDemo } from "@/scripts/seed-demo";
import { createTestDb } from "./helpers/db";

let db: Db;

async function fixtures() {
  const [t] = await db.query<{ id: string }>(
    `insert into tournaments (slug, name, category) values ('t', 'T', 'pizza') returning id`,
  );
  const [e] = await db.query<{ id: string }>(
    `insert into entrants (tournament_id, ig_handle, display_name) values ($1, 'a', 'A') returning id`,
    [t.id],
  );
  const [v] = await db.query<{ id: string }>(`insert into voters (cookie_id) values ('c1') returning id`);
  const [r] = await db.query<{ id: string }>(
    `insert into rounds (tournament_id, number, name, opens_at, closes_at) values ($1, 1, 'R', now(), now()) returning id`,
    [t.id],
  );
  const [m] = await db.query<{ id: string }>(
    `insert into matchups (round_id, slot) values ($1, 0) returning id`,
    [r.id],
  );
  return { t: t.id, e: e.id, v: v.id, m: m.id };
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("database", () => {
  it("applies migrations and getDb returns the test db", async () => {
    const rows = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(
      ["audit_log", "entrants", "matchups", "rounds", "tournaments", "upvotes", "voters", "votes"],
    );
    expect(getDb()).toBe(db);
  });

  it("enables row level security everywhere", async () => {
    const rows = await db.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("rejects a duplicate handle in a tournament", async () => {
    const f = await fixtures();
    await expect(
      db.query(`insert into entrants (tournament_id, ig_handle, display_name) values ($1, 'a', 'Again')`, [f.t]),
    ).rejects.toThrow();
  });

  it("rejects a second vote on a matchup by the same voter", async () => {
    const f = await fixtures();
    const ins = `insert into votes (matchup_id, voter_id, choice, ip_hash) values ($1, $2, 'a', 'ip')`;
    await db.query(ins, [f.m, f.v]);
    await expect(db.query(ins, [f.m, f.v])).rejects.toThrow();
  });

  it("rejects a second upvote by the same voter", async () => {
    const f = await fixtures();
    const ins = `insert into upvotes (entrant_id, voter_id, ip_hash) values ($1, $2, 'ip')`;
    await db.query(ins, [f.e, f.v]);
    await expect(db.query(ins, [f.e, f.v])).rejects.toThrow();
  });

  it("enforces enum checks", async () => {
    await expect(
      db.query(`insert into tournaments (slug, name, category, status) values ('x', 'x', 'x', 'bogus')`),
    ).rejects.toThrow();
  });

  it("tx commits and rolls back on throw, nested tx reuses the transaction", async () => {
    await db.tx(async (t) => {
      await t.tx((t2) => t2.query(`insert into voters (cookie_id) values ('ok')`));
    });
    await expect(
      db.tx(async (t) => {
        await t.query(`insert into voters (cookie_id) values ('gone')`);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await db.query<{ cookie_id: string }>(`select cookie_id from voters`);
    expect(rows.map((r) => r.cookie_id)).toEqual(["ok"]);
  });

  it("seeds the demo tournament", async () => {
    await seedDemo(db);
    const [c] = await db.query<{ n: number }>(`select count(*)::int as n from entrants where status = 'approved'`);
    expect(c.n).toBe(70);
    const [t] = await db.query<{ status: string }>(`select status from tournaments where slug = 'pizza'`);
    expect(t.status).toBe("nominations");
  });
});

describe("normalizeHandle", () => {
  it("handles @, case, whitespace", () => {
    expect(normalizeHandle("@Name")).toBe("name");
    expect(normalizeHandle("  Some.Place_1  ")).toBe("some.place_1");
  });
  it("extracts from instagram urls", () => {
    expect(normalizeHandle("https://www.instagram.com/Pizza_Joint/")).toBe("pizza_joint");
    expect(normalizeHandle("https://instagram.com/pizza_joint?igshid=abc")).toBe("pizza_joint");
    expect(normalizeHandle("instagram.com/pizza_joint/?hl=en")).toBe("pizza_joint");
    expect(normalizeHandle("  https://www.instagram.com/@x.y/  ")).toBe("x.y");
  });
  it("rejects invalid input", () => {
    expect(normalizeHandle("")).toBeNull();
    expect(normalizeHandle("   ")).toBeNull();
    expect(normalizeHandle("@")).toBeNull();
    expect(normalizeHandle("has space")).toBeNull();
    expect(normalizeHandle("bad!char")).toBeNull();
    expect(normalizeHandle("a".repeat(31))).toBeNull();
    expect(normalizeHandle("https://instagram.com/")).toBeNull();
    expect(normalizeHandle("https://example.com/foo")).toBeNull();
  });
});
