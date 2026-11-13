/*
 * functions/api/geo/dk-heritage.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/geo/dk-heritage?bbox=west,south,east,north[&layer=…][&maxFeatures=…]
 *
 * Netlify twin : netlify/functions/dk-heritage.mjs (imported verbatim below)
 * Shared logic : backend/src/lib/danish-layers.mjs  → heritageResponse()
 * Netlify route: netlify.toml  /api/geo/dk-heritage → /.netlify/functions/dk-heritage
 *
 * No secret is involved. The route exists because Slots- og Kulturstyrelsen's
 * "Fund og Fortidsminder" WFS publishes EPSG:25832 and answers a degrees bbox
 * with an EMPTY FeatureCollection instead of an error. The shared library
 * converts the view bbox into EPSG:25832 (Snyder series, k0 = 0.9996, lon0 = 9°E)
 * and reprojects every returned geometry to EPSG:4326, caps the feature count,
 * and reaches only the one upstream in js/danish-layers.config.js.
 *
 * Runtime adaptation: none of the logic — the reprojection maths, the Denmark
 * bbox window (w ≥ 2, e ≤ 22, s ≥ 53, n ≤ 59) and the 5-minute/1-hour cache
 * policy are the shared library's, imported unchanged.
 *
 * Environment variables:
 *   DANISH_PROXY_ALLOWED_ORIGINS     optional cross-origin allow-list
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import dkHeritage from '../../../netlify/functions/dk-heritage.mjs';

export const onRequest = adaptNetlifyFunction(dkHeritage, { route: '/api/geo/dk-heritage' });
