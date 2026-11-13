/*
 * functions/api/geo/dk-orto.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/geo/dk-orto?service=WMS&request=GetMap&layer=<spring year>&…
 *
 * Netlify twin : netlify/functions/dk-orto.mjs (imported verbatim below)
 * Shared logic : backend/src/lib/danish-layers.mjs  → ortoResponse()
 * Netlify route: netlify.toml  /api/geo/dk-orto → /.netlify/functions/dk-orto
 *
 * Datafordeleren serves the GeoDanmark spring orthophoto only to an identified
 * service user (Tjenestebruger), so username/password are appended here as KVP
 * on the server-side URL. A caller's own username/password/user/passwd/apikey
 * are stripped by the shared forwardParams() before that, so a visitor can
 * neither borrow nor override the deployment's identity.
 *
 * Runtime adaptation: none of the logic — see functions/api/geo/dk-dtk25.js for
 * why the shared Danish library imports cleanly into the Workers runtime.
 *
 * Environment variables:
 *   DATAFORDELER_USERNAME            MANDATORY (DATAFORDELER_USER is the legacy alias)
 *   DATAFORDELER_PASSWORD            MANDATORY
 *   DANISH_PROXY_ALLOWED_ORIGINS     optional cross-origin allow-list
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import dkOrto from '../../../netlify/functions/dk-orto.mjs';

export const onRequest = adaptNetlifyFunction(dkOrto, { route: '/api/geo/dk-orto' });
