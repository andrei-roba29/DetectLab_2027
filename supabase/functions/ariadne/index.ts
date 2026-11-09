// supabase/functions/ariadne/index.ts
//
// Closed proxy for the ARIADNE portal search. The browser never learns the base
// address, the filter fragments or any key; it sends a whitelisted parameter set.
//
// Deploy:
//   supabase functions deploy ariadne
//   supabase secrets set ARIADNE_BASE_URL=https://portal.ariadne-infrastructure.eu
//   supabase secrets set ARIADNE_SITE_FILTER='<captured fragment>'
//   supabase secrets set ARIADNE_PERIOD_FILTER='<captured fragment>'
// Apply backend/migrations/manual/019_apm_ariadne_gateway.sql first: without the
// cache and gate tables this function refuses to serve (fail closed).
//
// Guards, in order: POST only → signed-in user → premium (server-side) → parameter
// whitelist → bbox format and size (≤120 km per side) → shared cache → rate gate
// (per-user and global, one upstream call at a time, ≥1500 ms apart) → upstream GET.
//
// UNVERIFIED: whether this runtime can reach the portal at all.

import { parseBbox, bboxError, whitelist, buildParams, buildUpstreamUrl } from "../_shared/ariadne-params.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BASE_URL = Deno.env.get("ARIADNE_BASE_URL") || "https://portal.ariadne-infrastructure.eu";
const SITE_FILTER = Deno.env.get("ARIADNE_SITE_FILTER") || "";
const PERIOD_FILTER = Deno.env.get("ARIADNE_PERIOD_FILTER") || "";

const MIN_SPACING_MS = 1500;
const USER_LIMIT = 60;          // per user per hour
const GLOBAL_LIMIT = 300;       // whole deployment per hour
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024;
const UPSTREAM_TIMEOUT_MS = 15000;

const BASE_PARAMS = {
  forceReload: "true",
  mapq: "true",
  q: "",
  loadingStatus: "2",
  sort: "distance",
  order: "asc",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extra },
  });
}

async function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function isPremium(userId: string): Promise<boolean | null> {
  const res = await rest(`profiles?id=eq.${encodeURIComponent(userId)}&select=plan,premium_expires_at`);
  if (!res.ok) return null;                       // unknown → fail closed
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return false;
  const row = rows[0];
  return row.plan === "premium" && row.premium_expires_at != null && new Date(row.premium_expires_at) > new Date();
}

async function gate(userId: string) {
  const res = await rest("rpc/apm_ariadne_gate", {
    method: "POST",
    body: JSON.stringify({
      p_user: userId,
      p_min_spacing_ms: MIN_SPACING_MS,
      p_user_limit: USER_LIMIT,
      p_global_limit: GLOBAL_LIMIT,
    }),
  });
  if (!res.ok) return { installed: false, allowed: false, reason: "gate-unavailable" };
  const data = await res.json();
  return { installed: true, allowed: Boolean(data && data.allowed), reason: (data && data.reason) || null, retry_after_ms: data && data.retry_after_ms };
}

async function cacheGet(key: string) {
  const nowIso = new Date().toISOString();
  const res = await rest(`apm_ariadne_cache?query_key=eq.${encodeURIComponent(key)}&expires_at=gt.${encodeURIComponent(nowIso)}&select=payload`);
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0].payload : null;
}

async function cachePut(key: string, payload: unknown, cells: number | null) {
  const expires = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
  await rest("apm_ariadne_cache", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ query_key: key, payload, cells, fetched_at: new Date().toISOString(), expires_at: expires }]),
  }).catch(() => undefined);   // a cache write failure must not fail the request
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Missing auth token" }, 401);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return json({ error: "Invalid session" }, 401);
    const user = await userRes.json();
    const userId = user && user.id;
    if (!userId) return json({ error: "Invalid session" }, 401);

    // Premium, enforced here and not merely in the browser.
    const premium = await isPremium(userId);
    if (premium === null) return json({ error: "Entitlement check unavailable" }, 503);
    if (!premium) return json({ error: "premium_required" }, 403);

    const text = await req.text();
    if (text.length > MAX_REQUEST_BYTES) return json({ error: "Request too large" }, 413);
    let body: { params?: Record<string, unknown> };
    try {
      body = JSON.parse(text || "{}");
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const allowed = whitelist(body.params);
    if (allowed.rejected.length) return json({ error: "Unknown parameters", rejected: allowed.rejected }, 400);
    if (!allowed.params.bbox) return json({ error: "bbox is required" }, 400);

    const box = parseBbox(allowed.params.bbox);
    const problem = bboxError(box);
    if (problem) return json({ error: problem }, 400);

    const params = buildParams({
      baseParams: BASE_PARAMS,
      client: allowed.params,
      filters: { siteType: SITE_FILTER, period: PERIOD_FILTER },
    });
    const upstreamUrl = buildUpstreamUrl(BASE_URL, params);

    const cached = await cacheGet(upstreamUrl);
    if (cached) return json(cached, 200, { "x-ariadne-cache": "hit" });

    const decision = await gate(userId);
    if (!decision.installed) {
      return json({ error: "gate_unavailable", detail: "019_apm_ariadne_gateway.sql is not applied" }, 503);
    }
    if (!decision.allowed) {
      return json({ error: decision.reason || "rate_limited", retry_after_ms: decision.retry_after_ms ?? null }, 429, {
        "retry-after": String(Math.ceil((decision.retry_after_ms ?? MIN_SPACING_MS) / 1000)),
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const upstreamText = await upstream.text();
    if (upstreamText.length > MAX_RESPONSE_BYTES) {
      return json({ error: "Upstream response too large", bytes: upstreamText.length }, 502);
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(upstreamText);
    } catch {
      return json({ error: "Upstream returned non-JSON", status: upstream.status }, 502);
    }

    if (upstream.ok) {
      const cells = parsed && parsed.aggregations && parsed.aggregations.geogridCentroid
        && parsed.aggregations.geogridCentroid.grids && parsed.aggregations.geogridCentroid.grids.buckets;
      await cachePut(upstreamUrl, parsed, Array.isArray(cells) ? cells.length : null);
    }

    // The body is passed through verbatim; the provider parses it.
    return new Response(upstreamText, {
      status: upstream.ok ? 200 : 502,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
        "x-ariadne-cache": "miss",
        "x-ariadne-upstream-status": String(upstream.status),
      },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return json(
      {
        error: aborted ? "Upstream timeout" : "Upstream unreachable",
        detail: e instanceof Error ? e.message : String(e),
        note: "This is the server-side reachability answer the transport switch needs.",
      },
      aborted ? 504 : 502,
    );
  }
});
