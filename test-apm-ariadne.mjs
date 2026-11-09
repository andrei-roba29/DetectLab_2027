/**
 * ARIADNE provider: parsing, tiling, paging, caching, and the transport switch.
 * Fixtures only — the real response excerpt plus a fake transport. No network.
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

const FIXTURE = JSON.parse(fs.readFileSync(path.join(here, 'test/fixtures/ariadne/search-response.sample.json'), 'utf8'));
delete FIXTURE.notice; // the fixture's provenance note is ours, not ARIADNE's

let checks = 0;
const ok = (label, cond, extra) => { checks++; assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); };
const CLUJ = { lat: 46.77, lon: 23.59 };

// ── 1. parsing the real response ─────────────────────────────────────────────
const parsed = parse.parseResponse(FIXTURE);
ok('the fixture yields one record per hit', parsed.hits.length === 2, String(parsed.hits.length));
ok('the reported total is read, not inferred from the page', parsed.total === 23 && parsed.relation === 'eq');
const site = parsed.hits[0];
ok('the site keeps its real title', site.name === 'Așezarea Coțofeni de la Săndulești - punct 1');
ok('the site keeps its point', site.lat === 46.5861129760742 && site.lon === 23.8044452667236);
ok('the site is a geopoint, not a centroid', site.positionKind === 'geopoint' && site.approximatePosition === false);
ok('the publisher is read from the array shape', site.publisher === 'National Heritage Institute - Romania');
ok('the subjects are read from prefLabel', site.subjects[0] === 'Site/monument');
ok('the record id is namespaced', site.id === 'ariadne:' + FIXTURE.hits[0].id);

const publication = parsed.hits[1];
ok('a bounding-box-only hit still gets the centroid it publishes', publication.lat === 53.878258313500005 && publication.positionKind === 'centroid');
ok('that hit is flagged approximate', publication.approximatePosition === true);
ok('no coordinate is invented from the bounding box', !/polygon/.test(JSON.stringify(publication)));

ok('the subject buckets survive', parsed.buckets.subjects.length === 6 && parsed.buckets.subjects[0].key === 'Fieldwork archive' && parsed.buckets.subjects[0].count === 12);
ok('the temporal buckets are nested one level down, and read correctly', parsed.buckets.temporal.some(b => b.key === 'roman' && b.count === 5));
ok('the cell buckets are read from aggregations.geogridCentroid.grids', parsed.buckets.cells.length === 4 && parsed.buckets.cells[0].key === 'u0q7058');

ok('a site/monument is a positive', parse.isPositive(site, ['Site/monument']) === true);
ok('an E-Publication is not a positive', parse.isPositive(publication, ['Site/monument']) === false);
ok('a record with no subject is never a positive', parse.isPositive({ ...site, subjects: [] }, ['Site/monument']) === false);
ok('a hit with no point is rejected, not placed at 0,0', parse.toRecord({ id: 'x', data: { title: { text: 'n' } } }).rejected === 'no-point');
ok('a hit with only a bounding box is rejected with its own reason', parse.toRecord({ id: 'y', data: { spatial: [{ boundingbox: 'polygon (...)' }] } }).rejected === 'bounding-box-only');
ok('an out-of-range point is refused', parse.toRecord({ id: 'z', data: { spatial: [{ geopoint: { lat: 999, lon: 0 } }] } }).rejected === 'no-point');
ok('a malformed response does not throw', parse.parseResponse(null).malformed === true);

// ── 2. tiling ────────────────────────────────────────────────────────────────
{
    const box = tiles.boxAround(CLUJ, 150);
    ok('150 km is about ±1.35° of latitude', Math.abs((box.north - box.south) / 2 - 1.347) < 0.01, String((box.north - box.south) / 2));
    ok('the box contains the centre', tiles.encloses(box, CLUJ.lat, CLUJ.lon));
    const one = tiles.splitBox(box, 1);
    ok('one tile when asked for one', one.length === 1);
    const eight = tiles.splitBox(box, 8);
    ok('splitting produces the requested tile count', eight.length === 8);
    ok('every tile sits inside the box', eight.every(t => t.south >= box.south && t.north <= box.north && t.west >= box.west && t.east <= box.east));
    const area = t => (t.north - t.south) * (t.east - t.west);
    const sum = eight.reduce((n, t) => n + area(t), 0);
    ok('the tiles partition the box with no gap and no overlap', Math.abs(sum - area(box)) < 1e-9, `${sum} vs ${area(box)}`);
    ok('splitting is deterministic', JSON.stringify(tiles.splitBox(box, 8)) === JSON.stringify(eight));
}
{
    const hash = tiles.encodeGeohash(CLUJ.lat, CLUJ.lon, 7);
    ok('geohash is 7 characters by default in this call', hash.length === 7);
    const back = tiles.decodeGeohash(hash);
    ok('the encoded cell contains the point', tiles.encloses(back, CLUJ.lat, CLUJ.lon));
    ok('a geohash cover of the 150 km box is refused when it would need too many cells',
        tiles.geohashCells(tiles.boxAround(CLUJ, 150), 5, 64).cells === null);
    ok('a coarser cover fits', Array.isArray(tiles.geohashCells(tiles.boxAround(CLUJ, 150), 2, 64).cells));
}

// ── 3. the query body ────────────────────────────────────────────────────────
{
    const box = { south: 45, north: 48, west: 22, east: 25 };
    const body = query.buildSearchBody({ box, from: 0, size: 100, aggregations: true, fields: config.fields });
    ok('the body carries paging', body.from === 0 && body.size === 100);
    ok('the body filters with a bounding box', body.query.bool.filter[0].geo_bounding_box['spatial.geopoint'].top_left.lat === 48);
    ok('aggregations are only requested when asked', Boolean(body.aggregations) && !query.buildSearchBody({ box, fields: config.fields }).aggregations);
    const cells = query.buildSearchBody({ cells: ['u0q7058'], from: 0, size: 10, fields: config.fields });
    ok('cell search replaces the bbox filter', JSON.stringify(cells.query.bool.filter[0].terms) === '{"geogridCentroid":["u0q7058"]}');
    ok('page count follows the reported total', query.pagesFor(23, 10, 8) === 3 && query.pagesFor(1000, 100, 8) === 8);
}

// ── 4. the transport switch ──────────────────────────────────────────────────
await (async () => {
    const calls = [];
    const fakeFetch = (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(FIXTURE)) }); };
    const deps = { fetch: fakeFetch, anonKey: 'anon', getAccessToken: () => 'jwt', functionsUrl: 'https://ref.supabase.co/functions/v1' };

    const serverMode = upstream.create({ ...config, transport: 'server', functionsUrl: deps.functionsUrl }, deps);
    const browserMode = upstream.create({ ...config, transport: 'browser', baseUrl: 'https://ariadne.example/search' }, deps);
    ok('the flag selects the mode', serverMode.mode === 'server' && browserMode.mode === 'browser');

    await Promise.all([
        serverMode.call({ path: '', method: 'POST', body: { size: 1 } }, {}),
        browserMode.call({ path: '', method: 'POST', body: { size: 1 } }, {})
    ]).then(([a, b]) => {
        const [serverCall, browserCall] = calls;
        ok('server mode posts to the edge function', serverCall.url === 'https://ref.supabase.co/functions/v1/ariadne');
        ok('server mode sends the user token, never an upstream key', serverCall.init.headers.Authorization === 'Bearer jwt' && !/ariadne\.example/.test(serverCall.url));
        ok('server mode wraps the same body', JSON.parse(serverCall.init.body).body.size === 1 && JSON.parse(serverCall.init.body).path === '');
        ok('browser mode posts straight to the host', browserCall.url === 'https://ariadne.example/search');
        ok('the two modes send the same search body', JSON.parse(serverCall.init.body).body.size === JSON.parse(browserCall.init.body).size);
        ok('the result shape is identical', a.via === 'server' && b.via === 'browser' && a.json.total.value === b.json.total.value);
        ok('bytes and timing are measured', a.bytes > 0 && typeof a.ms === 'number');

        assert.throws(() => upstream.create({ ...config, transport: 'browser', baseUrl: '' }, deps), e => e.key === 'ariadne.notConfigured');
        ok('browser mode refuses an empty endpoint instead of guessing one', true);

        const http500 = upstream.create({ ...config, transport: 'browser', baseUrl: 'https://x' }, { fetch: () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('{"message":"boom"}') }) });
        return http500.call({ path: '', method: 'POST', body: {} }, {}).then(
            () => { throw new Error('should have thrown'); },
            e => { ok('an upstream error becomes a typed failure', e.key === 'ariadne.http' && /500/.test(e.message)); }
        );
    }).then(() => {
        // A fetch that never answers but honours the abort signal, like the real one.
        const hangFetch = (url, init) => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
        const hang = upstream.create({ ...config, transport: 'browser', baseUrl: 'https://x', timeoutMs: 30 }, { fetch: hangFetch });
        return hang.call({ path: '', method: 'POST', body: {} }, {}).then(
            () => { throw new Error('should have thrown'); },
            e => { ok('a hung request times out as a network failure', e.key === 'ariadne.network' && /timed out/.test(e.message)); }
        );
    });
})();

// ── 5. the provider: paging, dedupe, disc filter, roles, cache ──────────────
await (async () => {
    const seen = [];
    const fakeTransport = {
        mode: 'server',
        call: (request, opts) => {
            seen.push(request.body);
            return Promise.resolve({ status: 200, ok: true, json: FIXTURE, bytes: 1234, ms: 40, via: 'server' });
        }
    };
    const p = provider.createProvider({ config: { ...config, pageSize: 10, maxPages: 8, maxTiles: 4, cacheTtlMs: 1000 }, transport: fakeTransport });
    ok('the provider exposes the SiteProvider interface', typeof p.getSites === 'function' && p.id === 'ariadne' && p.source === 'ARIADNE portal');

    const records = await p.getSites(CLUJ, 150);
    ok('only records inside the disc survive', records.length === 1, `${records.length}`);
    ok('that record is the Romanian site', records[0].ariadneId === FIXTURE.hits[0].id);
    ok('it carries its distance from the centre', records[0].distanceM > 20000 && records[0].distanceM < 30000, String(records[0].distanceM));
    ok('the far-away publication is excluded by the radius, not by its type', !records.some(r => r.ariadneId === FIXTURE.hits[1].id));

    const meta = records._meta;
    ok('the provider reports the transport it used', meta.transport === 'server');
    ok('the provider reports that nothing live was verified', meta.live === false && /Not verified/.test(meta.note));
    ok('paging: three pages were requested per tile', seen.filter(b => b.from === 0).length === 4 && seen.length === 12, `${seen.length} requests`);
    const froms = [...new Set(seen.map(b => b.from))].sort((a, b) => a - b);
    ok('the pages walk contiguous windows and never repeat one', JSON.stringify(froms) === '[0,2,4]', JSON.stringify(froms));
    ok('every page asks for the configured size', seen.every(b => b.size === 10));
    ok('an incomplete read is reported as truncated, not as a small result set', meta.truncated === true);
    ok('the request count and bytes are reported', meta.requests === seen.length && meta.bytes === seen.length * 1234);

    seen.length = 0;
    const again = await p.getSites(CLUJ, 150);
    ok('a repeated search is served from cache', seen.length === 0 && again._meta.cached === true && again.length === 1);

    seen.length = 0;
    const comparison = await p.getSites(CLUJ, 150, { mode: 'comparison' });
    ok('comparison mode is a separate cache entry and a separate query', seen.length > 0 && comparison.length === 1);
    ok('comparison still refuses to invent a point for the bounding-box hit', comparison.every(r => Number.isFinite(r.lat)));

    const counts = await p.getCounts(CLUJ, 150, { mode: 'comparison' });
    ok('counts expose the subject buckets', counts.subjects['Site/monument'] >= 4, JSON.stringify(counts.subjects));
    ok('counts expose the cell buckets', Object.keys(counts.cells).length >= 1);

    assert.rejects(() => p.getSites({ lat: 999, lon: 0 }, 150), e => e.key === 'ariadne.invalid');
    ok('an invalid centre is refused', true);

    // Partial failure must not look like a small result set.
    let n = 0;
    const flaky = provider.createProvider({
        config: { ...config, pageSize: 10, maxPages: 8, maxTiles: 4 },
        transport: { mode: 'server', call: () => { n++; return n === 2 ? Promise.reject(Object.assign(new Error('HTTP 429'), { key: 'ariadne.http' })) : Promise.resolve({ status: 200, ok: true, json: FIXTURE, bytes: 10, ms: 1 }); } }
    });
    return flaky.getSites(CLUJ, 150).then(
        () => { throw new Error('should have thrown'); },
        e => {
            ok('a failed tile fails the whole search', e.key === 'ariadne.http');
            ok('the failure carries partial-progress metadata', e.meta && e.meta.partial === true && e.meta.failures.length === 1);
        }
    );
})();

// ── 6. the edge function (static checks) ────────────────────────────────────
{
    const src = fs.readFileSync(path.join(here, 'supabase/functions/ariadne/index.ts'), 'utf8');
    ok('the function takes the upstream URL from the environment', /Deno\.env\.get\("ARIADNE_BASE_URL"\)/.test(src));
    ok('no upstream URL is hard-coded', !/https?:\/\/(?!\$\{)[a-z0-9.-]*ariadne/i.test(src));
    ok('no key is embedded', !/(sk-|eyJhbGciOi)/.test(src));
    ok('the browser cannot supply an absolute URL', /raw\.startsWith\("\/"\)/.test(src) && /includes\("\.\."\)/.test(src) && /\^\[a-z\]\+:/.test(src));
    ok('only POST is accepted', /req\.method !== "POST"/.test(src));
    ok('the caller must be signed in', /auth\/v1\/user/.test(src) && /401/.test(src));
    ok('an unreachable upstream is reported as such', /Upstream unreachable/.test(src) && /502/.test(src));
    ok('the upstream body is passed through, not re-shaped', /respText/.test(src) && /new Response\(respText/.test(src));
}

// ── 7. the switch really is isolated ────────────────────────────────────────
{
    const files = ['js/apm-next/ariadne/ariadne-provider.js', 'js/apm-next/ariadne/ariadne-parse.js', 'js/apm-next/ariadne/ariadne-tiles.js', 'js/apm-next/ariadne/ariadne-query.js'];
    const transportWords = files.filter(f => /config\.transport|functionsUrl|baseUrl|\btransport\.mode\b/.test(fs.readFileSync(path.join(here, f), 'utf8')));
    ok('only the provider references the transport, and only to report it', transportWords.length === 1 && /ariadne-provider/.test(transportWords[0]), transportWords.join(','));
    const panel = fs.readFileSync(path.join(here, 'js/apm-next/apm-ui.js'), 'utf8');
    ok('the panel is untouched by this work', !/ariadne/i.test(panel));
}

console.log(`PASS ARIADNE provider (${checks} checks): real response parsed (title, point vs centroid, publisher, subjects, buckets); no coordinate invented from a bounding box; positive vs comparison selection; 150 km box tiled with an exact partition; geohash cover refused when too fine; query body built in one place; server/browser transport switch proven to change only the destination, with typed http/network/not-configured failures; paging (contiguous windows, capped), dedupe, disc filter and cache; a failed tile fails the search instead of returning a plausible subset; edge function static contract; panel untouched. NOT VERIFIED: the live endpoint, its query DSL, CORS, and whether the server runtime can reach the host.`);
