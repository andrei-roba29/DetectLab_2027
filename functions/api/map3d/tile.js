/*
 * functions/api/map3d/tile.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/map3d/tile?layer=<registry id>&z=&x=&y=[&t=][&m=][&p=]
 *   GET /api/map3d/tile?u=<encoded upstream tile URL>      (relay mode)
 *
 * Netlify twin : netlify/functions/map3d-tile.mjs  (the OPTIONS/405/CORS wrapper
 *                is reproduced below; the file cannot be imported because the
 *                library it imports needs node:module, node:fs and node:vm)
 * Shared logic : netlify/lib/map3d-tile.mjs + netlify/lib/map3d-country-modules.mjs
 *                reached through functions/_generated/*.mjs
 *                + js/layer-registry.js (the allow-list itself, imported directly)
 * Netlify route: netlify.toml  /api/map3d/tile → /.netlify/functions/map3d-tile
 *
 * THIS ROUTE IS NOT AN OPEN PROXY, AND THE MIGRATION MUST NOT MAKE IT ONE
 *   • `?layer=` — the id must exist in js/layer-registry.js, the same registry
 *     the browser uses; unknown ids answer 404 unknown-layer. The upstream URL
 *     is then *built* from that definition, never taken from the caller.
 *   • `?u=` relay mode — the host must be one of RELAY_EXTRA_HOSTS or a host of
 *     a registry definition, and loopback/private/link-local/multicast hosts and
 *     IPv6 literals are refused outright. A refusal answers 403 with the reason.
 *   • z is 0…22, x/y are inside 2^z, `t` is a date, `p` and `m` are
 *     character-class checked. Credentials are not handled here at all: the
 *     credentialed sources keep their own routes (/api/geo/se-hojdmodell,
 *     /api/geo/dk-dhm).
 *   Both lists are owned by netlify/lib/map3d-tile.mjs; the generated copy is
 *   verified against it at build time (tools/sync-cloudflare-generated.mjs) and
 *   by test-cloudflare-generated.mjs, which asserts set equality of the relay
 *   allow-list and identical upstream URLs for every registered layer.
 *
 * Runtime adaptation performed by the generator (no logic is rewritten):
 *   createRequire(js/layer-registry.js)  → a static ESM import (esbuild bundles
 *       the registry together with js/asig-albania-layers.config.js,
 *       js/danish-layers.config.js and js/finland-layers.config.js, whose
 *       require() lookups are guarded by `typeof require === 'function'`;
 *       189 layers resolve in Node, in Netlify and in workerd alike)
 *   node:vm + node:fs country-module sandbox → the same eight browser modules
 *       embedded as real code (Workers refuses eval/new Function)
 *   Netlify-CDN-Cache-Control → CDN-Cache-Control, same 7-day s-maxage
 *
 * Environment variables: none.
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import { handleTileRequest } from '../../_generated/map3d-tile.mjs';

/* The method/CORS contract of netlify/functions/map3d-tile.mjs, with the
 * runtime tag that says which deployment answered. */
async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'method-not-allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const response = await handleTileRequest(request);
    const headers = new Headers(response.headers);
    /* Same-origin in practice; the header keeps the response usable if the 3D
     * view is ever embedded elsewhere. */
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Map3D-Proxy', 'cloudflare-pages-function');
    return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers
    });
}

export const onRequest = adaptNetlifyFunction(handler, { route: '/api/map3d/tile' });
