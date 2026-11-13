/*
 * functions/_middleware.js
 * ───────────────────────────────────────────────────────────────────────────
 * Host canonicalisation for every request that reaches Pages Functions.
 *
 *   https://www.detectlab.ro/<path>?<query>  →  301  https://detectlab.ro/<path>?<query>
 *   https://www.detectlab.eu/<path>?<query>  →  301  https://detectlab.eu/<path>?<query>
 *
 * This is the code half of the two rules netlify.toml expresses as
 *
 *   [[redirects]] from = "https://www.detectlab.ro/*" to = "https://detectlab.ro/:splat" status = 301 force = true
 *   [[redirects]] from = "https://www.detectlab.eu/*" to = "https://detectlab.eu/:splat" status = 301 force = true
 *
 * WHY IT IS NOT ENOUGH ON ITS OWN
 *   Cloudflare Pages `_redirects` cannot match on a hostname at all —
 *   "Domain-level redirects ❌" in the Pages redirects documentation — and
 *   `_routes.json` in this project limits Functions to the nine /api/… paths so
 *   that no static asset ever pays for a Function invocation. A request for
 *   https://www.detectlab.ro/ therefore never reaches this file: it is answered
 *   straight from the asset store.
 *   → The two hostname rules MUST also be created as Cloudflare Redirect Rules
 *     (or a Bulk Redirect list). Exact expressions, and why the two country
 *     domains must never be merged into one rule, are in
 *     CLOUDFLARE_MIGRATION.md §6.4 and CLOUDFLARE_DASHBOARD_CHECKLIST.md.
 *
 * WHAT THIS FILE DOES BUY
 *   • the same canonicalisation the Netlify deployment applies to /api/… (where
 *     netlify.toml's `force = true` also covers those paths), so the Danish and
 *     Finnish origin allow-lists see one origin per market on both platforms;
 *   • a code-level guarantee that survives any dashboard misconfiguration;
 *   • the invariant below, which is asserted by test-cloudflare-config.mjs.
 *
 * THE INVARIANT: detectlab.ro and detectlab.eu are two markets. Each www host
 * may only ever be rewritten to its OWN apex. There is no code path, and must
 * never be one, that turns a .ro request into a .eu response or vice versa.
 */

/** www host → the one apex it may be canonicalised to. Nothing else. */
export const CANONICAL_HOSTS = {
    'www.detectlab.ro': 'detectlab.ro',
    'www.detectlab.eu': 'detectlab.eu'
};

export async function onRequest(context) {
    let host = '';
    try {
        host = new URL(context.request.url).hostname.toLowerCase();
    } catch {
        return context.next();
    }

    const apex = Object.prototype.hasOwnProperty.call(CANONICAL_HOSTS, host) ? CANONICAL_HOSTS[host] : null;
    if (!apex) return context.next();

    const target = new URL(context.request.url);
    target.hostname = apex;                 /* path, query and fragment are kept verbatim */
    target.port = '';

    return Response.redirect(target.toString(), 301);
}
