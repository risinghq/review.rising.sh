import { currentUser } from "./account.ts";
import { handleAuth } from "./auth.ts";
import type { Env } from "./env.ts";
import { exportChecked } from "./export.ts";
import { fail, reply, sameOrigin } from "./http.ts";
import { MAX_TEXT_CHARS, nextChunk, progress, recentReviews, submit } from "./review.ts";

const MAX_BODY_BYTES = 16_384;
const unixNow = () => Math.floor(Date.now() / 1000);

async function readReview(request: Request): Promise<{ chunk: string; text: string; choice: string } | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const ok = ["chunk", "text", "choice"].every((k) => typeof body?.[k] === "string");
    return ok ? body : null;
  } catch {
    return null;
  }
}

async function api(request: Request, env: Env, path: string, now: number): Promise<Response> {
  const user = await currentUser(env, request, now);
  if (path === "/api/me") return reply({ user });
  if (path === "/api/progress") return reply(await progress(env.DB));
  if (!user) return fail(401, "signed_out", "Inicia sesión para revisar.");
  if (path === "/api/next" && request.method === "GET") return reply({ chunk: await nextChunk(env.DB, user.id) });
  if (path === "/api/review" && request.method === "POST") {
    if (!sameOrigin(request)) return fail(403, "origin", "Origen no permitido.");
    if ((await recentReviews(env.DB, user.id, now)) >= Number(env.REVIEWS_PER_MINUTE))
      return fail(429, "rate", "Vas muy rápido. Espera un momento.");
    const body = await readReview(request);
    if (!body) return fail(400, "bad_request", `Envía JSON con chunk, text (hasta ${MAX_TEXT_CHARS} caracteres) y choice.`);
    const result = await submit(env.DB, user.id, body.chunk, body.text, body.choice, now);
    return result.ok ? reply(result) : fail(409, result.reason, "No se pudo guardar la revisión.");
  }
  return fail(404, "not_found", "No existe.");
}

// A scan is shown to signed-in reviewers only, one chunk at a time.
async function scan(request: Request, env: Env, path: string, now: number): Promise<Response> {
  if (!(await currentUser(env, request, now))) return fail(401, "signed_out", "Inicia sesión para ver el escaneo.");
  const key = decodeURIComponent(path.slice("/scan/".length));
  if (!/^[\w-]+\/p\d+-c\d+$/.test(key)) return fail(404, "not_found", "No existe.");
  const object = await env.SCANS.get(`${key}.png`);
  if (!object) return fail(404, "not_found", "No existe.");
  return new Response(object.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = unixNow();
    if (pathname.startsWith("/auth/")) return handleAuth(request, env, now);
    if (pathname.startsWith("/api/")) return api(request, env, pathname, now);
    if (pathname.startsWith("/scan/")) return scan(request, env, pathname, now);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller, env): Promise<void> {
    await exportChecked(env, unixNow());
  },
} satisfies ExportedHandler<Env>;
