export function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const fail = (status: number, reason: string, error: string) =>
  reply({ error, reason }, status);

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

// A request that changes data counts only if the page is from this same origin.
export const sameOrigin = (request: Request) =>
  request.headers.get("origin") === new URL(request.url).origin;
