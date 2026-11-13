import { installRuntimeShims } from './runtime-shims.js';

/*
 * functions/_lib/pages-adapter.js
 * ───────────────────────────────────────────────────────────────────────────
 * Turns a Netlify Function handler — `export default async (request) => new
 * Response(…)` — into a Cloudflare Pages Function handler, without touching a
 * single line of the business logic it wraps.
 *
 * The two runtimes are almost the same (both are Web-standard Request/Response
 * with global fetch), so the adapter is deliberately small. It does exactly the
 * four things that genuinely differ:
 *
 *   1. CREDENTIALS   Netlify reads them from process.env; Pages Functions hand
 *                    them over as context.env. installRuntimeShims(context.env)
 *                    binds the two, so the shared libraries keep reading
 *                    process.env.X and every secret still comes from the
 *                    deployment's own binding — never from a literal in code.
 *
 *   2. CDN CACHE     `Netlify-CDN-Cache-Control` is a Netlify-only directive
 *                    that Cloudflare ignores. It is translated to the standard
 *                    `CDN-Cache-Control` (and Cloudflare's own
 *                    `Cloudflare-CDN-Cache-Control`) with the identical value,
 *                    so the seven-day tile pin and the stale-while-revalidate
 *                    windows survive the move. The Netlify header is removed so
 *                    it never reaches a browser.
 *
 *   3. HEAD          workerd already strips the body of a HEAD response
 *                    (verified), and the handlers that care build an empty body
 *                    themselves, so nothing is done here — behaviour matches
 *                    Netlify.
 *
 *   4. ERRORS        An exception must not become a Cloudflare 1101 page with a
 *                    stack in it; it becomes the same shape of JSON error the
 *                    Netlify handlers produce, and the detail goes to the
 *                    Workers log only.
 *
 * What it deliberately does NOT do: add CORS headers, answer OPTIONS, reject
 * methods, or normalise status codes. Those are part of each route's existing
 * contract and differ between routes (dk-* and finland answer OPTIONS with 204,
 * corona-rasters ignores the method, asig-heritage answers 405). The adapter
 * keeps whatever the wrapped handler returns, so Cloudflare and Netlify answer
 * identically — test-cloudflare-functions.mjs pins that per route.
 */

/** Header names that mean nothing outside Netlify. */
const NETLIFY_ONLY_HEADERS = ['netlify-cdn-cache-control', 'netlify-function-version'];

/**
 * @param {(request: Request) => Response|Promise<Response>} handler
 *        the existing Netlify Function default export (or an equivalent)
 * @param {object} [options]
 * @param {string} [options.route]        the public path, for logs only
 * @param {Record<string,string>} [options.setHeaders]
 *        headers to set on the way out (e.g. the runtime tag of the 3D proxy)
 * @param {string[]} [options.deleteHeaders]  headers to drop
 * @param {boolean} [options.runtimeHeader=true]
 *        add `X-DetectLab-Runtime: cloudflare-pages-function`
 * @returns {(context: {request: Request, env: object, waitUntil?: Function}) => Promise<Response>}
 */
export function adaptNetlifyFunction(handler, options = {}) {
    const route = options.route || '';
    const setHeaders = options.setHeaders || null;
    const deleteHeaders = (options.deleteHeaders || []).map((h) => h.toLowerCase());
    const runtimeHeader = options.runtimeHeader !== false;

    return async function onRequest(context) {
        /* Secrets always come from the Pages binding for this request. */
        installRuntimeShims(context && context.env);

        let response;
        try {
            response = await handler(context.request);
        } catch (err) {
            /* Log the real reason server-side; answer with the same generic
             * shape the Netlify handlers use, never the message or the stack. */
            console.error('[detectlab-pages] ' + (route || 'handler') + ' threw', err);
            return new Response(JSON.stringify({ error: 'internal_error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
            });
        }

        return normalize(response, { route, setHeaders, deleteHeaders, runtimeHeader });
    };
}

/**
 * Rewrite the CDN cache directives and the runtime tags of a response produced
 * by shared Netlify/Express code. Exported because the two routes that build
 * their own handler (map3d-tile, finland) use it directly.
 */
export function normalize(response, options = {}) {
    if (!(response instanceof Response)) {
        return new Response(JSON.stringify({ error: 'bad_handler_response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    const headers = new Headers(response.headers);
    let changed = false;

    /* Netlify-CDN-Cache-Control → CDN-Cache-Control (identical value). */
    const netlifyCdn = headers.get('netlify-cdn-cache-control');
    if (netlifyCdn !== null) {
        if (!headers.has('cdn-cache-control')) headers.set('CDN-Cache-Control', netlifyCdn);
        if (!headers.has('cloudflare-cdn-cache-control')) headers.set('Cloudflare-CDN-Cache-Control', netlifyCdn);
        changed = true;
    }
    for (const name of NETLIFY_ONLY_HEADERS) {
        if (headers.has(name)) { headers.delete(name); changed = true; }
    }
    for (const name of (options.deleteHeaders || [])) {
        if (headers.has(name)) { headers.delete(name); changed = true; }
    }
    for (const [name, value] of Object.entries(options.setHeaders || {})) {
        if (headers.get(name) !== value) { headers.set(name, value); changed = true; }
    }
    if (options.runtimeHeader !== false &&
        headers.get('x-detectlab-runtime') !== 'cloudflare-pages-function') {
        headers.set('X-DetectLab-Runtime', 'cloudflare-pages-function');
        changed = true;
    }

    if (!changed) return response;

    /* 204/304 must not carry a body; everything else keeps the stream. */
    const bodyless = response.status === 204 || response.status === 304 || response.body === null;
    return new Response(bodyless ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

/** The 204 preflight answer the existing Danish/Finnish/3D routes give. */
export function corsPreflightResponse() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

/** The generic JSON error body used by the shared Danish/Finnish libraries. */
export function jsonProblem(status, error, extra) {
    return new Response(JSON.stringify(Object.assign({ error }, extra || {})), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}
