/*
 * functions/api/geo/finland.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for   GET /api/geo/finland?src=…
 *
 * Netlify twin : netlify/functions/finland-geo.mjs  (the 20-line method/CORS
 *                wrapper is reproduced below because the file it imports cannot
 *                be imported into the Workers runtime — see the next paragraph)
 * Shared logic : backend/src/lib/finland-geo.mjs  → finlandGeoResponse()
 *                reached through functions/_generated/finland-geo.mjs
 * Netlify route: netlify.toml  /api/geo/finland → /.netlify/functions/finland-geo
 *
 * WHY THIS ROUTE DOES NOT IMPORT THE NETLIFY FILE
 *   backend/src/lib/finland-geo.mjs locates its layer config with
 *   `createRequire(import.meta.url)(path.resolve(HERE, 'finland-layers.config.cjs'))`
 *   — node:module, node:url, node:path and a filesystem read, none of which
 *   exist in a Workers isolate. Everything else in the file (the fixed upstream
 *   table, the ETRS-TM35FIN matrix, the HKP/WFS id allow-lists, the SYKE and
 *   Åland host+path allow-lists, the passthrough parameter allow-list, the
 *   credential-stripping list and the 15 MB body cap) is pure Web API.
 *   tools/sync-cloudflare-generated.mjs therefore emits a copy in which only
 *   that prelude is swapped for a static ESM import of the very same
 *   backend/src/lib/finland-layers.config.cjs mirror, and `--check` fails the
 *   build if the source ever changes shape. The allow-lists are not duplicated
 *   by hand anywhere.
 *
 * With MML_API_KEY set, src=mml-hillshade-open serves the official
 * avoin-karttakuva WMTS with the key attached server-side; without it the route
 * answers 401 mml_api_key_missing for that src only, exactly as on Netlify.
 *
 * Environment variables:
 *   MML_API_KEY                     optional (free MML self-service key)
 *   FINLAND_PROXY_ALLOWED_ORIGINS   optional cross-origin allow-list
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction, corsPreflightResponse, jsonProblem } from '../../_lib/pages-adapter.js';
import { finlandGeoResponse } from '../../_generated/finland-geo.mjs';

/* Byte-for-byte the method/CORS contract of netlify/functions/finland-geo.mjs. */
async function handler(request) {
    if (request.method === 'OPTIONS') return corsPreflightResponse();
    if (request.method !== 'GET' && request.method !== 'HEAD') return jsonProblem(405, 'method_not_allowed');
    const response = await finlandGeoResponse(request);
    if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
    return response;
}

export const onRequest = adaptNetlifyFunction(handler, { route: '/api/geo/finland' });
