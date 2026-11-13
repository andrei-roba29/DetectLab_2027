/*
 * functions/api/geo/se-hojdmodell.js
 * ───────────────────────────────────────────────────────────────────────────
 * Cloudflare Pages Function for
 *   GET /api/geo/se-hojdmodell?SERVICE=WMS&REQUEST=GetMap&…   (no credentials)
 *
 * Netlify twin : netlify/functions/se-hojdmodell.mjs (imported verbatim below)
 * Netlify route: netlify.toml  /api/geo/se-hojdmodell → /.netlify/functions/se-hojdmodell
 *
 * Lantmäteriet's terrängskuggning WMS is a licensed, fee-based product that
 * answers 401 without credentials, and those credentials must never reach a
 * browser. The four allowed layer names, the allowed formats, the 1024 px image
 * cap and the parameter-stripping list all stay in the Netlify file.
 *
 * Runtime adaptation: Basic auth is built with
 * Buffer.from(user + ':' + password, 'utf8').toString('base64') and the OGC
 * exception is sniffed with buf.toString('utf8', 0, 2000) — both guaranteed by
 * runtime-shims.js — and the credentials are read from process.env, which the
 * shim binds to context.env. The adapter translates the Netlify CDN directive
 * into CDN-Cache-Control, so the 7-day tile pin survives the move.
 *
 * Environment variables (one of the two styles is MANDATORY for this route):
 *   LANTMATERIET_WMS_USER + LANTMATERIET_WMS_PASSWORD   (Geotorget consumer)
 *   LANTMATERIET_WMS_TOKEN                              (OAuth2 agreement)
 *   LANTMATERIET_WMS_URL                                (optional upstream override)
 */
import '../../_lib/runtime-shims.js';
import { adaptNetlifyFunction } from '../../_lib/pages-adapter.js';
import seHojdmodell from '../../../netlify/functions/se-hojdmodell.mjs';

export const onRequest = adaptNetlifyFunction(seHojdmodell, { route: '/api/geo/se-hojdmodell' });
