import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The part of D1's API the Worker uses, over an in-memory SQLite with the real schema.
export function memoryD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync(join(import.meta.dirname, "../src/schema.sql"), "utf8"));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => (sqlite.prepare(sql).get(...(args as never[])) as never) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...(args as never[])) as never[] }),
    run: async () => void sqlite.prepare(sql).run(...(args as never[])),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (all: { run(): Promise<void> }[]) => {
      for (const one of all) await one.run();
      return [];
    },
  } as unknown as D1Database;
}
