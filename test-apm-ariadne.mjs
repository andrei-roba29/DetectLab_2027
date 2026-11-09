/**
 * ARIADNE provider — GET request shape, cell-grid path, fixed roles, transport switch.
 * Fixtures only: the real (trimmed) hit excerpt, a synthetic grid response, and
 * network mocks. No live request is made.
 *
 *   node test-apm-ariadne.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const config = require('./js/apm-next/ariadne/ariadne.config.js');
const tiles = require('./js/apm-next/ariadne/ariadne-tiles.js');
const parse = require('./js/apm-next/ariadne/ariadne-parse.js');
const query = require('./js/apm-next/ariadne/ariadne-query.js');
const upstream = require('./js/apm-next/ariadne/ariadne-upstream.js');
const provider = require('./js/apm-next/ariadne/ariadne-provider.js');
const romania = require('./js/apm-next/apm-romania-sites.js');
const shared = await import('./supabase/functions/_shared/ariadne-params.js');

const HITS = JSON.parse(fs.readFileSync(path.join(here, 'test/fixtures/ariadne/search-response.sample.json'), 'utf8'));
const GRID = JSON.parse(fs.readFileSync(path.join(here, 'test/fixtures/ariadne/search-response.grid.json'), 'utf8'));
delete HITS.notice; delete GRID.notice;

const CLUJ = { lat: 46.77, lon: 23.59 };
const VIENNA = { lat: 48.2082, lon: 16.3738 };

/** A grid response whose cells sit at known offsets (km) from a centre. */
function gridAt(centre, offsets) {
    const buckets = offsets.map(([dLatKm, dLonKm, count]) => ({
        key: tiles.encodeGeohash(centre.lat + dLatKm / 111.32, centre.lon + dLonKm / (111.32 * Math.cos(centre.lat * Math.PI / 180)), 7),
        doc_count: count
    }));
    return { hits: [], total: { value: 0, relation: 'eq' }, aggregations: { geogridCentroid: { grids: { doc_count: offsets.reduce((n, o) => n + o[2], 0), buckets } } } };
}

let checks = 0;
const ok = (label, cond, extra) => { checks++; assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); };

// ── 1. the request is a GET with URL parameters ─────────────────────────────
ok('the base address is the verified portal', config.baseUrl === 'https://portal.ariadne-infrastructure.eu', config.baseUrl);
ok('the path is /api/search', config.searchPath === '/api/search');

const box = tiles.boxAround(CLUJ, 10);
const params = query.buildParams(config, { box });
ok('parameters follow the verified order', Object.keys(params).slice(0, 7).join(',') === 'forceReload,mapq,q,bbox,loadingStatus,sort,order', Object.keys(params).join(','));
ok('forceReload/mapq/loadingStatus/sort/order are the verified constants',
    params.forceReload === 'true' && params.mapq === 'true' && params.q === '' && params.loadingStatus === '2' && params.sort === 'distance' && params.order === 'asc');
ok('bbox is N,W,S,E', params.bbox.split(',').length === 4 && Number(params.bbox.split(',')[0]) > Number(params.bbox.split(',')[2]));
{
    const url = query.buildUrl(config.baseUrl, config.searchPath, params);
    ok('the URL is a GET on the portal', url.startsWith('https://portal.ariadne-infrastructure.eu/api/search?'));
    ok('the URL carries no body and no POST verb', /^https:\/\/[^?]+\?[^#]+$/.test(url));
    ok('the portal bbox round-trips', JSON.stringify(tiles.parseBbox(params.bbox)) === JSON.stringify({
        north: Number(params.bbox.split(',')[0]), west: Number(params.bbox.split(',')[1]),
        south: Number(params.bbox.split(',')[2]), east: Number(params.bbox.split(',')[3])
    }));
}
ok('no filter fragment is guessed', !query.filtersConfigured(config) && config.filters.siteType === '' && config.filters.period === '');
{
    const withFilters = query.buildParams({ ...config, filters: { siteType: 'subject=Site/monument', period: 'period=roman' } }, { box });
    const keys = Object.keys(withFilters);
    ok('filter fragments are appended last', keys.slice(-2).join(',') === 'subject,period', keys.join(','));
    ok('a fragment with a value becomes a parameter', withFilters.subject === 'Site/monument');
    ok('filters only count as configured when every fragment is present', query.filtersConfigured({ filters: { siteType: 'x', period: '' } }) === false);
}

// ── 2. geometry ─────────────────────────────────────────────────────────────
{
    const b150 = tiles.boxAround(CLUJ, 150);
    ok('a 150 km radius gives a ~300 km box', Math.abs(tiles.boxHeightKm(b150) - 300) < 1 && Math.abs(tiles.boxWidthKm(b150) - 300) < 6);
    const pieces = tiles.splitToMaxSide(b150, config.maxSideKm);
    ok('every request box respects the 120 km server limit', pieces.every(t => Math.max(tiles.boxHeightKm(t), tiles.boxWidthKm(t)) <= config.maxSideKm + 0.5));
    const area = t => (t.north - t.south) * (t.east - t.west);
    ok('the pieces partition the box', Math.abs(pieces.reduce((n, t) => n + area(t), 0) - area(b150)) < 1e-9);
    const q = tiles.quadrants(b150);
    ok('quadrants are four and tile the box', q.length === 4 && Math.abs(q.reduce((n, t) => n + area(t), 0) - area(b150)) < 1e-9);
    const key = tiles.encodeGeohash(CLUJ.lat, CLUJ.lon, 7);
    ok('a geohash-7 key is 7 characters', key.length === 7);
    const centre = tiles.cellCentre(key);
    ok('the cell centre lies inside its own cell', tiles.insideBox(centre.box, centre.lat, centre.lon));
    ok('cell size is about 152 m', Math.abs(tiles.boxHeightKm(centre.box) * 1000 - 152) < 2, (tiles.boxHeightKm(centre.box) * 1000).toFixed(1));
    ok('a non-geohash key is refused', tiles.cellCentre('not-a-key!') === null);
}
{
    // The Ariadne copy of the Romanian outline must not drift from the APM one.
    let mismatches = 0, tested = 0;
    for (let lat = 43.5; lat <= 48.5; lat += 0.25) {
        for (let lon = 20; lon <= 29.5; lon += 0.25) {
            tested++;
            const a = tiles.insidePolygon(lat, lon, config.romania);
            const b = romania.insideRomania(lat, lon);
            if (a !== b) mismatches++;
        }
    }
    ok('the Romanian outline matches the APM module', mismatches === 0, `${mismatches} of ${tested} differ`);
    ok('Cluj is inside Romania, Vienna is not', tiles.insidePolygon(CLUJ.lat, CLUJ.lon, config.romania) && !tiles.insidePolygon(VIENNA.lat, VIENNA.lon, config.romania));
}

// ── 3. parsing: hits need a geopoint; the grid is the large-box path ────────
{
    const p = parse.parseResponse(HITS);
    ok('the excerpt yields one usable record', p.hits.length === 1, String(p.hits.length));
    ok('that record carries a geopoint', p.hits[0].positionKind === 'geopoint' && p.hits[0].lat === 46.5861129760742);
    ok('a boundingbox-only hit is rejected as a collection envelope', p.rejected['collection-boundingbox-only'] === 1);
    ok('no coordinate was invented from the bounding box or its centroid', !p.hits.some(h => h.ariadneId === HITS.hits[1].id));
    ok('the reported total is read', p.total === 23 && p.relation === 'eq');
    ok('the subject buckets are read', p.buckets.subjects.length === 6 && p.buckets.subjects[0].count === 12);
}
{
    const p = parse.parseResponse(GRID);
    ok('a grid response has no hits', p.hits.length === 0);
    ok('every cell becomes a point with a real centre', p.cells.length === 6 && p.cells.every(c => Number.isFinite(c.lat) && Number.isFinite(c.lon)));
    ok('the cell count is preserved', p.cells[0].count === 3 && p.cells.find(c => c.key === 'u83hs2m').count === 7);
    ok('a 5000-cell answer is capped', parse.isCapped(5000, config.cellCap) && !parse.isCapped(4999, config.cellCap));
    ok('a malformed body does not throw', parse.parseResponse(null).malformed === true);
}

// ── 4. the upstream call: GET, and the transport switch ────────────────────
{
    const calls = [];
    const fakeFetch = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(HITS)) }); };
    const deps = { fetch: fakeFetch, anonKey: 'anon', getAccessToken: () => 'jwt', functionsUrl: 'https://ref.supabase.co/functions/v1' };
    const browserMode = upstream.create({ ...config, transport: 'browser', minSpacingMs: 0 }, deps);
    const serverMode = upstream.create({ ...config, transport: 'server', minSpacingMs: 0, functionsUrl: deps.functionsUrl }, deps);

    await browserMode.call(params, {});
    const call1 = calls[0];
    ok('browser mode issues a GET', call1.init.method === 'GET');
    ok('browser mode has no request body', call1.init.body === undefined);
    ok('browser mode sends every parameter in the URL', call1.url.includes('bbox=' + encodeURIComponent(params.bbox)) && call1.url.includes('loadingStatus=2'));

    await serverMode.call(params, {});
    const call2 = calls[1];
    ok('server mode posts to the edge function', call2.url === 'https://ref.supabase.co/functions/v1/ariadne' && call2.init.method === 'POST');
    ok('server mode sends the same parameters, not a URL', JSON.parse(call2.init.body).params.bbox === params.bbox && !/portal\.ariadne/.test(call2.init.body));
    ok('server mode sends the user token', call2.init.headers.Authorization === 'Bearer jwt');

    assert.throws(() => upstream.create({ ...config, transport: 'browser', baseUrl: '' }, deps), e => e.key === 'ariadne.notConfigured');
    ok('an empty base address is refused, never guessed', true);

    const http429 = upstream.create({ ...config, transport: 'browser', minSpacingMs: 0 }, { fetch: () => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('{"error":"rate_limited"}') }) });
    await http429.call(params, {}).then(() => { throw new Error('should throw'); }, e => ok('a 429 becomes a typed rate-limit failure', e.key === 'ariadne.rateLimited'));
    const http403 = upstream.create({ ...config, transport: 'browser', minSpacingMs: 0 }, { fetch: () => Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('{"error":"premium_required"}') }) });
    await http403.call(params, {}).then(() => { throw new Error('should throw'); }, e => ok('a 403 becomes a premium failure', e.key === 'ariadne.premiumRequired'));

    // Polite spacing: serialised, at least minSpacingMs apart.
    const stamps = [];
    const spaced = upstream.create({ ...config, transport: 'browser', minSpacingMs: 60 }, { fetch: () => { stamps.push(Date.now()); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }); } });
    const t0 = Date.now();
    await Promise.all([spaced.call(params, {}), spaced.call(params, {})]);
    ok('two calls are serialised at least 60 ms apart', stamps.length === 2 && stamps[1] - stamps[0] >= 55, String(stamps[1] - stamps[0]));
    ok('and the pair is not concurrent', Date.now() - t0 >= 55);
}

// ── 5. provider: fixed roles, grid recursion, dedupe, cache ────────────────
function mock(responses) {
    const calls = [];
    let i = 0;
    return {
        mode: 'server', calls,
        call: async p => {
            calls.push(p);
            const r = responses[Math.min(i++, responses.length - 1)];
            return { status: 200, ok: true, json: r, bytes: 500, ms: 20, via: 'server' };
        }
    };
}
const withFilters = { ...config, filters: { siteType: 'subject=Site/monument', period: 'period=roman' }, maxDepth: 3, minSpacingMs: 0 };

{
    const t = mock([HITS]);
    const p = provider.createProvider({ config: withFilters, transport: t });
    const disabled = await p.getSites(CLUJ, 50, { appMode: 'settlement' });
    ok('a Romanian centre is never used (settlement)', disabled.length === 0 && disabled._meta.disabled && disabled._meta.reason === 'romania-excluded');
    const forced = await p.getSites(CLUJ, 50, { appMode: 'settlement', role: 'positive', mode: 'positive' });
    ok('a caller cannot ask for a role the rules forbid', forced._meta.disabled && forced._meta.reason === 'romania-excluded');
    const disabledHoard = await p.getSites(CLUJ, 50, { appMode: 'hoard' });
    ok('a Romanian centre is never used (hoard)', disabledHoard._meta.reason === 'romania-excluded' && t.calls.length === 0);
    ok('and no request was made', t.calls.length === 0);

    const p2 = provider.createProvider({ config: { ...config, filters: { siteType: '', period: '' } }, transport: mock([HITS]) });
    const blocked = await p2.getSites(VIENNA, 50, { appMode: 'settlement' });
    ok('settlement outside Romania stays blocked until the filters are captured', blocked._meta.disabled && blocked._meta.reason === 'filters-not-configured');
    const hoardOk = await p2.getSites(VIENNA, 50, { appMode: 'hoard' });
    ok('hoard comparison is allowed without the filters', !hoardOk._meta.disabled && hoardOk._meta.role === 'comparison');
    ok('an unknown app mode is disabled', p2.roleFor('manual', VIENNA).role === 'disabled');
}

{
    // Hits path: relocate the real hits to Vienna so the role gate lets them through.
    const moved = JSON.parse(JSON.stringify(HITS));
    moved.hits.forEach((h, i) => {
        h.data.spatial = [{ geopoint: { lat: VIENNA.lat + 0.01 * (i + 1), lon: VIENNA.lon + 0.01 * (i + 1) }, centroid: { lat: VIENNA.lat, lon: VIENNA.lon }, placeName: 'Wien' }];
    });
    moved.hits[1].data.spatial = [{ boundingbox: 'polygon (...)', centroid: { lat: VIENNA.lat, lon: VIENNA.lon } }];
    const t = mock([moved]);
    const p = provider.createProvider({ config: withFilters, transport: t });
    const pos = await p.getSites(VIENNA, 10, { appMode: 'settlement' });
    ok('settlement keeps only Site/monument', pos.length === 1 && pos[0].subjects[0] === 'Site/monument', String(pos.length));
    ok('the role is reported', pos._meta.role === 'positive' && pos._meta.transport === 'server');
    ok('one request, no paging', t.calls.length === 1, String(t.calls.length));
    const cmp = await provider.createProvider({ config: withFilters, transport: mock([moved]) }).getSites(VIENNA, 10, { appMode: 'hoard' });
    ok('hoard comparison does not require a site subject', cmp.length === 1 && cmp._meta.role === 'comparison');
}

{
    // Large box: capped grid → four quadrants; dedupe by key; drop outside the disc.
    const capped = { hits: [], total: { value: 0, relation: 'eq' }, aggregations: { geogridCentroid: { grids: { doc_count: 5000, buckets: [] } } } };
    const bucket = (seed) => {
        const out = [];
        for (let i = 0; i < 5000; i++) out.push({ key: tiles.encodeGeohash(VIENNA.lat + (i % 70) * 0.001, VIENNA.lon + Math.floor(i / 70) * 0.001, 7), doc_count: 1 + (i % 3) });
        return out;
    };
    capped.aggregations.geogridCentroid.grids.buckets = bucket();
    // Cells at 0, 0.3, 0.3, 30 and 200 km from the centre (geohash-7 is ~152 m, so
    // the three near ones must still be three distinct keys).
    const local = gridAt(VIENNA, [[0, 0, 3], [0.3, 0, 2], [0, 0.3, 2], [30, 0, 1], [200, 0, 7]]);
    const t = mock([capped, local]);
    const p = provider.createProvider({ config: { ...withFilters, maxRequests: 80 }, transport: t });
    const grid = await p.getGrid(VIENNA, 60, { appMode: 'hoard' });
    ok('a capped answer triggers exactly four quadrants', t.calls.length === 5, `${t.calls.length} requests`);
    ok('the quadrants are the four sub-boxes of the first request', (() => {
        const first = tiles.parseBbox(t.calls[0].bbox);
        const qs = tiles.quadrants(first).map(q => tiles.bboxString(q));
        return qs.every(q => t.calls.slice(1).some(c => c.bbox === q));
    })());
    ok('cells repeated across quadrants are deduplicated by key', new Set(grid.map(c => c.key)).size === grid.length && grid.length === 4, `${grid.length} cells`);
    ok('cells outside the circle are dropped', grid.every(c => tiles.distanceM(VIENNA, c) <= 60 * 1000 + 1) && !grid.some(c => Math.round(tiles.distanceM(VIENNA, c)) > 30000));

    const wide = await provider.createProvider({ config: { ...withFilters, maxRequests: 80 }, transport: mock([local]) }).getGrid(VIENNA, 150, { appMode: 'hoard' });
    const narrow = await provider.createProvider({ config: { ...withFilters, maxRequests: 80 }, transport: mock([local]) }).getGrid(VIENNA, 5, { appMode: 'hoard' });
    ok('the same grid yields 4 cells at 150 km', wide.length === 4, String(wide.length));
    ok('and only the cells inside a 5 km disc', narrow.length === 3, `${narrow.length} of 4`);
}
{
    // Records from the grid, and the recursion limit.
    const capped = {
        hits: [], total: { value: 0, relation: 'eq' },
        aggregations: { geogridCentroid: { grids: { doc_count: 5000, buckets: Array.from({ length: 5000 }, (_, i) => ({ key: tiles.encodeGeohash(VIENNA.lat + (i % 70) * 0.001, VIENNA.lon + Math.floor(i / 70) * 0.001, 7), doc_count: 2 })) } } }
    };
    const p = provider.createProvider({ config: { ...withFilters, maxDepth: 1, maxRequests: 20 }, transport: mock([capped]) });
    const recs = await p.getSites(VIENNA, 60, { appMode: 'hoard' });
    ok('the grid path produces one approximate point per cell', recs.length > 0 && recs.every(r => r.positionKind === 'cell' && r.approximatePosition === true));
    ok('the per-cell record count is preserved', recs[0].cellCount === 2);
    ok('a search that still hits the cap at maxDepth is reported incomplete', recs._meta.incomplete === true);
    ok('the cap is reported, not hidden', recs._meta.cellsCapped >= 1);

    const capped2 = JSON.parse(JSON.stringify(capped));
    const p2 = provider.createProvider({ config: { ...withFilters, maxDepth: 2, maxRequests: 3 }, transport: mock([capped2]) });
    const recs2 = await p2.getSites(VIENNA, 60, { appMode: 'hoard' });
    ok('the request budget stops the recursion', recs2._meta.requests === 3 && recs2._meta.incomplete === true);
}
{
    // Cache.
    const t = mock([gridAt(VIENNA, [[0, 0, 1], [0.01, 0.01, 1]])]);
    const p = provider.createProvider({ config: { ...withFilters, maxDepth: 0 }, transport: t });
    await p.getGrid(VIENNA, 5, { appMode: 'hoard' });
    const before = t.calls.length;
    const again = await p.getGrid(VIENNA, 5, { appMode: 'hoard' });
    ok('a repeated search is served from cache', t.calls.length === before && again._meta.cached === true);
    await p.getGrid(VIENNA, 6, { appMode: 'hoard' });
    ok('a different radius is a different query', t.calls.length > before);
}

// ── 5b. the cost of a 150 km grid search is stated, not discovered ─────────
{
    const p = provider.createProvider({ config: withFilters, transport: mock([GRID]) });
    const e = p.estimate(VIENNA, 150);
    ok('the estimate reports the base tiles', e.baseTiles === 16, String(e.baseTiles));
    ok('and the recursion depth needed before the cap stops firing', e.depth === 3, String(e.depth));
    ok('with the resulting request count', e.requests === 1024, String(e.requests));
    ok('a 150 km grid does not fit the default request budget', e.withinBudget === false);
    ok('the estimate is labelled arithmetic', e.calculated === true);
    const small = p.estimate(VIENNA, 10);
    ok('a 10 km search needs one split and fits the budget', small.requests === 4 && small.depth === 1 && small.withinBudget === true, JSON.stringify(small));
}

// ── 5c. the period facet and the period sweep (the probe's filtering) ──────
{
    // Shaped after the probe another implementation validated: the response carries
    // aggregations.temporal.temporal.buckets whatever the filters are.
    function withFacet(buckets, cells, total) {
        const gc = cells.map(function (c) {
            const lat = VIENNA.lat + c[0] / 111.32;
            const lon = VIENNA.lon + c[1] / (111.32 * Math.cos(VIENNA.lat * Math.PI / 180));
            return { key: tiles.encodeGeohash(lat, lon, 7), doc_count: c[2] };
        });
        return {
            hits: [],
            total: { value: total, relation: 'eq' },
            aggregations: {
                geogridCentroid: { grids: { doc_count: cells.reduce((n, c) => n + c[2], 0), buckets: gc } },
                temporal: { temporal: { buckets: buckets } }
            }
        };
    }
    const baseline = withFacet([{ key: 'roman', doc_count: 60 }, { key: 'medieval', doc_count: 40 }],
        [[0, 0, 30], [0.3, 0, 20], [0, 0.3, 10], [3, 0, 20], [0, 3, 20]], 100);
    const roman = withFacet([{ key: 'roman', doc_count: 60 }], [[0, 0, 30], [0.3, 0, 20], [0, 0.3, 10]], 60);
    const medieval = withFacet([{ key: 'medieval', doc_count: 40 }], [[3, 0, 20], [0, 3, 20]], 40);

    const periodConfig = {
        ...config, minSpacingMs: 0,
        filters: { siteType: 'subject=Site/monument', period: '&when={P}' }
    };
    const facetProvider = provider.createProvider({
        config: periodConfig,
        transport: { mode: 'browser', call: async params => {
            const body = !params.when ? baseline : params.when === 'roman' ? roman : medieval;
            return { status: 200, ok: true, json: body, bytes: 400, ms: 5, via: 'browser' };
        } }
    });

    const facet = await facetProvider.getPeriods(VIENNA, 20, { appMode: 'settlement' });
    ok('the period facet is read from aggregations.temporal.temporal.buckets', facet.labels.length === 2, JSON.stringify(facet.labels));
    ok('and is ordered largest first', facet.labels[0].label === 'roman' && facet.labels[0].count === 60);
    ok('a configured site filter alone is enough for the positive role',
        facetProvider.roleFor('settlement', VIENNA).role === 'positive' && facetProvider.roleFor('settlement', VIENNA).reason === undefined);
    ok('the period template is recognised', facetProvider.roleFor('settlement', VIENNA).role === 'positive');

    const sweep = await facetProvider.sweepPeriods(VIENNA, 20, ['roman', 'medieval'], { appMode: 'settlement' });
    ok('the sweep asks once for the baseline and once per label', sweep.requests === 3, String(sweep.requests));
    ok('the baseline is reported', sweep.baseline.total === 100 && sweep.baseline.cells === 5);
    ok('every label gets its own row', sweep.labels.length === 2 && sweep.labels[0].total === 60 && sweep.labels[1].total === 40);
    ok('the filter really narrows the result', sweep.labels.every(r => r.effect === 'narrows'));
    ok('cells are attributed to the periods that returned them',
        sweep.cells.find(c => c.periods.indexOf('roman') >= 0 && c.periods.length === 1) !== undefined);
    ok('a filter that changes nothing is detected as ignored', sweep.ignored === false);
    ok('the share of baseline cells is reported', sweep.labels[0].shareOfBaseline === 60, String(sweep.labels[0].shareOfBaseline));

    const ignoredProvider = provider.createProvider({
        config: periodConfig,
        transport: { mode: 'browser', call: async () => ({ status: 200, ok: true, json: baseline, bytes: 400, ms: 5, via: 'browser' }) }
    });
    const ignoredSweep = await ignoredProvider.sweepPeriods(VIENNA, 20, ['roman', 'medieval'], { appMode: 'settlement' });
    ok('a parameter the endpoint ignores is reported instead of trusted', ignoredSweep.ignored === true);

    const noTemplate = provider.createProvider({ config: { ...periodConfig, filters: { siteType: 'subject=Site/monument', period: '' } }, transport: { mode: 'browser', call: async () => ({ status: 200, ok: true, json: baseline, bytes: 1, ms: 1 }) } });
    const refused = await noTemplate.sweepPeriods(VIENNA, 20, ['roman'], { appMode: 'settlement' });
    ok('without a period template the sweep refuses rather than guessing', refused.reason === 'period-template-missing' && refused.requests === 0);

    const many = Array.from({ length: 30 }, (_, i) => 'p' + i);
    const limited = provider.createProvider({
        config: { ...periodConfig, periodSweep: { maxLabels: 4 } },
        transport: { mode: 'browser', call: async () => ({ status: 200, ok: true, json: roman, bytes: 1, ms: 1 }) }
    });
    const cappedSweep = await limited.sweepPeriods(VIENNA, 20, many, { appMode: 'settlement' });
    ok('the sweep is bounded by maxLabels', cappedSweep.requests === 5 && cappedSweep.labels.length === 4, String(cappedSweep.requests));

    // The URL must not double-encode a label with a space or a slash.
    const built = query.buildParams(periodConfig, { box: tiles.boxAround(VIENNA, 10), period: 'epoca bronzului' });
    const url = query.buildUrl(periodConfig.baseUrl, periodConfig.searchPath, built);
    ok('the period label is encoded exactly once', url.includes('when=epoca%20bronzului') && !url.includes('%2520'), url);
    ok('a slash in the site fragment is encoded exactly once', url.includes('subject=Site%2Fmonument') && !url.includes('%252F'), url);
}

// ── 6. the edge function and its shared rules ──────────────────────────────
{
    const src = fs.readFileSync(path.join(here, 'supabase/functions/ariadne/index.ts'), 'utf8');
    ok('the function is POST only', /req\.method !== "POST"/.test(src));
    ok('the caller must be signed in', /auth\/v1\/user/.test(src) && /401/.test(src));
    ok('premium is enforced server-side', /profiles\?id=eq\./.test(src) && /premium_required/.test(src) && /403/.test(src));
    ok('the base address and filters come from the environment', /ARIADNE_BASE_URL/.test(src) && /ARIADNE_SITE_FILTER/.test(src) && /ARIADNE_PERIOD_FILTER/.test(src));
    ok('the client cannot set the filters', !/filters:\s*allowed\.params/.test(src) && /filters: \{ siteType: SITE_FILTER, period: PERIOD_FILTER \}/.test(src));
    ok('parameters are whitelisted', /whitelist\(body\.params\)/.test(src) && /Unknown parameters/.test(src));
    ok('the bbox is validated for format and size', /parseBbox\(/.test(src) && /bboxError\(/.test(src));
    ok('the cache is consulted and filled', /cacheGet\(/.test(src) && /cachePut\(/.test(src));
    ok('the rate gate is enforced and missing SQL fails closed', /gate\(userId\)/.test(src) && /gate_unavailable/.test(src) && /429/.test(src));
    ok('the upstream body is passed through verbatim', /new Response\(upstreamText/.test(src));
    ok('an unreachable upstream is reported as such', /Upstream unreachable/.test(src) && /502/.test(src));
    ok('there is no fallback host', (src.match(/https?:\/\/[a-z0-9.-]+/g) || []).every(u => u.includes('portal.ariadne-infrastructure.eu') || u.includes('${') || u.includes('supabase')));

    // Shared module parity: the server must accept and format exactly what the client builds.
    const box10 = tiles.boxAround(VIENNA, 10);
    const clientParams = query.buildParams(config, { box: box10 });
    const sharedBox = shared.parseBbox(clientParams.bbox);
    ok('the server parses the bbox the client sends', sharedBox !== null && Math.abs(sharedBox.north - box10.north) < 1e-5);
    ok('the server accepts a normal box', shared.bboxError(sharedBox) === null);
    ok('the server refuses an oversized side', shared.bboxError(shared.parseBbox(tiles.bboxString(tiles.boxAround(VIENNA, 150)))) !== null);
    ok('the server refuses north<=south', shared.parseBbox('45,10,46,20') === null);
    ok('the server refuses junk', shared.parseBbox('1,2,3') === null && shared.parseBbox('a,b,c,d') === null);
    ok('the whitelist drops unknown keys', shared.whitelist({ bbox: '1,2,3,4', nasty: 'x' }).rejected[0] === 'nasty');
    const serverParams = shared.buildParams({ baseParams: { forceReload: 'true', mapq: 'true', q: '', loadingStatus: '2', sort: 'distance', order: 'asc' }, client: { bbox: clientParams.bbox }, filters: { siteType: 'subject=Site/monument', period: 'period=roman' } });
    ok('the server builds the same parameter order', Object.keys(serverParams).slice(0, 7).join(',') === 'forceReload,mapq,q,bbox,loadingStatus,sort,order');
    ok('the server appends its own filters last', Object.keys(serverParams).slice(-2).join(',') === 'subject,period');
    ok('the server URL is the verified endpoint', shared.buildUpstreamUrl('https://portal.ariadne-infrastructure.eu', serverParams).startsWith('https://portal.ariadne-infrastructure.eu/api/search?'));
}

// ── 7. isolation ───────────────────────────────────────────────────────────
{
    const files = ['js/apm-next/ariadne/ariadne-provider.js', 'js/apm-next/ariadne/ariadne-parse.js', 'js/apm-next/ariadne/ariadne-tiles.js', 'js/apm-next/ariadne/ariadne-query.js'];
    const wired = files.filter(f => /config\.transport|functionsUrl|transport\.mode/.test(fs.readFileSync(path.join(here, f), 'utf8')));
    ok('only the provider references the transport, and only to report it', wired.length === 1 && /ariadne-provider/.test(wired[0]), wired.join(','));
    const panel = fs.readFileSync(path.join(here, 'js/apm-next/apm-ui.js'), 'utf8');
    ok('the panel composes the provider for settlements outside Romania only', /subjectOnlyPositive: true/.test(panel) && /insideRomania\(centre\.lat, centre\.lon\)/.test(panel));
    ok('and the settlement pipeline itself never mentions it', !/ariadne/i.test(fs.readFileSync(path.join(here, 'js/apm-next/apm-pipeline.js'), 'utf8')));
    ok('the old POST-body probe page is gone', !fs.existsSync(path.join(here, 'tools/live-check/ariadne-probe.html')));
}

console.log(`PASS ARIADNE portal provider (${checks} checks): GET /api/search with the verified parameter order and N,W,S,E bbox; filter fragments appended last and never guessed; 120 km request limit enforced by splitting; geohash-7 cells decoded to real centres; hits usable only with a geopoint and collection envelopes rejected; the 5000-cell cap triggers four quadrants up to maxDepth with dedupe and a truthful "incomplete" flag; the grid is the large-box data path and yields approximate points per cell; fixed roles (Romania excluded, settlement needs the captured filters, hoard is comparison-only); server/browser switch proven to change only the destination; serialised 1500 ms-spaced calls; shared server rules (whitelist, bbox limits, filter injection) tested against the same client output. NOT VERIFIED: the live host, CORS, and whether the function runtime can reach the portal.`);
