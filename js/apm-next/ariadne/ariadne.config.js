/*!
 * ARIADNE provider for APM Next Gen — configuration.
 *
 * The ONE switch that decides where the upstream HTTP call happens:
 *
 *   transport: 'server'   → the browser calls a Supabase edge function, which
 *                           calls ARIADNE. Needs no CORS from the ARIADNE host.
 *   transport: 'browser'  → the browser calls ARIADNE directly. Needs the host
 *                           to send Access-Control-Allow-Origin for the app's
 *                           origin, otherwise the request never leaves.
 *
 * Nothing else in the provider changes with this flag: tiling, paging, parsing,
 * caching and the record shape are identical in both modes.
 *
 * VERIFICATION STATUS: none of this has been run against the live ARIADNE host.
 * `baseUrl` is deliberately EMPTY: the search endpoint is not invented here.
 * Set it (or set it on the server function) from a URL you have confirmed.
 */
(function (root) {
    'use strict';
    var config = {
        transport: 'server',          // 'server' | 'browser'
        baseUrl: '',                  // e.g. https://<ariadne-host>/api/.../search  — MUST be set
        serverPath: '/ariadne',       // Supabase edge function slug
        functionsUrl: '',             // e.g. https://<ref>.supabase.co/functions/v1 ; resolved at runtime if empty

        // Paging and tiling. A 150 km radius is split into tiles until each tile's
        // hit count fits under `pageSize * maxPages`.
        pageSize: 100,
        maxPages: 8,                  // per tile; hard cap on requests per tile
        maxTiles: 16,
        concurrency: 4,
        timeoutMs: 20000,
        cacheTtlMs: 10 * 60 * 1000,

        // Record selection.
        positiveSubjects: ['Site/monument'],      // what counts as a positive training site
        comparisonResourceTypes: ['dataset', 'collection'],
        excludeWithoutPoint: true,

        // Field names as seen in the real response excerpt of 2026-11-09.
        // These are the only ARIADNE-specific names in the code.
        fields: {
            cellAggregation: 'geogridCentroid',
            cellField: 'geogridCentroid',         // UNVERIFIED: filter field behind the aggregation
            pointField: 'spatial.geopoint',       // UNVERIFIED: geo filter field
            subject: 'ariadneSubject.prefLabel'
        }
    };
    if (typeof module === 'object' && module.exports) module.exports = config;
    else root.DetectLabAriadneConfig = config;
})(typeof self !== 'undefined' ? self : this);
