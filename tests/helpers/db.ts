import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setDbForTests, type Db } from "@/lib/db";

type Runner = Pick<PGlite, "query">;

function wrap(pg: Runner, inTx: boolean, root: PGlite): Db {
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pg.query<T>(sql, params);
      return res.rows;
    },
    tx<T>(fn: (db: Db) => Promise<T>) {
      if (inTx) return fn(db);
      return root.transaction((t) => fn(wrap(t, true, root)));
    },
  };
  return db;
}

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  const dir = join(process.cwd(), "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await pg.exec(readFileSync(join(dir, f), "utf8"));
  }
  const db = wrap(pg, false, pg);
  setDbForTests(db);
  return db;
}
