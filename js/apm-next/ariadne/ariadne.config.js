/*!
 * ARIADNE portal — configuration.
 *
 * VERIFIED FACTS this file encodes (operator, from their own browser, 2026-11-09):
 *   · GET https://portal.ariadne-infrastructure.eu/api/search with URL parameters.
 *   · Force-refresh search: forceReload=true&mapq=true&q=&bbox=<N>,<W>,<S>,<E>
 *     &loadingStatus=2&sort=distance&order=asc, filter fragments appended last.
 *   · Small boxes return every hit (no paging); a 2-hit sample was a trimmed sample.
 *   · Boxes above ~50 km return hits: [] and put the data in
 *     aggregations.geogridCentroid.grids.buckets — geohash-7 cells (~152 m),
 *     capped at exactly 5000. A 5000-cell answer is incomplete and must be split.
 *
 * UNVERIFIED, and deliberately empty: the subject/period filter fragments. They are
 * query strings captured in the portal, not values guessed here. While they are
 * empty, the settlement (positive) role stays blocked, as decided.
 */
(function (root) {
    'use strict';
    var config = {
        // ── transport ────────────────────────────────────────────────────────
        transport: 'server',                 // 'server' | 'browser'
        baseUrl: 'https://portal.ariadne-infrastructure.eu',
        searchPath: '/api/search',
        serverPath: '/ariadne',              // Supabase edge function slug
        functionsUrl: '',                    // resolved at runtime when empty

        timeoutMs: 20000,
        cacheTtlMs: 10 * 60 * 1000,
        minSpacingMs: 1500,                  // polite spacing; the server always enforces it

        // ── request ──────────────────────────────────────────────────────────
        baseParams: {
            forceReload: 'true',
            mapq: 'true',
            q: '',
            loadingStatus: '2',
            sort: 'distance',
            order: 'asc'
        },
        // Raw query fragments, appended in this order after the base parameters.
        // Empty = not captured yet = settlement mode stays blocked.
        // The site fragment is what makes a hit a settlement, and it is the one the
        // positive role requires. The period fragment is a TEMPLATE: it carries {P}
        // where the portal's own period label goes, e.g. '&when={P}'. The label is
        // URL-encoded once, never twice, and a template without a label is skipped
        // (a baseline request asks for every period).
        filters: {
            siteType: '',                    // e.g. '&<param>=<value>' captured in the portal
            period: ''                       // e.g. '&<param>={P}'
        },
        // One request per label, so the sweep is bounded by the label count.
        periodSweep: { maxLabels: 8 },

        // ── geometry ─────────────────────────────────────────────────────────
        maxSideKm: 120,                      // server-side bbox limit (about 120 km per side)
        maxRadiusKm: 150,
        cellPrecision: 7,                    // geohash-7 ≈ 152 m cells
        cellCap: 5000,                       // the portal's exact cap; == cap means incomplete
        maxDepth: 3,                         // quadrant recursion depth
        maxRequests: 64,                     // hard stop for one search
        scopeBoxes: false,                   // true: drop cell centres outside the requested tile too

        // ── roles (fixed, not user switches) ─────────────────────────────────
        // settlement mode + centre outside Romania → positive training sites
        // hoard mode      + centre outside Romania → known-site comparison only
        // any mode        + centre inside Romania  → never used
        // Settlement outside Romania may run with the subject filter only (Site/monument)
    // while the captured URL fragments are still missing. Off by default; the merged
    // outside-Romania provider turns it on and says so in its meta.
    subjectOnlyPositive: false,
    roles: { settlement: 'positive', hoard: 'comparison' },
        positiveSubjects: ['Site/monument'],   // the only subject that can train the model

        // Natural Earth Admin-0 1:110m outline of Romania, lon/lat pairs.
        // Same polygon as js/apm-next/apm-romania-sites.js; a parity test keeps them equal.
        romania: [[28.233554, 45.488283], [28.679779, 45.304031], [29.149725, 45.464925], [29.603289, 45.293308], [29.626543, 45.035391], [29.141612, 44.82021], [28.837858, 44.913874], [28.558081, 43.707462], [27.970107, 43.812468], [27.2424, 44.175986], [26.065159, 43.943494], [25.569272, 43.688445], [24.100679, 43.741051], [23.332302, 43.897011], [22.944832, 43.823785], [22.65715, 44.234923], [22.474008, 44.409228], [22.705726, 44.578003], [22.459022, 44.702517], [22.145088, 44.478422], [21.562023, 44.768947], [21.483526, 45.18117], [20.874313, 45.416375], [20.762175, 45.734573], [20.220192, 46.127469], [21.021952, 46.316088], [21.626515, 46.994238], [22.099768, 47.672439], [22.710531, 47.882194], [23.142236, 48.096341], [23.760958, 47.985598], [24.402056, 47.981878], [24.866317, 47.737526], [25.207743, 47.891056], [25.945941, 47.987149], [26.19745, 48.220881], [26.619337, 48.220726], [26.924176, 48.123264], [27.233873, 47.826771], [27.551166, 47.405117], [28.12803, 46.810476], [28.160018, 46.371563], [28.054443, 45.944586]]
    };

    if (typeof module === 'object' && module.exports) module.exports = config;
    else root.DetectLabAriadneConfig = config;
})(typeof self !== 'undefined' ? self : this);
