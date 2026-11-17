import postgres from "postgres";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

let testDb: Db | null = null;
let prodDb: Db | null = null;

type Runner = {
  unsafe: (text: string, params?: never[]) => PromiseLike<unknown>;
};

function wrapTx(sql: Runner): Db {
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
    // Already inside a transaction: run on the same one.
    tx: (fn) => fn(db),
  };
  return db;
}

function createProdDb(url: string): Db {
  const sql = postgres(url, { prepare: false, max: 5 });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
    tx<T>(fn: (db: Db) => Promise<T>) {
      return sql.begin((t) => fn(wrapTx(t as unknown as Runner))) as Promise<T>;
    },
  };
}

export function getDb(): Db {
  if (testDb) return testDb;
  if (prodDb) return prodDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set and no test database was provided (see setDbForTests)");
  }
  prodDb = createProdDb(url);
  return prodDb;
}

export function setDbForTests(db: Db | null): void {
  testDb = db;
}
