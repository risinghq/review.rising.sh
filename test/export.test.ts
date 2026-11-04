import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import { exportChecked, renderChunk } from "../src/export.ts";
import { submit } from "../src/review.ts";
import { memoryD1 } from "./d1.ts";

let db: D1Database;
const calls: { method: string; url: string; body: any }[] = [];

const user = (id: string, name: string) =>
  db.prepare("INSERT INTO users (id, name, created) VALUES (?1, ?2, 0)").bind(id, name).run();
const chunk = (id: string, status = "disputed") =>
  db
    .prepare("INSERT INTO chunks (id, source, page, status, text, alt, sharpness, agreement) VALUES (?1, 's', 1, ?2, '$m$', NULL, 30, 1)")
    .bind(id, status)
    .run();
const check = async (id: string) => {
  await submit(db, "ana", id, "$x$", "edit", 1);
  await submit(db, "beto", id, "$x$", "edit", 2);
};
const env = (): Env =>
  ({ DB: db, GITHUB_TOKEN: "t", TARGET_REPO: "o/r", TARGET_BASE: "master", TARGET_DIR: "data/transcripts" }) as Env;

beforeEach(async () => {
  db = memoryD1();
  calls.length = 0;
  await user("ana", "Ana");
  await user("beto", "Beto");
  await user("carla", "Carla");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init.method ?? "GET", url, body });
    const answer = url.includes("/git/ref/") ? { object: { sha: "head" } }
      : url.includes("/git/commits/") ? { tree: { sha: "base" } }
      : url.endsWith("/pulls") ? { number: 7 }
      : { sha: "new" };
    return new Response(JSON.stringify(answer));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("renderChunk", () => {
  it("lists each reviewer once, in order", () => {
    const text = renderChunk({ id: "s/p01-c01", source: "s", page: 1, text: "$x$\n", sharpness: 30, agreement: 1 }, ["Beto", "Ana", "Beto"]);
    expect(text).toContain('reviewers: ["Ana", "Beto"]');
    expect(text.endsWith("---\n$x$\n")).toBe(true);
  });
});

describe("exportChecked", () => {
  it("opens one pull request when nothing is left to review and marks the chunks", async () => {
    await chunk("s/p01-c01");
    await check("s/p01-c01");
    expect(await exportChecked(env(), 1_700_000_000)).toBe(7);
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!.body;
    expect(tree.tree[0].path).toBe("data/transcripts/s/p01-c01.md");
    expect(tree.tree[0].content).toContain('reviewers: ["Ana", "Beto"]');
    expect(calls.find((c) => c.url.endsWith("/git/refs"))!.body.ref).toBe("refs/heads/review/20231114221320");
    const row = await db.prepare("SELECT exported_pr FROM chunks").first<{ exported_pr: number }>();
    expect(row?.exported_pr).toBe(7);
    expect(await exportChecked(env(), 1_700_000_100)).toBeNull();
  });

  it("waits while few chunks are checked and others remain open", async () => {
    await chunk("s/p01-c01");
    await chunk("s/p01-c02");
    await check("s/p01-c01");
    expect(await exportChecked(env(), 1)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("leaves chunks unmarked when GitHub refuses", async () => {
    await chunk("s/p01-c01");
    await check("s/p01-c01");
    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    await expect(exportChecked(env(), 1)).rejects.toThrow("403");
    const row = await db.prepare("SELECT exported_pr FROM chunks").first<{ exported_pr: number | null }>();
    expect(row?.exported_pr).toBeNull();
  });
});
