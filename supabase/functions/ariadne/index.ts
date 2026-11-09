// supabase/functions/ariadne/index.ts
//
// Minimal proxy: the browser posts { path, body } here, this function posts it to
// the ARIADNE search endpoint. It exists so the provider can work even if the
// ARIADNE host refuses cross-origin requests.
//
// Deploy:  supabase functions deploy ariadne
// Secrets: supabase secrets set ARIADNE_BASE_URL=https://<confirmed-host>/<search-path>
//          supabase secrets set ARIADNE_API_KEY=...        (only if the host needs one)
//
// UNVERIFIED: whether this runtime can reach the ARIADNE host at all is being
// tested separately. A 502 from here means "this function could not reach it",
// which is exactly the answer the transport switch needs. Nothing in this file
// claims the upstream answers.
//
// Security: the upstream URL and key live only in this function's environment.
// The browser never receives either. Signed-in users only, so this cannot be
// used as an anonymous open proxy.

const UPSTREAM = Deno.env.get("ARIADNE_BASE_URL") || "";
const API_KEY = Deno.env.get("ARIADNE_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY_BYTES = 64 * 1024;        // the query body we accept from the browser
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** Only a path on the configured host, never an absolute URL, never a traversal. */
function safePath(raw: unknown): string | null {
  if (raw == null) return "";
  if (typeof raw !== "string") return null;
  if (raw.length > 512) return null;
  if (/^[a-z]+:\/\//i.test(raw) || raw.includes("..") || raw.includes("\\")) return null;
  if (!raw.startsWith("/")) return null;
  return raw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  if (!UPSTREAM) {
    return jsonResponse({ error: "ARIADNE_BASE_URL is not configured on this function" }, 503);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return jsonResponse({ error: "Missing auth token" }, 401);

    // Verify the caller is a real signed-in user (service role is used only here).
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return jsonResponse({ error: "Invalid session" }, 401);

    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: "Query too large" }, 413);
    let payload: { path?: unknown; method?: unknown; body?: unknown };
    try {
      payload = JSON.parse(text || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const path = safePath(payload.path);
    if (path === null) return jsonResponse({ error: "Invalid path" }, 400);
    const method = payload.method === "GET" ? "GET" : "POST";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${UPSTREAM.replace(/\/+$/, "")}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(API_KEY ? { "X-Api-Key": API_KEY, Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: method === "GET" ? undefined : JSON.stringify(payload.body ?? {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const respText = await upstream.text();
    if (respText.length > MAX_RESPONSE_BYTES) {
      return jsonResponse({ error: "Upstream response too large", bytes: respText.length }, 502);
    }
    // Pass the upstream body through verbatim: the provider parses it, not this function.
    return new Response(respText, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        ...corsHeaders,
      },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return jsonResponse(
      {
        error: aborted ? "Upstream timeout" : "Upstream unreachable",
        detail: e instanceof Error ? e.message : String(e),
        note: "This is the server-side reachability answer the transport switch needs.",
      },
      aborted ? 504 : 502,
    );
  }
});
