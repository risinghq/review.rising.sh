import type { Env } from "./env.ts";

export type Provider = "google" | "github";
export const COOKIE = "rv_session";
const DAY_S = 86_400;

export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export const randomToken = (bytes: number) =>
  base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

// The user behind a provider identity. The first sign-in creates the user.
export async function userForIdentity(
  db: D1Database,
  provider: Provider,
  subject: string,
  name: string,
  now: number,
): Promise<string> {
  const found = await db
    .prepare("SELECT user_id FROM identities WHERE provider = ?1 AND subject = ?2")
    .bind(provider, subject)
    .first<{ user_id: string }>();
  if (found) return found.user_id;
  const id = randomToken(12);
  await db.batch([
    db.prepare("INSERT INTO users (id, name, created) VALUES (?1, ?2, ?3)").bind(id, name, now),
    db
      .prepare("INSERT INTO identities (provider, subject, user_id) VALUES (?1, ?2, ?3)")
      .bind(provider, subject, id),
  ]);
  return id;
}

export async function openSession(env: Env, userId: string, now: number): Promise<string> {
  const token = randomToken(32);
  const seconds = Number(env.SESSION_DAYS) * DAY_S;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256(token), userId, now + seconds)
    .run();
  return `${COOKIE}=${token}; Max-Age=${seconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export const clearedCookie = () =>
  `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

export async function currentUser(
  env: Env,
  request: Request,
  now: number,
): Promise<{ id: string; name: string } | null> {
  const token = getCookie(request.headers.get("cookie"), COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT users.id, users.name FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2`,
  )
    .bind(await sha256(token), now)
    .first<{ id: string; name: string }>();
}

export async function closeSession(env: Env, request: Request): Promise<void> {
  const token = getCookie(request.headers.get("cookie"), COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
}
