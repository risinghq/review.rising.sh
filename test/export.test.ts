import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env.ts";
import { BATCH_MIN, exportChanged, renderChunk } from "../src/export.ts";
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
const exported = async () =>
  (await db.prepare("SELECT exported_status AS s FROM chunks ORDER BY id").all<{ s: string | null }>()).results.map((r) => r.s);
const commit = () => calls.find((c) => c.url.endsWith("/graphql"))!.body.variables.input;
const tree = (): { path: string; content: string }[] =>
  commit().fileChanges.additions.map((a: { path: string; contents: string }) => ({
    path: a.path,
    content: new TextDecoder().decode(Uint8Array.from(atob(a.contents), (c) => c.charCodeAt(0))),
  }));

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
      : url.endsWith("/graphql") ? { data: { createCommitOnBranch: { commit: { oid: "new" } } } }
      : url.endsWith("/pulls") ? { number: 7 }
      : { sha: "new" };
    return new Response(JSON.stringify(answer));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("renderChunk", () => {
  const base = { id: "s/p01-c01", source: "s", page: 1, status: "checked", text: "$x$\n", sharpness: 30, agreement: 1 };

  it("lists each reviewer once, in order", () => {
    const text = renderChunk(base, ["Beto", "Ana", "Beto"]);
    expect(text).toContain('reviewers: ["Ana", "Beto"]');
    expect(text.endsWith("---\n$x$\n")).toBe(true);
  });

  it("publishes no text for a blurry chunk", () => {
    const text = renderChunk({ ...base, status: "blurry", text: "garbage" }, []);
    expect(text).toContain("status: blurry");
    expect(text).not.toContain("garbage");
  });
});

describe("exportChanged", () => {
  const ids = Array.from({ length: BATCH_MIN }, (_, i) => `s/p01-c${String(i).padStart(2, "0")}`);

  it("opens one pull request when every chunk is checked and marks the chunks", async () => {
    await chunk("s/p01-c01");
    await check("s/p01-c01");
    expect(await exportChanged(env(), 1_700_000_000)).toBe(7);
    expect(tree()[0].path).toBe("data/transcripts/s/p01-c01.md");
    expect(tree()[0].content).toContain("status: checked");
    expect(tree()[0].content).toContain('reviewers: ["Ana", "Beto"]');
    expect(calls.find((c) => c.url.endsWith("/git/refs"))!.body.ref).toBe("refs/heads/review/20231114221320");
    expect(commit()).toMatchObject({
      branch: { repositoryNameWithOwner: "o/r", branchName: "review/20231114221320" },
      expectedHeadOid: "head",
    });
    expect(calls.some((c) => c.url.endsWith("/git/commits"))).toBe(false);
    expect(await exported()).toEqual(["checked"]);
    expect(await exportChanged(env(), 1_700_000_100)).toBeNull();
  });

  it("waits while few chunks changed and others remain unchecked", async () => {
    await chunk("s/p01-c01");
    await chunk("s/p01-c02");
    await check("s/p01-c01");
    expect(await exportChanged(env(), 1)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("publishes unreviewed chunks with their status", async () => {
    for (const id of ids.slice(0, -1)) await chunk(id, "machine");
    await chunk(ids.at(-1)!, "blurry");
    expect(await exportChanged(env(), 1)).toBe(7);
    expect(tree()).toHaveLength(BATCH_MIN);
    expect(tree()[0].content).toContain("status: machine");
    expect(tree()[0].content).toContain("reviewers: []");
    expect(tree().at(-1)!.content).toContain("status: blurry");
    expect(tree().at(-1)!.content).not.toContain("$m$");
  });

  it("exports a chunk again when its status changes", async () => {
    for (const id of ids) await chunk(id);
    await exportChanged(env(), 1);
    expect(await exported()).toEqual(ids.map(() => "disputed"));
    for (const id of ids) await check(id);
    calls.length = 0;
    expect(await exportChanged(env(), 2)).toBe(7);
    expect(tree()[0].content).toContain("status: checked");
    expect(await exported()).toEqual(ids.map(() => "checked"));
  });

  it("leaves chunks unmarked when GitHub refuses", async () => {
    await chunk("s/p01-c01");
    await check("s/p01-c01");
    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    await expect(exportChanged(env(), 1)).rejects.toThrow("403");
    expect(await exported()).toEqual([null]);
  });

  it("leaves chunks unmarked when GraphQL answers 200 with errors", async () => {
    await chunk("s/p01-c01");
    await check("s/p01-c01");
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/graphql") ? { errors: [{ message: "bad oid" }] } : { object: { sha: "head" }, sha: "x" })),
    );
    await expect(exportChanged(env(), 1)).rejects.toThrow("bad oid");
    expect(await exported()).toEqual([null]);
  });
});
