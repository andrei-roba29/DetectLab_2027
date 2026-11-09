// supabase/functions/_shared/ariadne-params.js
//
// Server-side request rules for the ARIADNE proxy. Self-contained plain ESM so the
// function bundles with no imports outside its own folder, and so the Node tests
// can import this exact file.
//
// The browser sends values; this module decides which values are allowed and what
// the upstream URL becomes. The base address and the filter fragments come from
// the function's environment, never from the request.

export const SEARCH_PATH = "/api/search";

/** The only keys a client may send. */
export const WHITELIST = ["forceReload", "mapq", "q", "loadingStatus", "sort", "order", "bbox"];

/** Fixed, verified order; bbox sits between q and loadingStatus. */
export const PARAM_ORDER = ["forceReload", "mapq", "q", "bbox", "loadingStatus", "sort", "order"];

export const MAX_SIDE_KM = 120;
const KM_PER_DEG_LAT = 111.32;

/** "N,W,S,E" → box, or null. No repairing: a bad bbox is rejected. */
export function parseBbox(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(",");
  if (parts.length !== 4) return null;
  const n = parts.map(Number);
  if (!n.every((v) => Number.isFinite(v))) return null;
  const box = { north: n[0], west: n[1], south: n[2], east: n[3] };
  if (box.north <= box.south || box.east <= box.west) return null;
  if (box.north > 90 || box.south < -90 || box.west < -180 || box.east > 180) return null;
  return box;
}

export function sideKm(box) {
  const midLat = (box.north + box.south) / 2;
  const height = (box.north - box.south) * KM_PER_DEG_LAT;
  const width = (box.east - box.west) * KM_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  return Math.max(height, width);
}

export function bboxError(box, maxSideKm = MAX_SIDE_KM) {
  if (!box) return "bbox must be N,W,S,E with north>south and west<east";
  const side = sideKm(box);
  if (!Number.isFinite(side)) return "bbox has no computable size";
  if (side > maxSideKm + 0.5) return `bbox side ${side.toFixed(1)} km exceeds the ${maxSideKm} km limit`;
  return null;
}

/** Strip anything not on the whitelist; report what was dropped. */
export function whitelist(raw) {
  const params = {};
  const rejected = [];
  if (!raw || typeof raw !== "object") return { params, rejected: ["<not-an-object>"] };
  for (const key of Object.keys(raw)) {
    if (WHITELIST.includes(key)) params[key] = String(raw[key]).slice(0, 512);
    else rejected.push(key);
  }
  return { params, rejected };
}

/**
 * Build the upstream query. Server defaults win over client values for everything
 * except bbox; the filter fragments always come from the server environment.
 */
export function buildParams({ baseParams, client, filters, filterOrder = ["siteType", "period"] }) {
  const out = {};
  for (const key of PARAM_ORDER) {
    if (key === "bbox") {
      out.bbox = client.bbox;
    } else if (baseParams && baseParams[key] != null) {
      out[key] = String(baseParams[key]);
    } else if (client[key] != null) {
      out[key] = String(client[key]);
    }
  }
  for (const name of filterOrder) {
    const fragment = String((filters && filters[name]) || "").trim().replace(/^[?&]+/, "");
    if (!fragment) continue;
    // A captured fragment may be raw or already escaped; decode once, escape once.
    const eq = fragment.indexOf("=");
    if (eq > 0) out[decodeValue(fragment.slice(0, eq))] = decodeValue(fragment.slice(eq + 1));
    else out[decodeValue(fragment)] = "";
  }
  return out;
}

export function decodeValue(value) {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

export function toQueryString(params) {
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
}

export function buildUpstreamUrl(baseUrl, params) {
  return `${String(baseUrl).replace(/\/+$/, "")}${SEARCH_PATH}?${toQueryString(params)}`;
}
