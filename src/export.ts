import type { Env } from "./env.ts";
import { sameText } from "./text.ts";

// A batch is opened when this many checked chunks wait, or when nothing is left
// to review and some wait.
export const BATCH_MIN = 10;
const API = "https://api.github.com";

interface Waiting {
  id: string;
  source: string;
  page: number;
  text: string;
  sharpness: number;
  agreement: number;
}

export interface Exported {
  id: string;
  path: string;
  content: string;
}

const quote = (value: string) => JSON.stringify(value);

// The reviewers credited are those whose own text equals the final one.
export function renderChunk(chunk: Waiting, reviewers: string[]): string {
  return [
    "---",
    "status: checked",
    `source: ${quote(chunk.source)}`,
    `page: ${chunk.page}`,
    `sharpness: ${chunk.sharpness}`,
    `agreement: ${chunk.agreement}`,
    `reviewers: [${[...new Set(reviewers)].sort().map(quote).join(", ")}]`,
    "---",
    chunk.text.trim(),
    "",
  ].join("\n");
}

async function waiting(db: D1Database): Promise<Waiting[]> {
  const { results } = await db
    .prepare(
      `SELECT id, source, page, text, sharpness, agreement FROM chunks
       WHERE status = 'checked' AND exported_pr IS NULL ORDER BY source, page, id`,
    )
    .all<Waiting>();
  return results;
}

async function reviewers(db: D1Database, chunk: Waiting): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT u.name, r.text FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.chunk_id = ?1")
    .bind(chunk.id)
    .all<{ name: string; text: string }>();
  return results.filter((r) => sameText(r.text, chunk.text)).map((r) => r.name);
}

async function stillOpen(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE status != 'checked'").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function nextBatch(db: D1Database, dir: string): Promise<Exported[]> {
  const chunks = await waiting(db);
  if (chunks.length === 0) return [];
  if (chunks.length < BATCH_MIN && (await stillOpen(db)) > 0) return [];
  return Promise.all(
    chunks.map(async (chunk) => ({
      id: chunk.id,
      path: `${dir}/${chunk.id}.md`,
      content: renderChunk(chunk, await reviewers(db, chunk)),
    })),
  );
}

type Call = (path: string, init?: RequestInit) => Promise<any>;

function github(token: string, repo: string): Call {
  return async (path, init = {}) => {
    const response = await fetch(`${API}/repos/${repo}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "review.rising.sh",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body && { "Content-Type": "application/json" }),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${response.status}`);
    return response.json();
  };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

// Commit the batch to a new branch and open one pull request. Returns its number.
export async function openPullRequest(call: Call, files: Exported[], base: string, branch: string): Promise<number> {
  const sources = [...new Set(files.map((f) => f.id.split("/")[0]))].join(", ");
  const title = `transcripts: add ${files.length} reviewed chunks of ${sources}`;
  const head = (await call(`/git/ref/heads/${base}`)).object.sha as string;
  const parent = (await call(`/git/commits/${head}`)).tree.sha as string;
  const tree = await call(
    "/git/trees",
    post({
      base_tree: parent,
      tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
    }),
  );
  const commit = await call("/git/commits", post({ message: title, tree: tree.sha, parents: [head] }));
  await call("/git/refs", post({ ref: `refs/heads/${branch}`, sha: commit.sha }));
  const pull = await call(
    "/pulls",
    post({
      title,
      head: branch,
      base,
      body: "Reviewed by people on https://review.rising.sh. Each file lists its reviewers.",
    }),
  );
  return pull.number;
}

// Runs from the cron trigger. Chunks are marked only after the pull request exists.
export async function exportChecked(env: Env, now: number): Promise<number | null> {
  if (!env.GITHUB_TOKEN) return null;
  const files = await nextBatch(env.DB, env.TARGET_DIR);
  if (files.length === 0) return null;
  const branch = `review/${new Date(now * 1000).toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const number = await openPullRequest(github(env.GITHUB_TOKEN, env.TARGET_REPO), files, env.TARGET_BASE, branch);
  await env.DB.batch(
    files.map((f) => env.DB.prepare("UPDATE chunks SET exported_pr = ?2 WHERE id = ?1").bind(f.id, number)),
  );
  return number;
}
