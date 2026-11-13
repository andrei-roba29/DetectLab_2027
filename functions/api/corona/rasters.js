/*
 * functions/api/corona/rasters.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for   GET /api/corona/rasters?bbox=minLon,minLat,maxLon,maxLat
 *
 * Netlify twin : netlify/functions/corona-rasters.mjs (imported verbatim below)
 * Shared logic : netlify/lib/corona-catalog.mjs        (pure Web APIs — no port)
 * Netlify route: netlify.toml  /api/corona/rasters → /.netlify/functions/corona-rasters
 *
 * The Netlify handler is imported, not copied: it uses only fetch, URL,
 * AbortController, JSON and Response, all of which the Workers runtime provides
 * natively, so nothing had to be adapted except the runtime interface —
 * bindings come from context.env (this route reads none) and its
 * Netlify-CDN-Cache-Control becomes CDN-Cache-Control in the adapter.
 *
 * On top of the handler's own 12 h isolate-memory cache, withCoronaCatalogueCache()
 * keeps a datacentre copy so a temporarily unavailable corona.cast.uark.edu
 * still answers with the last good Europe catalogue instead of a 502.
 *
 * Environment variables: none.
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import { withCoronaCatalogueCache } from '../../_lib/corona-cache.mjs';
import coronaRasters from '../../../netlify/functions/corona-rasters.mjs';

const adapted = adaptNetlifyFunction(coronaRasters, { route: '/api/corona/rasters' });

export const onRequest = withCoronaCatalogueCache(adapted);
