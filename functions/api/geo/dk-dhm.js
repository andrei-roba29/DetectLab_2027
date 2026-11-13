/*
 * functions/api/geo/dk-dhm.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/geo/dk-dhm?service=WMTS&request=GetTile&…      (no token)
 *
 * Netlify twin : netlify/functions/dk-dhm.mjs (imported verbatim below)
 * Netlify route: netlify.toml  /api/geo/dk-dhm → /.netlify/functions/dk-dhm
 *
 * The Dataforsyningen token is account-wide — there is no documented way to
 * bind one to a domain or an IP — so it is attached here as the upstream
 * `token` HTTP header and never reaches a browser. The layer → upstream table
 * (dhm_terraen_skyggekort / dhm_overflade_skyggekort), the image/jpeg-only
 * format rule, the View1 tile-matrix bounds and the credential-stripping list
 * all stay in the Netlify file: this route adds nothing to the allow-list and
 * cannot widen it.
 *
 * Runtime adaptation: the handler reads process.env.DATAFORSYNINGEN_TOKEN and
 * buffers with Buffer.from(). runtime-shims.js binds process.env to context.env
 * (so the secret still comes from the deployment's own binding) and guarantees
 * Buffer; the adapter turns its Netlify-CDN-Cache-Control into CDN-Cache-Control
 * with the identical value, keeping the 7-day tile pin on the Cloudflare edge.
 *
 * Environment variable (MANDATORY for this route): DATAFORSYNINGEN_TOKEN
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import dkDhm from '../../../netlify/functions/dk-dhm.mjs';

export const onRequest = adaptNetlifyFunction(dkDhm, { route: '/api/geo/dk-dhm' });
