import { beforeEach, describe, expect, it } from "vitest";

import { nextChunk, submit } from "../src/review.ts";
import { memoryD1 } from "./d1.ts";

let db: D1Database;

const user = (id: string) =>
  db.prepare("INSERT INTO users (id, name, created) VALUES (?1, ?1, 0)").bind(id).run();
const chunk = (id: string, status: string, text = "$n$") =>
  db
    .prepare("INSERT INTO chunks (id, source, page, status, text, alt, sharpness, agreement) VALUES (?1, 's', 1, ?2, ?3, NULL, 30, 1)")
    .bind(id, status, text)
    .run();
const status = async (id: string) =>
  (await db.prepare("SELECT status FROM chunks WHERE id = ?1").bind(id).first<{ status: string }>())?.status;

beforeEach(async () => {
  db = memoryD1();
  await user("ana");
  await user("beto");
  await user("carla");
});

describe("submit", () => {
  it("checks a chunk when two different people agree after normalisation", async () => {
    await chunk("s/p01-c01", "disputed");
    expect(await submit(db, "ana", "s/p01-c01", "$\\left(m\\right)$", "edit", 1)).toEqual({ ok: true, checked: false });
    expect(await submit(db, "beto", "s/p01-c01", "$(m)$", "edit", 2)).toEqual({ ok: true, checked: true });
    expect(await status("s/p01-c01")).toBe("checked");
  });

  it("does not count one person twice", async () => {
    await chunk("s/p01-c01", "disputed");
    await submit(db, "ana", "s/p01-c01", "$m$", "edit", 1);
    expect(await submit(db, "ana", "s/p01-c01", "$m$", "edit", 2)).toEqual({ ok: true, checked: false });
    expect(await status("s/p01-c01")).toBe("disputed");
  });

  it("keeps a chunk open when two reviewers disagree", async () => {
    await chunk("s/p01-c01", "disputed");
    await submit(db, "ana", "s/p01-c01", "$m$", "edit", 1);
    expect(await submit(db, "beto", "s/p01-c01", "$n$", "edit", 2)).toEqual({ ok: true, checked: false });
    expect(await submit(db, "carla", "s/p01-c01", "$n$", "edit", 3)).toEqual({ ok: true, checked: true });
  });

  it("refuses a checked chunk, an empty text and an unknown choice", async () => {
    await chunk("s/p01-c01", "checked");
    expect(await submit(db, "ana", "s/p01-c01", "$m$", "a", 1)).toEqual({ ok: false, reason: "already_checked" });
    await chunk("s/p01-c02", "disputed");
    expect(await submit(db, "ana", "s/p01-c02", "  ", "a", 1)).toEqual({ ok: false, reason: "bad_text" });
    expect(await submit(db, "ana", "s/p01-c02", "$m$", "z", 1)).toEqual({ ok: false, reason: "bad_choice" });
  });
});

describe("nextChunk", () => {
  it("serves disputed, then blurry, then machine, and skips what the user reviewed", async () => {
    await chunk("s/p01-c01", "machine");
    await chunk("s/p01-c02", "blurry");
    await chunk("s/p01-c03", "disputed");
    expect((await nextChunk(db, "ana"))?.id).toBe("s/p01-c03");
    await submit(db, "ana", "s/p01-c03", "$m$", "a", 1);
    expect((await nextChunk(db, "ana"))?.id).toBe("s/p01-c02");
    expect((await nextChunk(db, "beto"))?.id).toBe("s/p01-c03");
  });

  it("serves a requested chunk first unless it is checked or already reviewed by the user", async () => {
    await chunk("s/p01-c01", "machine");
    await chunk("s/p01-c02", "disputed");
    expect((await nextChunk(db, "ana", "s/p01-c01"))?.id).toBe("s/p01-c01");
    await submit(db, "ana", "s/p01-c01", "$m$", "a", 1);
    expect((await nextChunk(db, "ana", "s/p01-c01"))?.id).toBe("s/p01-c02");
    expect((await nextChunk(db, "ana", "s/missing"))?.id).toBe("s/p01-c02");
  });
});
