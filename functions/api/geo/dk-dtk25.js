/*
 * functions/api/geo/dk-dtk25.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/geo/dk-dtk25?service=WMS&request=GetMap&layer=<config id>&…
 *
 * Netlify twin : netlify/functions/dk-dtk25.mjs (imported verbatim below)
 * Shared logic : backend/src/lib/danish-layers.mjs  → dtk25Response()
 *                (the same function the Express backend route and the Netlify
 *                 function call, reading js/danish-layers.config.js through its
 *                 generated backend/src/lib/danish-layers.config.cjs mirror)
 * Netlify route: netlify.toml  /api/geo/dk-dtk25 → /.netlify/functions/dk-dtk25
 *
 * Dataforsyningen tokens cannot be restricted to a domain or an IP, so the
 * token is appended server-side as the `token` KVP on the upstream URL only.
 * The upstream host, the LAYERS value, the passthrough parameter allow-list and
 * the credential-stripping list all live in the shared library — this route adds
 * no URL of its own and cannot become a proxy for anything else.
 *
 * Runtime adaptation: none of the logic. backend/src/lib/danish-layers.mjs uses
 * only fetch/URL/Headers/Response plus process.env and Buffer, all of which
 * runtime-shims.js guarantees, and its config mirror is a static .cjs import
 * that esbuild bundles (verified: the same 11 Danish layers resolve here as in
 * Node). The adapter maps Netlify-CDN-Cache-Control → CDN-Cache-Control, so the
 * 7-day tile pin and the `no-store` on GetCapabilities are unchanged.
 *
 * Environment variables:
 *   DATAFORSYNINGEN_TOKEN            MANDATORY (503 service_unavailable without it)
 *   DANISH_PROXY_ALLOWED_ORIGINS     optional cross-origin allow-list
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import dkDtk25 from '../../../netlify/functions/dk-dtk25.mjs';

export const onRequest = adaptNetlifyFunction(dkDtk25, { route: '/api/geo/dk-dtk25' });
