export function corsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin") || "*";
  const allow = allowedOrigin(origin, env);

  const h = new Headers();
  h.set("Access-Control-Allow-Origin", allow);
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

function allowedOrigin(origin: string, env: Env): string {
  const configured = (env.ALLOWED_ORIGINS || "").trim();
  if (!configured) return "*";

  const allowed = configured.split(",").map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : allowed[0] ?? "*";
}

export function withCors(resp: Response, request: Request, env: Env): Response {
  const h = new Headers(resp.headers);
  const cors = corsHeaders(request, env);
  cors.forEach((v, k) => h.set(k, v));
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: h,
  });
}

export function preflight(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

// Minimal Env typing used across files.
export interface Env {
  OPENAI_API_KEY: string;
  ALLOWED_ORIGINS?: string;

  ROOM: DurableObjectNamespace;
}
