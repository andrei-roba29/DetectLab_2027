/*
 * functions/api/geo/asig-heritage.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/geo/asig-heritage?layer=<wfs layer>&bbox=west,south,east,north
 *
 * Netlify twin : netlify/functions/asig-heritage.mjs (imported verbatim below)
 * Shared logic : backend/src/lib/asig-heritage.mjs   (the Express route, the
 *                Netlify function and this Pages Function all call the same
 *                asigHeritageResponse(), so the bbox window over Albania, the
 *                layer allow-list, the 150-feature cap, the 2 MB body cap and
 *                the representative-point conversion cannot drift apart)
 * Netlify route: netlify.toml  /api/geo/asig-heritage → /.netlify/functions/asig-heritage
 *
 * Runtime adaptation: the library buffers the WFS answer with Buffer.from(chunk)
 * and Buffer.concat(…). Those are the only Node APIs on the path and
 * functions/_lib/runtime-shims.js guarantees them, so the file is imported
 * unchanged rather than forked.
 *
 * Method behaviour is the library's own and is preserved exactly: only GET is
 * accepted, OPTIONS and HEAD answer 405 method_not_allowed (that is also what
 * the Netlify deployment does — see test-cloudflare-functions.mjs).
 *
 * Environment variables: none.
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import asigHeritage from '../../../netlify/functions/asig-heritage.mjs';

export const onRequest = adaptNetlifyFunction(asigHeritage, { route: '/api/geo/asig-heritage' });
