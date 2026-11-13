import { normalize } from './pages-adapter.js';
import { EUROPE_BBOX, bboxIntersects, parseBbox } from '../../netlify/lib/corona-catalog.mjs';

/** The committed/deployed snapshot, as a same-origin asset path. */
export const SNAPSHOT_ASSET_PATH = '/data/corona-europe-catalog.json';

/*
 * functions/_lib/corona-cache.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * The Cloudflare half of the CORONA catalogue's "the upstream is a university
 * server, so serve something" story.
 *
 * netlify/functions/corona-rasters.mjs already keeps the CAST catalogue in
 * isolate memory for 12 h and serves it stale if a refresh fails. That survives
 * as-is on Pages (the same module is imported verbatim), but a Workers isolate
 * is shorter-lived and more widely distributed than a Lambda container, so the
 * memory copy alone would send more requests to corona.cast.uark.edu than the
 * Netlify deployment does.
 *
 * This wrapper adds Cloudflare's own datacentre cache (caches.default) behind
 * it, and — the part that matters for the migration brief — turns it into a
 * snapshot store: when CAST is unreachable AND the isolate has no memory copy,
 * the last good catalogue that passed through this datacentre is served instead
 * of a 502. The map then still draws every CORONA pass and frame over Europe.
 *
 *   request → handler (memory cache → CAST)
 *               ├─ 200 → answer, and waitUntil(caches.default.put(…))
 *               └─ 5xx → caches.default.match(…) → the previous catalogue
 *
 * This is the runtime equivalent of the build-time snapshot in
 * data/corona-europe-catalog.json, and it needs no committed artefact and no
 * network at deploy time. Both mechanisms are described in
 * CLOUDFLARE_MIGRATION.md §2.
 *
 * Cache-Control of the wrapped 200 is `public, max-age=3600` with a 7-day
 * `CDN-Cache-Control`, so the Cloudflare HTTP cache already pins the answer at
 * the edge; caches.default is the *stale* copy that survives that TTL.
 */

/** How long the fallback copy is kept in the datacentre cache. */
export const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;   /* 30 days */

/**
 * The cache key: the same origin and path, reduced to the only parameter the
 * handler reads (`bbox`). Anything else a caller appends must not fragment the
 * snapshot store.
 */
export function catalogueCacheKey(request) {
    const url = new URL(request.url);
    const key = new URL(url.origin + url.pathname);
    const bbox = url.searchParams.get('bbox');
    if (bbox) key.searchParams.set('bbox', bbox);
    return new Request(key.toString(), { method: 'GET' });
}

function tagged(response, value) {
    if (!response) return response;
    const headers = new Headers(response.headers);
    headers.set('X-DetectLab-Corona-Cache', value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The last resort: the deployed static snapshot, reached through env.ASSETS.
 *
 * Pages binds `env.ASSETS` to the deployment's own asset manifest, so a Function
 * can fetch a file it ships without leaving the isolate and without a public
 * round trip. This tier only runs when CAST is unreachable AND the isolate has no
 * memory copy AND caches.default has no copy — i.e. a cold datacentre during a
 * CAST outage.
 *
 * It never fabricates anything:
 *   • no env.ASSETS binding, a non-200, unparseable JSON, a payload without a
 *     blocks[] array, or blocks: [] → null, and the caller keeps the real 502;
 *   • the snapshot is the EUROPE-clipped payload, so it is re-clipped to the
 *     caller's bbox with the SAME bboxIntersects() the upstream clipping uses
 *     (netlify/lib/corona-catalog.mjs) — a bbox over Asia must not come back as
 *     "here is all of Europe".
 *
 * @returns {Promise<Response|null>}
 */
export async function assetCatalogueSnapshot(context, request) {
    const assets = context && context.env && context.env.ASSETS;
    if (!assets || typeof assets.fetch !== 'function') return null;

    let response;
    try {
        response = await assets.fetch(new Request(new URL(request.url).origin + SNAPSHOT_ASSET_PATH));
    } catch (err) {
        console.warn('[detectlab-pages] corona snapshot asset fetch failed: ' + String((err && err.message) || err));
        return null;
    }
    if (!response || !response.ok) return null;

    let payload;
    try { payload = await response.json(); }
    catch { return null; }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.blocks) || payload.blocks.length === 0) {
        return null;
    }

    /* Re-clip to the requested bbox, exactly as slimCatalog() clips the raw CAST
     * payload: a block is kept when its extent intersects, and so is each frame. */
    const bbox = parseBbox(new URL(request.url).searchParams.get('bbox'), EUROPE_BBOX);
    const blocks = [];
    let frames = 0;
    for (const block of payload.blocks) {
        if (!block || !Array.isArray(block.extent) || !bboxIntersects(block.extent, bbox)) continue;
        const images = (Array.isArray(block.images) ? block.images : [])
            .filter((image) => image && Array.isArray(image.extent) && bboxIntersects(image.extent, bbox));
        frames += images.length;
        blocks.push({ ...block, images });
    }
    if (blocks.length === 0) return null;

    return new Response(JSON.stringify({
        source: payload.source || null,
        generated: payload.generated || null,
        bbox,
        passes: blocks.length,
        frames,
        blocks,
        snapshot: true
    }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            /* A snapshot is stale by definition: the browser may hold it briefly,
             * the edge must not pin it as if it were live. */
            'Cache-Control': 'public, max-age=300',
            'X-DetectLab-Corona-Cache': 'snapshot'
        }
    });
}

/**
 * @param {(context: object) => Promise<Response>} handler  an already-adapted Pages handler
 * @returns {(context: object) => Promise<Response>}
 */
export function withCoronaCatalogueCache(handler, options = {}) {
    const ttl = options.ttlSeconds || SNAPSHOT_TTL_SECONDS;

    return async function onRequest(context) {
        const request = context.request;
        const cacheAvailable = typeof caches !== 'undefined' && caches.default && request.method === 'GET';
        if (!cacheAvailable) return handler(context);

        const key = catalogueCacheKey(request);
        let response;
        try {
            response = await handler(context);
        } catch (err) {
            response = null;
            console.error('[detectlab-pages] /api/corona/rasters threw', err);
        }

        if (response && response.ok) {
            /* Store a copy; the caller keeps the original body. */
            try {
                const copy = response.clone();
                const headers = new Headers(copy.headers);
                headers.set('Cache-Control', `public, max-age=${ttl}`);
                headers.delete('CDN-Cache-Control');
                headers.delete('Cloudflare-CDN-Cache-Control');
                const stored = new Response(copy.body, { status: 200, headers });
                const put = caches.default.put(key, stored).catch((err) => {
                    console.warn('[detectlab-pages] corona snapshot not stored: ' + String((err && err.message) || err));
                });
                if (typeof context.waitUntil === 'function') context.waitUntil(put);
                else await put;
            } catch (err) {
                console.warn('[detectlab-pages] corona snapshot not stored: ' + String((err && err.message) || err));
            }
            return tagged(response, 'live');
        }

        /* CAST is down (or the handler failed): serve the last good catalogue
         * this datacentre saw, rather than an empty layer. */
        try {
            const stale = await caches.default.match(key);
            if (stale) {
                console.warn('[detectlab-pages] /api/corona/rasters upstream failed — serving the cached catalogue snapshot');
                return normalize(stale, { route: '/api/corona/rasters', setHeaders: {} });
            }
        } catch (err) {
            console.warn('[detectlab-pages] corona snapshot lookup failed: ' + String((err && err.message) || err));
        }

        /* Cold datacentre, cold isolate, CAST down: the deployed snapshot asset is
         * the only thing left. It is validated before it is served, so a missing
         * or empty asset falls through to the honest 502 below. */
        const snapshot = await assetCatalogueSnapshot(context, request);
        if (snapshot) {
            console.warn('[detectlab-pages] /api/corona/rasters upstream failed — serving the deployed snapshot asset via env.ASSETS');
            return normalize(snapshot, { route: '/api/corona/rasters', setHeaders: {} });
        }

        if (response) return tagged(response, 'miss');
        return new Response(JSON.stringify({ error: 'corona_catalogue_unavailable' }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store'
            }
        });
    };
}
