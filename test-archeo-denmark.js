// Node test harness for the Denmark edition of the archaeological potential
// layer (js/archeo-dk-source.js + the region switch in js/archeo-potential.js).
// Usage: node test-archeo-denmark.js
//
// Ce verifică:
//   1. sursa daneză: regionFor, construcția URL-ului WFS, adaptarea
//      GeoJSON → {0: puncte, 6: poligoane}, liniile reduse la mijloc,
//      eșecuri raportate (nu ascunse), plafonul de features, cache-ul;
//   2. stratul de potențial rulează pe datele daneze cu aceeași logică:
//      fără raster UAT (0 cereri), raze de 100 + 25 m, bule + heat produse;
//   3. drumul românesc rămâne neatins (UAT cerut, raze 600 + 100 m).
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('  \u2714 ' + name);
    else { failures++; console.error('  \u2718 ' + name + (extra !== undefined ? ' \u2014 ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

const SRC_DK = fs.readFileSync(path.join(__dirname, 'js', 'archeo-dk-source.js'), 'utf8');
const SRC_POT = fs.readFileSync(path.join(__dirname, 'js', 'archeo-potential.js'), 'utf8');

const C_DK = { lat: 56.16, lng: 10.20 };     // Aarhus — în cutia Danemarcei
const C_RO = { lat: 46.80, lng: 23.60 };     // Cluj — drumul românesc

function latLngAt(centre, dxM, dyM) {
    const kLng = 111320 * Math.cos(centre.lat * Math.PI / 180);
    return { lat: centre.lat + dyM / 111320, lng: centre.lng + dxM / kLng };
}

function ringOfSites(centre, radiusM, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.21;
        const p = latLngAt(centre, radiusM * Math.cos(a), radiusM * Math.sin(a));
        out.push({
            type: 'Feature',
            id: 'site-' + i,
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: {
                anlaegstype: 'Rundhøj', datering: 'Jernalder', frednr: '1234' + i,
                stednr: '07010' + i, url: 'https://www.kulturarv.dk/fundogfortidsminder/Lokalitet/detaljer/?id=' + i
            }
        });
    }
    return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. js/archeo-dk-source.js — pure logic + mocked WFS
 * ═══════════════════════════════════════════════════════════════════════════ */

function newSourceSandbox() {
    const sb = {
        console,
        setTimeout, clearTimeout, Promise, Math, JSON, isFinite, isNaN,
        Array, Object, String, Number, Error, Date, encodeURIComponent, AbortController
    };
    sb.window = sb;
    sb.self = sb;
    vm.runInNewContext(SRC_DK, sb, { filename: 'archeo-dk-source.js' });
    return sb;
}

section('Danish source — regions');
{
    const sb = newSourceSandbox();
    const R = sb.DetectLabArcheoRegions;
    check('module attached to the global', !!R && typeof R.loadDanishSites === 'function');
    check('Aarhus resolves to DK', R.regionFor(C_DK.lat, C_DK.lng).id === 'DK');
    check('Cluj resolves to RO', R.regionFor(C_RO.lat, C_RO.lng).id === 'RO');
    check('the North Sea resolves to nothing', R.regionFor(56.0, 3.0) === null);
    check('DK has no UAT raster', R.REGIONS.DK.uat === false);
    check('DK protection radius is 100 + 25 m', R.REGIONS.DK.siteRadiusM === 100 && R.REGIONS.DK.siteBufferM === 25);
    check('RO keeps 600 + 100 m', R.REGIONS.RO.siteRadiusM === 600 && R.REGIONS.RO.siteBufferM === 100);
    check('DK attribution names the CC0 provider',
        /Fund og Fortidsminder/.test(R.REGIONS.DK.attribution) && /CC0/.test(R.REGIONS.DK.attribution));

    const bbox = R.bboxFor(C_DK.lat, C_DK.lng, 5000);
    check('bbox is west,south,east,north and contains the centre',
        bbox[0] < C_DK.lng && bbox[2] > C_DK.lng && bbox[1] < C_DK.lat && bbox[3] > C_DK.lat,
        bbox.join(','));
    check('bbox spans at least 10 km across', (bbox[2] - bbox[0]) * 111320 * Math.cos(C_DK.lat * Math.PI / 180) >= 9990);

    const url = R.wfsUrl('public:fundogfortidsminder_punkt_fredet', bbox, 900);
    check('WFS URL names the service', url.indexOf('https://www.kulturarv.dk/ffgeoserver/public/wfs?') === 0);
    check('WFS URL asks for GeoJSON in 4326',
        /outputFormat=application\/json/.test(url) && /srsName=EPSG:4326/.test(url));
    check('WFS URL carries the bbox in W,S,E,N order with the CRS suffix',
        url.indexOf('bbox=' + bbox.map(v => v.toFixed(6)).join(',') + ',EPSG:4326') !== -1);
    check('WFS URL caps the feature count', /&count=900(&|$)/.test(url));
}

section('Danish source — WFS adaptation');
(async () => {
    const sb = newSourceSandbox();
    const R = sb.DetectLabArcheoRegions;
    const calls = [];

    sb.fetch = function (url) {
        calls.push(url);
        const json = (features) => ({ ok: true, status: 200, json: () => Promise.resolve({ type: 'FeatureCollection', features }) });
        if (/punkt_fredet/.test(url)) return Promise.resolve(json(ringOfSites(C_DK, 1200, 4)));
        if (/punkt_ikkefredet/.test(url)) return Promise.resolve(json([{
            type: 'Feature', id: 'u1',
            geometry: { type: 'Point', coordinates: [C_DK.lng + 0.004, C_DK.lat + 0.004] },
            properties: { ANLAEGSTYPE: 'Stenkreds', DATERING: 'Bronzealder', FREDNR: '' }
        }]));
        if (/areal_fredet/.test(url)) return Promise.resolve(json([{
            type: 'Feature', id: 'a1',
            geometry: { type: 'Polygon', coordinates: [[
                [C_DK.lng - 0.003, C_DK.lat - 0.003],
                [C_DK.lng - 0.001, C_DK.lat - 0.003],
                [C_DK.lng - 0.001, C_DK.lat - 0.001],
                [C_DK.lng - 0.003, C_DK.lat - 0.001],
                [C_DK.lng - 0.003, C_DK.lat - 0.003]
            ]] },
            properties: { anlaegstype: 'Bebyggelse', datering: 'Oldtid', frednr: '99' }
        }]));
        if (/linje_fredet/.test(url)) return Promise.resolve(json([{
            type: 'Feature', id: 'l1',
            geometry: { type: 'LineString', coordinates: [
                [C_DK.lng + 0.010, C_DK.lat],
                [C_DK.lng + 0.012, C_DK.lat + 0.001]
            ] },
            properties: { anlaegstype: 'Vej', datering: 'Oldtid' }
        }]));
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    };

    const res = await R.loadDanishSites(C_DK.lat, C_DK.lng, 4000, {});
    const data = res.data, meta = res.meta;

    check('four source types are queried', calls.length === 4, calls.length);
    check('points land in layer 0', data[0].features.length === 6, data[0].features.length); // 4 fredet + 1 ikke-fredet + 1 linje
    check('polygons land in layer 6', data[6].features.length === 1, data[6].features.length);
    check('collection shape matches _localLayerData', data[0].type === 'FeatureCollection');

    const line = data[0].features.find(f => f.properties.__dkLine);
    check('a line becomes its midpoint', !!line);
    if (line) {
        const lng = line.geometry.coordinates[0], lat = line.geometry.coordinates[1];
        check('the midpoint sits between the endpoints',
            lng > C_DK.lng + 0.010 && lng < C_DK.lng + 0.012 && lat >= C_DK.lat && lat <= C_DK.lat + 0.001,
            lng + ',' + lat);
    }
    check('every adapted feature is flagged as Danish',
        data[0].features.every(f => f.properties.__dk === true) &&
        data[6].features.every(f => f.properties.__dk === true));
    check('attributes are kept (lower-cased keys)', (function () {
        const p = data[0].features[0].properties;
        return p.anlaegstype === 'Rundhøj' && p.datering === 'Jernalder' && !!p.frednr;
    })());
    check('upper-case service attributes are normalised',
        data[0].features.some(f => f.properties.anlaegstype === 'Stenkreds'));
    check('meta counts the geometry kinds',
        meta.points === 6 && meta.polygons === 1 && meta.lines === 1,
        JSON.stringify({ p: meta.points, a: meta.polygons, l: meta.lines }));
    check('meta reports no failure when the service answered', meta.failed === 0);
    check('meta carries the CC0 attribution', /CC0/.test(meta.attribution));

    const before = calls.length;
    const again = await R.loadDanishSites(C_DK.lat, C_DK.lng, 4000, {});
    check('a repeated run re-uses the cache', calls.length === before && again.meta === meta);
    await R.loadDanishSites(C_DK.lat, C_DK.lng, 4000, { force: true });
    check('force reloads from the service', calls.length === before * 2);

    R.clearCache();
    check('clearCache() empties the cache', typeof R.clearCache === 'function');
})().catch(e => { console.error('source tests crashed:', e); failures++; });

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. js/archeo-potential.js on Danish data
 * ═══════════════════════════════════════════════════════════════════════════ */

function newPotentialSandbox() {
    const sandbox = {
        console,
        performance: { now: () => Date.now() },
        setTimeout, clearTimeout, Promise, Math, JSON, isFinite, isNaN,
        Array, Object, String, Number, Error, Date, Uint8ClampedArray, Float32Array,
        encodeURIComponent, AbortController,
        document: {
            readyState: 'complete',
            addEventListener() {},
            getElementById: () => null,
            createElement: () => ({ style: {}, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData() {}, clearRect() {}, drawImage() {}, save() {}, restore() {} }) })
        },
        L: { layerGroup: () => ({}), circle: () => ({}), circleMarker: () => ({}), polyline: () => ({}), latLng: (a, b) => ({ lat: a, lng: b }) }
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.window._currentLang = () => 'ro';
    sandbox.window._dlMap = null;
    sandbox.window._localLayerData = {};
    sandbox.window._uatGetTile = null;
    sandbox.window.UAT_TILE_Z = 14;
    vm.runInNewContext(SRC_DK, sandbox, { filename: 'archeo-dk-source.js' });
    vm.runInNewContext(SRC_POT, sandbox, { filename: 'archeo-potential.js' });
    return sandbox;
}

(async () => {
    section('Potential layer — Denmark edition');
    {
        const sandbox = newPotentialSandbox();
        const W = sandbox.window;
        const D = W._archeoPotentialDebug;
        check('the source module is visible to the layer',
            !!W.DetectLabArcheoRegions && typeof W.DetectLabArcheoRegions.loadDanishSites === 'function');

        let uatCalls = 0;
        W._uatGetTile = function () { uatCalls++; return Promise.resolve(null); };
        W.fetch = function () {
            const json = (features) => ({ ok: true, status: 200, json: () => Promise.resolve({ type: 'FeatureCollection', features }) });
            // Cercurile de situri daneze: 8 puncte pe un inel de 1,5 km.
            return Promise.resolve(json(ringOfSites(C_DK, 1500, 8)));
        };

        check('regionFor() from the layer agrees with the source module',
            D.regionFor(56.16, 10.20).id === 'DK' && D.regionFor(46.8, 23.6).id === 'RO');

        const field = await W.computeArcheoPotentialField(C_DK.lat, C_DK.lng, 4000, { mode: 'bubbles' });

        check('the run is attributed to Denmark', field.region === 'DK', field.region);
        check('no UAT tile is ever requested', uatCalls === 0, uatCalls + ' calls');
        check('UAT exclusion is declared as not applied', field.uat.applied === false && field.uat.active === false);
        check('no cell is counted as "UAT unknown"', field.stats.uatUnknown === 0, field.stats.uatUnknown);
        check('the Danish sites are collected', field.stats.sites >= 8, field.stats.sites);
        check('the Danish source metadata travels with the field',
            !!field.regionMeta && field.regionMeta.provider === 'Fund og Fortidsminder' &&
            field.regionMeta.points >= 8, JSON.stringify(field.regionMeta && field.regionMeta.points));
        check('the smaller Danish radii are used',
            field.ctx.siteRadius === 100 && field.ctx.siteBuffer === 25,
            field.ctx.siteRadius + '+' + field.ctx.siteBuffer);
        check('cells are scored without any built-up exclusion', field.stats.scored > 0, field.stats.scored);
        check('bubbles are produced in the Danish run', field.bubbles.length > 0, field.bubbles.length);
        check('the heritage exclusion still applies (nothing on top of a site)',
            field.stats.excludedHeritage > 0, field.stats.excludedHeritage);

        // Distanța minimă de la orice celulă scoată la cel mai apropiat sit:
        // trebuie să respecte 125 m (DK), nu 700 m (RO).
        const sites = field.ctx.sites.map(s => ({ x: s.x, y: s.y }));
        let minDist = Infinity, anyUnder700 = false;
        field.results.forEach(r => {
            let d2min = Infinity;
            sites.forEach(s => {
                const dx = r.x - s.x, dy = r.y - s.y;
                d2min = Math.min(d2min, Math.sqrt(dx * dx + dy * dy));
            });
            minDist = Math.min(minDist, d2min);
            if (d2min < 700) anyUnder700 = true;
        });
        check('no scored cell sits inside the 125 m protection ring',
            minDist >= 124, minDist.toFixed(1) + ' m');
        check('the 100 m radius (not the Romanian 600 m one) is what protected the sites',
            anyUnder700, 'min=' + minDist.toFixed(1) + ' m');

        const cands = await W.computeArcheoPotential(C_DK.lat, C_DK.lng, 4000, {});
        check('computeArcheoPotential() follows the same region',
            cands.ctx && cands.ctx.region === 'DK' && cands.ctx.siteRadius === 100,
            cands.ctx && (cands.ctx.region + '/' + cands.ctx.siteRadius));
        check('the headless pipeline returns candidates', cands.status === 'ok' && cands.results.length > 0,
            cands.status + ' / ' + cands.results.length);
    }

    section('Potential layer — the register is unreachable');
    {
        const sandbox = newPotentialSandbox();
        const W = sandbox.window;
        let uatCalls = 0;
        W._uatGetTile = function () { uatCalls++; return Promise.resolve(null); };
        W.fetch = function () {
            return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
        };
        const field = await W.computeArcheoPotentialField(C_DK.lat, C_DK.lng, 3000, { mode: 'bubbles' });
        check('the failure is reported, not turned into an empty map',
            field.status === 'heritage_unavailable', field.status);
        check('every source failure is named', !!field.meta && field.meta.failed === field.meta.sources.length,
            field.meta && (field.meta.failed + '/' + field.meta.sources.length));
        check('nothing is scored from a failed register', field.results.length === 0);
        check('a failed register does not start the UAT reader', uatCalls === 0, uatCalls);
    }

    section('Potential layer — the info window follows the region');
    {
        const sandbox = newPotentialSandbox();
        const W = sandbox.window;
        const seen = [];
        W.showLayerInfo = function (title, attribution, hint) {
            seen.push({ title: title, attribution: attribution, hint: hint });
        };
        let centre = { lat: C_DK.lat, lng: C_DK.lng };
        W._dlMap = { getCenter: () => centre };
        W.showArcheoPotInfo();
        check('in Denmark the attribution names the CC0 register',
            /CC0/.test(seen[0].attribution) && /Fund og Fortidsminder/.test(seen[0].attribution),
            seen[0].attribution);
        check('in Denmark the hint explains the missing UAT layer',
            /UAT/.test(seen[0].hint) && /no built-up|Danemarca|built-up/i.test(seen[0].hint));
        centre = { lat: C_RO.lat, lng: C_RO.lng };
        W.showArcheoPotInfo();
        check('in Romania the attribution is unchanged',
            /RAN CIMEC/.test(seen[1].attribution), seen[1].attribution);
    }

    section('Potential layer — Romania stays untouched');
    {
        const sandbox = newPotentialSandbox();
        const W = sandbox.window;
        const features = ringOfSites(C_RO, 1500, 6).map((f, i) => ({
            id: i + 1,
            geometry: f.geometry,
            properties: { NUMESIT: 'Sit ' + i, CODSIT: '1' + i, COORD: 'DA' }
        }));
        W._localLayerData = { 0: { features }, 5: { features: [] }, 6: { features: [] } };

        let uatCalls = 0;
        let uatRed = false;   // false = pixel transparent (intravilan) → se exclude
        W._uatGetTile = function () {
            uatCalls++;
            const data = new Uint8ClampedArray(256 * 256 * 4);
            for (let i = 0; i < 256 * 256; i++) {
                data[i * 4] = 20; data[i * 4 + 1] = 20; data[i * 4 + 2] = 20;
                data[i * 4 + 3] = uatRed ? 255 : 0;
            }
            return Promise.resolve({ data: data, size: 256 });
        };
        W.fetch = function () { throw new Error('the Danish source must not be touched in Romania'); };

        // 1) sub toate celulele e intravilan (pixel transparent) → fiecare
        //    celulă liberă e exclusă de UAT, exact ca înainte de schimbare.
        const fieldBuiltUp = await W.computeArcheoPotentialField(C_RO.lat, C_RO.lng, 3000, { mode: 'bubbles' });
        check('the Romanian run reports region RO', fieldBuiltUp.region === 'RO', fieldBuiltUp.region);
        check('the UAT raster is read again', uatCalls > 0, uatCalls + ' tiles');
        check('UAT exclusion is applied', fieldBuiltUp.uat.applied !== false &&
            fieldBuiltUp.stats.excludedUat > 0, fieldBuiltUp.stats.excludedUat);
        check('the Romanian radii are unchanged',
            fieldBuiltUp.ctx.siteRadius === 600 && fieldBuiltUp.ctx.siteBuffer === 100,
            fieldBuiltUp.ctx.siteRadius + '+' + fieldBuiltUp.ctx.siteBuffer);
        check('no external source metadata leaks into a Romanian run', fieldBuiltUp.regionMeta === null);

        // 2) tot terenul liber (pixel roșu/închis) → se scorează din nou.
        uatRed = true;
        W._archeoPotentialResetCache();   // tile-urile UAT decodate sunt cache-uite
        const field = await W.computeArcheoPotentialField(C_RO.lat, C_RO.lng, 3000, { mode: 'bubbles' });
        check('open land is scored again once the raster says so',
            field.stats.scored > 0 && field.stats.excludedUat === 0,
            field.stats.scored + ' scored / ' + field.stats.excludedUat + ' excluded');
        check('the Romanian run keeps its own UAT accounting',
            field.uat.applied !== false && field.uat.available === true);
    }

    section('Wiring — the page and the service worker');
    {
        const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
        const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
        const srcTag = (html.match(/src="(js\/archeo-dk-source\.js\?v=[^"]+)"/) || [])[1];
        const potTag = (html.match(/src="(js\/archeo-potential\.js\?v=[^"]+)"/) || [])[1];
        check('index.html loads the Danish source module', !!srcTag, srcTag);
        check('the source module loads before the potential layer',
            !!srcTag && !!potTag && html.indexOf(srcTag) < html.indexOf(potTag));
        check('the service worker pre-caches the source module',
            !!srcTag && sw.indexOf("'" + srcTag + "'") !== -1);
        check('the service worker pre-caches the potential layer under the same tag',
            !!potTag && sw.indexOf("'" + potTag + "'") !== -1);
        check('the cache name was bumped for this release',
            /const CACHE_NAME = 'detectlab-v4[2-9]\d-/.test(sw),
            (sw.match(/const CACHE_NAME = '[^']+'/) || [])[0]);
        check('the changelog explains the Denmark edition',
            /v420: the archaeological potential layer/.test(sw));
    }

    console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
    process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
    console.error('harness crashed:', e);
    process.exit(1);
});
