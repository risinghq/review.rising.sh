import { sameText } from "./text.ts";

export const MAX_TEXT_CHARS = 4000;
export const AGREEING_REVIEWS = 2;

export interface Chunk {
  id: string;
  source: string;
  page: number;
  status: string;
  text: string;
  alt: string | null;
}

// Disputed first, then blurry, then a random sample of the agreeing chunks. A
// chunk with one review comes first within its group, so it reaches two sooner.
export const nextChunk = (db: D1Database, userId: string) =>
  db
    .prepare(
      `SELECT c.id, c.source, c.page, c.status, c.text, c.alt FROM chunks c
       WHERE c.status != 'checked'
         AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.chunk_id = c.id AND r.user_id = ?1)
       ORDER BY CASE c.status WHEN 'disputed' THEN 0 WHEN 'blurry' THEN 1 ELSE 2 END,
                (SELECT COUNT(*) FROM reviews r WHERE r.chunk_id = c.id) DESC,
                RANDOM()
       LIMIT 1`,
    )
    .bind(userId)
    .first<Chunk>();

export const progress = (db: D1Database) =>
  db
    .prepare("SELECT status, COUNT(*) AS n FROM chunks GROUP BY status")
    .all<{ status: string; n: number }>()
    .then(({ results }) => Object.fromEntries(results.map((r) => [r.status, r.n])));

export type Submit = { ok: true; checked: boolean } | { ok: false; reason: string };

// Store the review. When enough different people wrote the same text, the chunk
// is `checked` and carries that text.
export async function submit(
  db: D1Database,
  userId: string,
  chunkId: string,
  text: string,
  choice: string,
  now: number,
): Promise<Submit> {
  if (!["a", "b", "edit"].includes(choice)) return { ok: false, reason: "bad_choice" };
  if (!text.trim() || text.length > MAX_TEXT_CHARS) return { ok: false, reason: "bad_text" };
  const chunk = await db.prepare("SELECT status FROM chunks WHERE id = ?1").bind(chunkId).first<{ status: string }>();
  if (!chunk) return { ok: false, reason: "no_chunk" };
  if (chunk.status === "checked") return { ok: false, reason: "already_checked" };
  await db
    .prepare(
      `INSERT INTO reviews (chunk_id, user_id, text, choice, created) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (chunk_id, user_id) DO UPDATE SET text = ?3, choice = ?4, created = ?5`,
    )
    .bind(chunkId, userId, text, choice, now)
    .run();
  const { results } = await db.prepare("SELECT text FROM reviews WHERE chunk_id = ?1").bind(chunkId).all<{ text: string }>();
  const agreeing = results.filter((r) => sameText(r.text, text)).length;
  if (agreeing < AGREEING_REVIEWS) return { ok: true, checked: false };
  await db.prepare("UPDATE chunks SET status = 'checked', text = ?2 WHERE id = ?1").bind(chunkId, text).run();
  return { ok: true, checked: true };
}

export async function recentReviews(db: D1Database, userId: string, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?1 AND created > ?2")
    .bind(userId, now - 60)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
