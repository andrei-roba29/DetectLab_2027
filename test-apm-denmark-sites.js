// Node test harness for the Danish TRAIN site source (apm-next/apm-denmark-sites.js)
// and its wiring into the hoard period picker + the site filters.
// Usage: node test-apm-denmark-sites.js
'use strict';

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('  \u2714 ' + name);
    else { failures++; console.error('  \u2718 ' + name + (extra !== undefined ? ' \u2014 ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const DK = require('./js/apm-next/apm-denmark-sites.js');
const sites = require('./js/apm-next/apm-sites.js');
const hoards = require('./js/apm-next/apm-hoards.js');
const hoardProvider = require('./js/apm-next/apm-hoard-provider.js');
const hoardConfig = require('./js/apm-next/hoards.config.js');

const AARHUS = { lat: 56.1629, lon: 10.2039 };
const CLUJ = { lat: 46.7712, lon: 23.6236 };

/* ── 1. regions ─────────────────────────────────────────────────────────── */
section('Region');
{
    check('Aarhus is inside Denmark', DK.insideDenmark(AARHUS.lat, AARHUS.lon) === true);
    check('Cluj is not', DK.insideDenmark(CLUJ.lat, CLUJ.lon) === false);
    check('the North Sea is not', DK.insideDenmark(56.0, 3.0) === false);
    check('Bornholm is inside', DK.insideDenmark(55.10, 14.90) === true);
    // The potential layer and the map catalogue use the same box; if one moves,
    // TRAIN would answer a different country than the map.
    const pot = read('js/archeo-dk-source.js');
    // REGIONS.DK in js/archeo-dk-source.js; the RO box comes first in that file.
    const dkRegion = pot.slice(pot.indexOf('DK: {'));
    const m = dkRegion.match(/bounds:\s*\[\[([\d.]+),\s*([\d.]+)\],\s*\[([\d.]+),\s*([\d.]+)\]\]/);
    const parsed = m && [[Number(m[1]), Number(m[2])], [Number(m[3]), Number(m[4])]];
    check('the archaeological layers use the same Danish box',
        !!parsed && JSON.stringify(parsed) === JSON.stringify(DK.CONFIG.bounds),
        parsed && JSON.stringify(parsed));
}

/* ── 2. the WFS URL ─────────────────────────────────────────────────────── */
section('WFS request');
{
    const bbox = DK.bboxFor(AARHUS, 50);
    check('a 50 km window spans ~100 km', (bbox[2] - bbox[0]) * 111320 * Math.cos(AARHUS.lat * Math.PI / 180) >= 99000,
        ((bbox[2] - bbox[0]) * 111320).toFixed(0));
    const url = DK.featureUrl('public:fundogfortidsminder_punkt_ikkefredet', bbox, "anlaegstype ILIKE '%mønt%'", 2000);
    check('the URL names the service and the layer',
        url.indexOf('https://www.kulturarv.dk/ffgeoserver/public/wfs?') === 0 &&
        url.indexOf('typeNames=public%3Afundogfortidsminder_punkt_ikkefredet') !== -1);
    check('it asks for WFS 2.0 GeoJSON in EPSG:4326',
        /version=2\.0\.0/.test(url) && /outputFormat=application\/json/.test(url) && /srsName=EPSG:4326/.test(url));
    check('the bbox is written W,S,E,N with the CRS suffix',
        url.indexOf('bbox=' + bbox.map(v => v.toFixed(6)).join(',') + ',EPSG:4326') !== -1);
    check('the feature cap is sent', /&count=2000(&|$)/.test(url));
    check('the CQL filter is percent-encoded (ø survives as UTF-8)',
        url.indexOf("CQL_FILTER=anlaegstype%20ILIKE%20'%25m%C3%B8nt%25'") !== -1,
        url.slice(url.indexOf('CQL_FILTER=')));
}

/* ── 3. dating ──────────────────────────────────────────────────────────── */
section('Dating from the register’s own text');
{
    const cases = [
        ['Jernalder', ['jernalder']],
        ['Romersk jernalder', ['romersk']],
        ['Germansk jernalder', ['germansk']],
        ['Førromersk jernalder', ['foerromersk']],
        ['Vikingetid', ['vikingetid']],
        ['Middelalder', ['middelalder']],
        ['Bronzealder', ['bronzealder']],
        ['Stenalder', ['stenalder']],
        ['Historisk Tid', ['nyere']],
        ['Oldtid', ['oldtid']],
        ['Udateret', []],
        ['', []],
        [null, []]
    ];
    cases.forEach(function (c) {
        const got = DK.periodsFor(c[0]).map(p => p.key);
        check('“' + (c[0] === null ? '(null)' : c[0]) + '” → ' + (c[1].join(',') || 'undated'),
            JSON.stringify(got) === JSON.stringify(c[1]), JSON.stringify(got));
    });
    const roman = DK.periodsFor('Romersk jernalder')[0];
    check('a mapped period carries a bounded year range',
        roman.start === 1 && roman.end === 400 && roman.label === 'Romersk jernalder');
    check('an unknown word never becomes a date', DK.periodsFor('Mystisk periode').length === 0);
}

/* ── 4. records: one point per locality ─────────────────────────────────── */
section('Records');
{
    const features = [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [10.2, 56.16] },
          properties: { anlaegstype: 'Kulturlag', datering: 'Jernalder', stednr: '010101', loknr: 1, url: 'http://x/1' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [10.2004, 56.1601] },
          properties: { anlaegstype: 'Affaldsgrube', datering: 'Jernalder', stednr: '010101', loknr: 2, url: '' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [10.21, 56.17] },
          properties: { anlaegstype: 'Depotfund', datering: 'Vikingetid', stednr: '010102', loknr: 1 } },
        { type: 'Feature', geometry: null, properties: { anlaegstype: 'Kulturlag', stednr: '010103' } }
    ];
    const records = DK.toRecords(features, 'settlements');
    check('three features of two localities → two records', records.length === 2, records.length);
    const first = records.filter(r => r.stednr === '010101')[0];
    check('the repeated locality keeps both feature types',
        first.featureCount === 2 && first.featureTypes.length === 2,
        JSON.stringify(first.featureTypes));
    check('its type is a settlement for the TRAIN filter', first.type === 'settlement');
    check('it carries the register url when the register has one', first.url === 'http://x/1', first.url);
    check('the position accuracy is a number the filters accept', first.positionAccuracy === 50);
    check('periods are exposed both ways',
        first.periodGroups.indexOf('jernalder') !== -1 && first.periodLabel === 'Jernalder',
        JSON.stringify({ groups: first.periodGroups, label: first.periodLabel }));
    check('a feature without geometry is dropped, not guessed', !records.some(r => r.stednr === '010103'));

    const hoardRecords = DK.toRecords(features.slice(2, 3), 'hoards');
    check('a deposit becomes a hoard record', hoardRecords[0].type === 'hoard');
    check('its hoardType comes from the register value',
        hoardRecords[0].hoardType === 'Depotfund', hoardRecords[0].hoardType);

    const filtered = sites.filterSites(records, { center: AARHUS, radiusKm: 50, period: null, dedupeM: 50 });
    check('the TRAIN site filters keep every record', filtered.sites.length === records.length,
        JSON.stringify(filtered.dropped));
    // A window inside the Viking Age that sits clear of the Iron Age envelope
    // (jernalder ends at 800), so the test reads the dating, not the overlaps.
    const byPeriod = sites.filterSites(records, { center: AARHUS, radiusKm: 50,
        period: { label: 'Vikingetid', start: 900, end: 1050 }, dedupeM: 50 });
    check('a period filter keeps only the matching locality', byPeriod.sites.length === 1 &&
        byPeriod.sites[0].stednr === '010102', JSON.stringify(byPeriod.sites.map(s => s.stednr)));
}

/* ── 5. provider against a mocked register ─────────────────────────────── */
function jsonResponse(features) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
        type: 'FeatureCollection', features: features, totalFeatures: features.length
    }) });
}

function settlementFeature(stednr, type, dating, lat, lon) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { anlaegstype: type, datering: dating, stednr: stednr, url: 'http://k/' + stednr } };
}

(async () => {
    section('Provider — settlements');
    {
        const calls = [];
        const fetchStub = function (url) {
            calls.push(url);
            if (url.indexOf('kulturlag') !== -1) return jsonResponse([settlementFeature('A1', 'Kulturlag', 'Jernalder', 56.16, 10.2)]);
            if (url.indexOf('grube') !== -1) return jsonResponse([
                settlementFeature('A1', 'Affaldsgrube', 'Jernalder', 56.1601, 10.2001),
                settlementFeature('A2', 'Kogegrube', 'Bronzealder', 56.17, 10.21)
            ]);
            return jsonResponse([]);
        };
        const provider = DK.createProvider({ fetch: fetchStub });
        const records = await provider.getSites(AARHUS, 50);
        check('every filter × layer is requested (4 × 2)', calls.length === 8, calls.length);
        check('the register gives two localities', records.length === 2, records.length);
        check('all records are settlements', records.every(function (r) { return r.type === 'settlement'; }));
        check('the meta names Denmark', records._meta.region === 'denmark');
        check('the meta names the source', records._meta.provider === 'Fund og Fortidsminder');
        check('the meta keeps the CC0 attribution', /CC0/.test(records._meta.attribution));
        // The mock answers on both point layers, so each filter's features arrive twice.
        check('the meta counts the register features', records._meta.featureCount === 6, records._meta.featureCount);
        check('the meta lists what each filter returned',
            records._meta.featureTypes.kulturlag === 2 && records._meta.featureTypes.grube === 4,
            JSON.stringify(records._meta.featureTypes));
        check('nothing is truncated and nothing failed',
            records._meta.truncated === false && records._meta.incomplete === false);
    }

    section('Provider — the register fails');
    {
        let n = 0;
        const provider = DK.createProvider({ fetch: function () { n++; return Promise.reject(new Error('HTTP 503')); } });
        const records = await provider.getSites(AARHUS, 50);
        check('a dead register gives no records', records.length === 0);
        check('every failed query is counted', records._meta.sources.register.failed === 8, records._meta.sources.register.failed);
        check('the meta marks the load incomplete, not empty', records._meta.incomplete === true);
        check('the failure reason travels', /503/.test((records._meta.sources.register.errors || []).join(' ')));
        check('a failed source is never retried in a loop', n === 8, n);
    }

    section('Provider — hoards');
    {
        const calls = [];
        const fetchStub = function (url) {
            calls.push(decodeURIComponent(url));
            if (url.indexOf('depotfund') !== -1) return jsonResponse([
                settlementFeature('H1', 'Depotfund', 'Bronzealder', 56.16, 10.2),
                settlementFeature('H1', 'Depotfund', 'Bronzealder', 56.1602, 10.2002)
            ]);
            if (url.indexOf('m%C3%B8nt') !== -1) return jsonResponse([
                settlementFeature('H2', 'Møntfund', 'Vikingetid', 56.2, 10.3)
            ]);
            return jsonResponse([]);
        };
        const provider = DK.createProvider({ fetch: fetchStub });
        const records = await provider.getHoards(AARHUS, 150);
        check('only the two hoard filters are asked', calls.length === 4, calls.length);
        check('no query mentions Enkeltfund (a single find is not a hoard)',
            !calls.some(function (u) { return /enkeltfund/i.test(u); }), calls.join(' | '));
        check('two hoard localities', records.length === 2, records.length);
        check('every record is a hoard', records.every(function (r) { return r.type === 'hoard'; }));
        check('the coin find is typed as Møntfund',
            records.filter(function (r) { return r.stednr === 'H2'; })[0].hoardType === 'Møntfund');
        check('the deposit is typed as Depotfund',
            records.filter(function (r) { return r.stednr === 'H1'; })[0].hoardType === 'Depotfund');
        check('the meta is the hoard category', records._meta.category === 'hoards');
        check('the period counts feed the picker',
            records._meta.period_counts.bronzealder === 1 && records._meta.period_counts.vikingetid === 1,
            JSON.stringify(records._meta.period_counts));
        check('fewer than ten hoards is flagged as insufficient', records._meta.insufficient === true);
        // renderSiteCount() prints `_meta.usable` once `insufficient` is set.
        check('the count line has a number to print', records._meta.usable === records.length,
            records._meta.usable);

        // The hoard picker must offer Danish groups, not only the Roman-era ones.
        const groups = hoardProvider.groups(records);
        const keys = groups.map(function (g) { return g.key; });
        check('the hoard picker lists the Danish periods',
            keys.indexOf('vikingetid') !== -1 && keys.indexOf('bronzealder') !== -1, keys.join(','));
        const dk = groups.filter(function (g) { return g.key === 'vikingetid'; })[0];
        check('the Danish group carries its year range and count',
            dk && dk.start === 793 && dk.end === 1066 && dk.count === 1,
            dk && (dk.start + '..' + dk.end + ' n=' + dk.count));

        const filtered = hoardProvider.filter(records, AARHUS, { key: 'vikingetid', group: 'vikingetid', start: 793, end: 1066 });
        check('the hoard period filter keeps the coin find alone',
            filtered.sites.length === 1 && filtered.sites[0].stednr === 'H2',
            JSON.stringify(filtered.sites.map(function (s) { return s.stednr; })));
        check('Danish hoard groups are declared in the shared config',
            Array.isArray(hoardConfig.danishPeriodGroups) && hoardConfig.danishPeriodGroups.length >= 8);
        check('the hoard training gate is untouched by this source',
            typeof hoards.trainingAllowed === 'function' && hoards.trainingAllowed() === true);
    }

    section('Provider — outside Denmark');
    {
        let calls = 0;
        const provider = DK.createProvider({ fetch: function () { calls++; return jsonResponse([]); } });
        const none = await provider.getSites(CLUJ, 50);
        check('a Romanian point never queries the Danish register', calls === 0 && none.length === 0);
        check('and it says why', none._meta.region === 'outside-denmark' && !!none._meta.message);
        const noneHoard = await provider.getHoards(CLUJ, 150);
        check('the hoard class behaves the same', calls === 0 && noneHoard.length === 0);
    }

    /* ── 6. wiring ───────────────────────────────────────────────────────── */
    section('Wiring');
    {
        const ui = read('js/apm-next/apm-ui.js');
        check('the panel asks the Danish source for Danish settlements',
            /if \(dk && insideDenmark\(centre\)\)/.test(ui));
        check('the panel asks it for Danish hoards',
            /insideDenmark\(state\.centre\) && denmarkProvider\(\)/.test(ui));
        check('the panel names the source in the status line',
            /denmarkStatus\(records\._meta/.test(ui));
        check('the panel reports the provenance of Danish records',
            /Fund og Fortidsminder — Denmark/.test(ui));
        check('the Romanian background predicate is not applied in Denmark',
            /outsideRegion\(\) \|\| denmarkRegion\(\) \? null/.test(ui));

        const pipe = read('js/apm-next/apm-pipeline.js');
        check('the pipeline treats Danish records like external sources for backgrounds',
            /\(outsideRomania \|\| denmarkRecords\) \? null/.test(pipe));
        check('and it warns that backgrounds are terrain samples, not a repertory',
            /warn\.denmarkBackground/.test(pipe));

        const i18n = read('js/apm-next/apm-i18n.js');
        ['train.denmarkLoaded', 'hoard.denmarkLoaded', 'warn.denmarkBackground',
         'train.denmarkTruncated', 'train.denmarkPartial', 'train.denmarkFailed'].forEach(function (k) {
            const hits = (i18n.match(new RegExp("'" + k.replace(/\./g, '\\.') + "'", 'g')) || []).length;
            check('both languages define ' + k, hits === 2, hits);
        });

        const html = read('index.html');
        const sw = read('sw.js');
        const tag = (html.match(/src="(js\/apm-next\/apm-denmark-sites\.js\?v=[^"]+)"/) || [])[1];
        check('index.html loads the Danish provider', !!tag, tag);
        check('the panel loads after it', !!tag &&
            html.indexOf(tag) < html.indexOf('js/apm-next/apm-ui.js?v='));
        check('the service worker pre-caches it', !!tag && sw.indexOf("'" + tag + "'") !== -1);
        check('the cache name was bumped', /const CACHE_NAME = 'detectlab-v42\d-/.test(sw),
            (sw.match(/const CACHE_NAME = '[^']+'/) || [])[0]);
        check('the changelog names the Danish source', /v421: TRAIN gains the Danish site source/.test(sw));
    }

    console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
    process.exit(failures === 0 ? 0 : 1);
})().catch(function (e) {
    console.error('harness crashed:', e);
    process.exit(1);
});
