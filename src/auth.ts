import {
  type Provider, base64url, clearedCookie, closeSession, getCookie, openSession,
  randomToken, userForIdentity,
} from "./account.ts";
import type { Env } from "./env.ts";
import { fail, redirect } from "./http.ts";

const FLOW_COOKIE = "rv_oauth";
const FLOW_SECONDS = 600;
const TIMEOUT_MS = 5000;
const USER_AGENT = "review.rising.sh";

interface ProviderConfig {
  authorize: string;
  token: string;
  userinfo: string;
  scope: string;
  credentials(env: Env): { id?: string; secret?: string };
  // The opaque subject and the display name the provider gave.
  identity(info: Record<string, unknown>): { subject: string; name: string } | null;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

const PROVIDERS: Record<Provider, ProviderConfig> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid profile",
    credentials: (env) => ({ id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }),
    identity: (info) => {
      const subject = text(info.sub, 255);
      return subject ? { subject, name: text(info.name, 80) ?? "Anónimo" } : null;
    },
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    userinfo: "https://api.github.com/user",
    scope: "",
    credentials: (env) => ({ id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET }),
    identity: (info) =>
      Number.isSafeInteger(info.id)
        ? { subject: String(info.id), name: text(info.name, 80) ?? text(info.login, 80) ?? "Anónimo" }
        : null,
  },
};

const isProvider = (name: string): name is Provider => Object.hasOwn(PROVIDERS, name);

interface Flow { provider: Provider; state: string; verifier: string }

const flowCookie = (value: string, maxAge: number) =>
  `${FLOW_COOKIE}=${value}; Max-Age=${maxAge}; Path=/auth; HttpOnly; Secure; SameSite=Lax`;

function readFlow(header: string | null): Flow | null {
  const raw = getCookie(header, FLOW_COOKIE);
  if (!raw) return null;
  try {
    const flow = JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/"))) as Flow;
    return [flow.provider, flow.state, flow.verifier].every((p) => typeof p === "string") &&
      isProvider(flow.provider)
      ? flow
      : null;
  } catch {
    return null;
  }
}

async function start(request: Request, env: Env, provider: Provider): Promise<Response> {
  const config = PROVIDERS[provider];
  const { id, secret } = config.credentials(env);
  if (!id || !secret) return fail(503, "provider_unavailable", "Este inicio de sesión no está configurado.");
  const origin = new URL(request.url).origin;
  const flow: Flow = { provider, state: randomToken(16), verifier: randomToken(32) };
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier))),
  );
  const target = new URL(config.authorize);
  target.search = new URLSearchParams({
    client_id: id,
    redirect_uri: `${origin}/auth/${provider}/callback`,
    response_type: "code",
    state: flow.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(config.scope && { scope: config.scope }),
  }).toString();
  const cookie = base64url(new TextEncoder().encode(JSON.stringify(flow)));
  return redirect(target.toString(), [flowCookie(cookie, FLOW_SECONDS)]);
}

type Exchange = { subject: string; name: string } | "rejected" | "unavailable";

async function exchange(env: Env, provider: Provider, origin: string, code: string, verifier: string): Promise<Exchange> {
  const config = PROVIDERS[provider];
  const { id, secret } = config.credentials(env);
  const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
  try {
    const tokenResponse = await fetch(config.token, {
      method: "POST",
      headers,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/auth/${provider}/callback`,
        client_id: id ?? "",
        client_secret: secret ?? "",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (tokenResponse.status >= 500) return "unavailable";
    const token = (await tokenResponse.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!tokenResponse.ok || typeof token?.access_token !== "string") return "rejected";
    const infoResponse = await fetch(config.userinfo, {
      headers: { ...headers, Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (infoResponse.status >= 500) return "unavailable";
    if (!infoResponse.ok) return "rejected";
    const info = (await infoResponse.json().catch(() => null)) as Record<string, unknown> | null;
    return (info && config.identity(info)) || "rejected";
  } catch {
    return "unavailable";
  }
}

async function callback(request: Request, env: Env, provider: Provider, now: number): Promise<Response> {
  const url = new URL(request.url);
  const spent = flowCookie("", 0);
  const refuse = (status: number, reason: string, error: string) => {
    const response = fail(status, reason, error);
    response.headers.append("Set-Cookie", spent);
    return response;
  };
  const flow = readFlow(request.headers.get("cookie"));
  if (!flow || flow.provider !== provider)
    return refuse(400, "flow_missing", "El inicio de sesión caducó. Vuelve a intentarlo.");
  if (url.searchParams.get("state") !== flow.state)
    return refuse(400, "state_mismatch", "El inicio de sesión no coincide con el que empezaste.");
  if (url.searchParams.has("error")) return redirect("/", [spent]);
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) return refuse(400, "code_missing", "El proveedor no devolvió un código.");
  const result = await exchange(env, provider, url.origin, code, flow.verifier);
  if (result === "unavailable") return refuse(502, "provider_failed", "El proveedor no respondió. Inténtalo de nuevo.");
  if (result === "rejected") return refuse(400, "code_rejected", "El proveedor rechazó el inicio de sesión.");
  const userId = await userForIdentity(env.DB, provider, result.subject, result.name, now);
  return redirect("/", [await openSession(env, userId, now), spent]);
}

export async function handleAuth(request: Request, env: Env, now: number): Promise<Response> {
  const [, name = "", action] = new URL(request.url).pathname.split("/").filter(Boolean);
  if (name === "logout" && request.method === "POST") {
    await closeSession(env, request);
    return redirect("/", [clearedCookie()]);
  }
  if (!isProvider(name) || request.method !== "GET") return fail(404, "not_found", "No existe.");
  if (action === "callback") return callback(request, env, name, now);
  return start(request, env, name);
}
