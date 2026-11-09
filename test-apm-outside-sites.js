'use strict';
// Outside-Romania settlement sources: DARE and ARIADNE, merged so that a place
// attested by both catalogues appears once. Network is mocked; nothing live.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const here = __dirname;

const merge = require(path.join(here, 'js/apm-next/apm-site-merge.js'));
const dare = require(path.join(here, 'js/apm-next/apm-dare-sites.js'));
const outside = require(path.join(here, 'js/apm-next/apm-outside-sites.js'));
const sites = require(path.join(here, 'js/apm-next/apm-sites.js'));
const romania = require(path.join(here, 'js/apm-next/apm-romania-sites.js'));

let checks = 0;
function ok(name, condition, detail) {
    checks++;
    if (!condition) assert.fail(detail === undefined ? name : `${name} — ${detail}`);
}

const VIENNA = { lat: 48.2082, lon: 16.3738 };

// ── 1. the merge ────────────────────────────────────────────────────────────
{
    const dareRec = { id: 'dare:1', name: 'Vindobona', ancientName: null, lat: 48.2082, lon: 16.3738, source: 'dare', sourceIds: { dare: '1' } };
    const ariRec = { id: 'ariadne:abc', name: 'Vindobona', ancientName: null, lat: 48.2087, lon: 16.3741, source: 'ariadne', sourceIds: { ariadne: 'abc' } };
    const merged = merge.merge([{ source: 'dare', records: [dareRec] }, { source: 'ariadne', records: [ariRec] }]);
    ok('the same place from both catalogues becomes one record', merged.records.length === 1, String(merged.records.length));
    ok('and keeps both attestations', JSON.stringify(merged.records[0].sources) === '["dare","ariadne"]');
    ok('the preferred source supplies the surviving record', merged.records[0].id === 'dare:1');
    ok('the panel can say how many places were attested twice', merged.stats.merged === 1);
    ok('and the overlap is reported with its reason', merged.stats.overlaps[0].reason === 'proximity+name');

    const sameNameFarApart = { id: 'dare:2', name: 'Vindobona', lat: 48.2082, lon: 16.9, source: 'dare', sourceIds: { dare: '2' } };
    const two = merge.merge([{ source: 'dare', records: [dareRec, sameNameFarApart] }]);
    ok('same name 40 km away is a different place', two.records.length === 2, String(two.records.length));

    const nearDifferentName = { id: 'ariadne:def', name: 'Canabae', lat: 48.2083, lon: 16.3739, source: 'ariadne', sourceIds: { ariadne: 'def' } };
    const three = merge.merge([{ source: 'dare', records: [dareRec] }, { source: 'ariadne', records: [nearDifferentName] }]);
    ok('two different names 10 m apart stay two places', three.records.length === 2, String(three.records.length));

    const idA = { id: 'dare:3', name: 'Carnuntum', lat: 48.11, lon: 16.86, source: 'dare', pleiadesId: '197584', sourceIds: { dare: '3' } };
    const idB = { id: 'ariadne:ghi', name: 'Carnuntum (Petronell)', lat: 48.115, lon: 16.87, source: 'ariadne', pleiadesId: '197584', sourceIds: { ariadne: 'ghi' } };
    const four = merge.merge([{ source: 'dare', records: [idA] }, { source: 'ariadne', records: [idB] }]);
    ok('a shared Pleiades id merges even when the names differ', four.records.length === 1 && four.stats.overlaps[0].reason === 'identifier');
    ok('the merged record keeps every alias for later display', four.records[0].aliases.indexOf('Carnuntum (Petronell)') >= 0, JSON.stringify(four.records[0].aliases));

    const empty = merge.merge([{ source: 'dare', records: [] }, { source: 'ariadne', records: [] }]);
    ok('nothing in, nothing out', empty.records.length === 0 && empty.stats.merged === 0);
    ok('records without coordinates are never carried through', merge.merge([{ source: 'dare', records: [{ id: 'x', name: 'x' }] }]).records.length === 0);
}

// ── 2. DARE ─────────────────────────────────────────────────────────────────
{
    const box = dare.bboxFor(VIENNA, 50);
    ok('the DARE bbox covers the radius', Math.abs((box.north - VIENNA.lat) - 50 / 111.32) < 1e-9 && box.north > box.south && box.east > box.west);
    const url = dare.buildUrl(box, dare.zoomFor(box));
    ok('the URL is the endpoint the map layer uses', url.startsWith('https://imperium.ahlfeldt.se/api/geojson.php?bbox='), url);
    ok('with bbox order west,south,east,north', /bbox=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/.test(url) &&
        Number(RegExp.$1) < Number(RegExp.$3) && Number(RegExp.$2) < Number(RegExp.$4));
    ok('and a zoom the service accepts', /&zoom=(7|8|9|10)$/.test(url), url);
    ok('a 10 km area asks for more detail than a 100 km one',
        dare.zoomFor(dare.bboxFor(VIENNA, 5)) >= dare.zoomFor(dare.bboxFor(VIENNA, 50)));

    const collection = {
        type: 'FeatureCollection',
        features: [
            { type: 'Feature', id: '413123', geometry: { type: 'Point', coordinates: [16.37, 48.21] }, properties: { name: 'Vindobona', ancient: '', numType: 13, country: 'Austria' } },
            { type: 'Feature', id: '417777', geometry: { type: 'Point', coordinates: [16.86, 48.11] }, properties: { name: 'Carnuntum', ancient: 'Karnounton', numType: 11, pid: '197584' } },
            { type: 'Feature', id: '419999', geometry: { type: 'Point', coordinates: [16.4, 48.2] }, properties: { name: 'A fort', numType: 18 } },
            { type: 'Feature', id: '418888', geometry: { type: 'LineString', coordinates: [[16, 48], [17, 49]] }, properties: { name: 'A road', numType: 55 } }
        ]
    };
    const parsed = dare.parse(collection, [11, 12, 13, 14]);
    ok('only settlement categories survive', parsed.records.length === 2, `${parsed.records.length} kept`);
    ok('the fort and the line are counted as dropped', parsed.dropped === 2);
    ok('records carry the TRAIN record shape', parsed.records.every(r => r.type === 'settlement' && r.positionAccuracy === 50 && r.approximatePosition === false));
    ok('the ancient name is preserved when the service publishes one', parsed.records[1].ancientName === 'Karnounton');
    ok('no date is invented', parsed.records.every(r => r.periods.length === 0 && r.periodSource === 'unknown'));
    ok('the DARE id is namespaced so it cannot collide with another source', parsed.records[0].id === 'dare:413123');
    ok('a published pid is used as a Pleiades id, otherwise none is invented',
        parsed.records[1].pleiadesId === '197584' && parsed.records[0].pleiadesId === null);

    const records = sites.filterSites(parsed.records, { center: VIENNA, radiusKm: 50, period: null, dedupeM: -1 });
    ok('the DARE records pass the TRAIN filter unchanged', records.sites.length === 2, JSON.stringify(records.dropped));
}

// ── 3. the composed outside provider ────────────────────────────────────────
function mockDare(records) {
    return { getSites: async () => { const list = records.slice(); list._meta = { received: records.length }; return list; } };
}
function mockAriadne(records, options = {}) {
    return {
        getSites: async () => {
            if (options.throw) throw new Error('portal unreachable (CORS)');
            const list = (options.perTile ? options.perTile : records).slice();
            list._meta = { requests: 1, mode: 'browser' };
            return list;
        }
    };
}

(async () => {
    const dareRecords = [
        { id: 'dare:1', name: 'Vindobona', lat: 48.2082, lon: 16.3738, source: 'dare', type: 'settlement' },
        { id: 'dare:2', name: 'Carnuntum', lat: 48.11, lon: 16.86, source: 'dare', type: 'settlement' },
        { id: 'dare:3', name: 'Aquincum', lat: 47.55, lon: 19.05, source: 'dare', type: 'settlement' }
    ];
    const ariadneRecords = [
        { id: 'ariadne:a', ariadneId: 'a', name: 'Vindobona', lat: 48.2085, lon: 16.374, positionKind: 'geopoint', type: 'Site/monument' },
        { id: 'ariadne:b', ariadneId: 'b', name: 'Celamantia', lat: 47.8, lon: 18.3, positionKind: 'geopoint', type: 'Site/monument' },
        { id: 'ariadne:c', ariadneId: 'c', name: 'Vindobona', lat: 48.2086, lon: 16.3741, positionKind: 'cell', type: 'Site/monument' }
    ];

    const provider = outside.createProvider({ dare: mockDare(dareRecords), ariadne: mockAriadne(ariadneRecords) });
    const merged = await provider.getSites(VIENNA, 50);

    ok('a place in both catalogues is returned once', merged.length === 4, `${merged.length} records`);
    ok('the merged record names both sources', merged.find(r => r.name === 'Vindobona').sources.join(',') === 'dare,ariadne');
    ok('the ARIADNE-only site is present', merged.some(r => r.name === 'Celamantia'));
    ok('density cells are never turned into sites', !merged.some(r => r.id === 'ariadne:c'));
    ok('the meta says one place was merged', merged._meta.merged === 1);
    ok('the meta reports each source separately', merged._meta.sources.dare.records === 3 && merged._meta.sources.ariadne.records === 2);
    ok('and marks the answer complete', merged._meta.incomplete === false);
    const filtered = sites.filterSites(merged, { center: VIENNA, radiusKm: 50, period: null, dedupeM: -1 });
    ok('the TRAIN filter keeps the sites inside the radius', filtered.sites.length === 2, `${filtered.sites.length} kept`);
    ok('and drops nothing for type or position quality', filtered.dropped.type === 0 && filtered.dropped.accuracy === 0, JSON.stringify(filtered.dropped));
    ok('the two far sites are dropped only for distance', filtered.dropped.outside === 2);

    const dareOnly = await outside.createProvider({ dare: mockDare(dareRecords), ariadne: mockAriadne([], { throw: true }) }).getSites(VIENNA, 50);
    ok('a dead ARIADNE leaves the DARE sites in place', dareOnly.length === 3);
    ok('and is named as unavailable instead of silently returning zero', dareOnly._meta.incomplete === true && /CORS/.test(dareOnly._meta.sources.ariadne.error));

    const none = await outside.createProvider({ dare: mockDare([]), ariadne: mockAriadne([]) }).getSites(VIENNA, 50);
    ok('two empty catalogues give an empty, complete answer', none.length === 0 && none._meta.incomplete === false);

    const inside = await outside.createProvider({ dare: mockDare(dareRecords), ariadne: mockAriadne(ariadneRecords) }).getSites({ lat: 46.77, lon: 23.59 }, 50);
    ok('inside Romania neither catalogue is queried', inside.length === 0 && inside._meta.region === 'romania');
    ok('and the Romanian path is left to the national repertory', inside._meta.outsideRomania === false);

    // ── 4. tiling keeps ARIADNE in hits mode ────────────────────────────────
    const big = outside.tilesFor(VIENNA, 50, outside.CONFIG);
    ok('a 50 km area is cut into 9 ARIADNE requests', big.length === 9, String(big.length));
    ok('every tile stays below the portal\'s hits threshold', big.every(t => t.radiusKm * 2 * outside.CONFIG.ariadneRadiusPad <= 50));
    ok('the tiles cover the centre', big.some(t => Math.abs(t.centre.lat - VIENNA.lat) < 1e-9 && Math.abs(t.centre.lon - VIENNA.lon) < 1e-9));
    const small = outside.tilesFor(VIENNA, 10, outside.CONFIG);
    ok('a 10 km area needs one ARIADNE request', small.length === 1, String(small.length));

    let tileCalls = 0;
    const tiled = outside.createProvider({
        dare: mockDare(dareRecords),
        ariadne: { getSites: async () => { tileCalls++; return Object.assign([], { _meta: { requests: 1 } }); } }
    });
    await tiled.getSites(VIENNA, 50);
    ok('the provider really asks ARIADNE once per tile', tileCalls === 9, String(tileCalls));

    // ── 5. ARIADNE role: subject-only, and only outside Romania ─────────────
    const ariadneProvider = require(path.join(here, 'js/apm-next/ariadne/ariadne-provider.js'));
    const ariadneConfig = require(path.join(here, 'js/apm-next/ariadne/ariadne.config.js'));
    const transport = { call: async () => { throw new Error('not called here'); }, mode: 'browser' };
    const strictConfig = Object.assign({}, ariadneConfig, { subjectOnlyPositive: false });
    const strictProvider = ariadneProvider.createProvider({ config: strictConfig, transport });
    ok('without the captured filters, settlement stays disabled by default',
        strictProvider.roleFor('settlement', VIENNA).reason === 'filters-not-configured');
    const subjectProvider = ariadneProvider.createProvider({ config: Object.assign({}, ariadneConfig, { subjectOnlyPositive: true }), transport });
    ok('the opt-in subject-only role is positive outside Romania', subjectProvider.roleFor('settlement', VIENNA).role === 'positive');
    ok('and is labelled as subject-only', subjectProvider.roleFor('settlement', VIENNA).subjectOnly === true);
    ok('Romania stays excluded even with the opt-in', subjectProvider.roleFor('settlement', { lat: 46.77, lon: 23.59 }).reason === 'romania-excluded');

    console.log(`PASS outside-Romania sources (${checks} checks): DARE bbox/zoom/URL from the contract the map already uses; settlement categories only; no invented dates; ARIADNE in subject-only mode and never inside Romania; the training disc cut so the portal answers with hits, not a density grid; and the two catalogues merged so a place attested by both is shown once, with every source, overlap and failure reported. Live hosts and CORS: NOT VERIFIED.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
