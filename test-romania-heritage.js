#!/usr/bin/env node
'use strict';
// No network or npm dependencies: markup, translations, controls, async race
// guards, geometry decoding and the RTree shadow-node format.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const gpkg = require('./js/geopackage-reader.js');
const read = path => fs.readFileSync(path, 'utf8');
const html = read('index.html'), source = read('js/romania-heritage.js');
const group = html.slice(html.indexOf('<!-- Romanian Heritage:'), html.indexOf('<!-- HISTORICAL MAPS layer group -->'));
assert(group.includes('id="heritageToggle"'));
assert(!/type="range"/.test(group.split('id="heritageSubLayers"')[0]), 'parent has no opacity control');
assert.equal((group.match(/type="range"/g) || []).length, 2, 'only the two children have opacity sliders');
assert.equal((group.match(/type="checkbox"/g) || []).length, 3, 'one group switch plus two child switches');
assert(group.includes('id="patrimoniuToggle"') && group.includes('onchange="togglePatrimoniuLayer(this.checked)"'), 'Detect mode keeps its archaeology hook');
assert(group.includes('id="patrimoniuOpacitySlider"') && group.includes('id="naturalProtectedOpacitySlider"'));
for (const [lang, archaeology, nature] of [['en', 'Archeological heritage', 'Natural protected sites'], ['ro', 'Patrimoniu arheologic', 'Arii naturale protejate']]) {
    const dict = JSON.parse(read('tools/' + lang + '.json'));
    assert.equal(dict.layer_archaeological_heritage, archaeology);
    assert.equal(dict.layer_natural_protected_sites, nature);
    assert(read('js/translations.js').includes("layer_archaeological_heritage: '" + archaeology + "'"));
    assert(read('js/translations.js').includes("layer_natural_protected_sites: '" + nature + "'"));
}
const mirror = read('js/vertical-opacity-control.js');
assert(mirror.includes("naturalProtectedOpacitySlider: 'naturalProtectedToggle'"));
assert(mirror.includes("patrimoniuOpacitySlider: 'patrimoniuToggle'"));
assert(!mirror.includes("patrimoniuOpacitySlider: 'heritageToggle'"));
for (const asset of ['romania-heritage.js', 'geopackage-reader.js', 'geopackage-worker.js', 'translations.js', 'vertical-opacity-control.js', 'map-app.js']) {
    assert(read('sw.js').includes("'js/" + asset + '?v=20261102-ro-heritage' + "'"), asset + ' updated in PWA shell');
}
assert(!read('sw.js').includes('https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/ariinaturaleprotejate.gpkg'), 'never precache the 75 MB source');
assert(source.includes('Harti/ariinaturaleprotejate.gpkg'));

function u32(n, little = true) { const b = Buffer.alloc(4); little ? b.writeUInt32LE(n) : b.writeUInt32BE(n); return b; }
function f64(n, little = true) { const b = Buffer.alloc(8); little ? b.writeDoubleLE(n) : b.writeDoubleBE(n); return b; }
function wkb(type, parts, little = true) { return Buffer.concat([Buffer.from([little ? 1 : 0]), u32(type, little), ...parts]); }
function binary(wkb, flags = 1) { const h = Buffer.from([71, 80, 0, flags, 230, 16, 0, 0]); return Buffer.concat([h, wkb]); }
const point = wkb(1, [f64(22.9), f64(47.8)]);
assert.deepEqual(gpkg.decodeGeometry(binary(point)), { type: 'Point', coordinates: [22.9, 47.8] });
const bigEndian = wkb(1, [f64(22.9, false), f64(47.8, false)], false);
assert.deepEqual(gpkg.decodeGeometry(binary(bigEndian)).coordinates, [22.9, 47.8]);
for (const type of [1001, 2001, 3001, 0x80000001, 0x40000001]) {
    const extra = type === 3001 ? [f64(3), f64(4)] : [f64(3)];
    assert.deepEqual(gpkg.decodeGeometry(binary(wkb(type, [f64(22.9), f64(47.8), ...extra]))).coordinates, [22.9, 47.8]);
}
const ring = [[22, 47], [23, 47], [23, 48], [22, 47]];
const ringBytes = Buffer.concat([u32(ring.length), ...ring.flatMap(p => p.map(n => f64(n)))]);
const polygon = wkb(3, [u32(2), ringBytes, ringBytes]);
const multi = gpkg.decodeGeometry(binary(wkb(6, [u32(2), polygon, polygon])));
assert.equal(multi.type, 'MultiPolygon');
assert.equal(multi.coordinates.length, 2);
assert.deepEqual(multi.coordinates[0], [ring, ring], 'holes survive WKB decoding');
assert.deepEqual(gpkg.decodeGeometry(binary(point), p => [p[0] + 1, p[1] - 1]).coordinates, [23.9, 46.8]);
assert.equal(gpkg.decodeGeometry(binary(Buffer.alloc(0), 17)), null, 'empty GPKG geometry');
assert.equal(gpkg.decodeGeometry(binary(wkb(1, [f64(NaN), f64(NaN)]))), null, 'empty WKB point');
assert.throws(() => gpkg.decodeGeometry(binary(point.subarray(0, 10))), /invalid_wkb/);
assert.throws(() => gpkg.decodeGeometry(Buffer.from('not a geopackage')), /invalid_geopackage_geometry/);
assert.throws(() => gpkg.decodeGeometry(binary(wkb(2, [u32(99999999)]))), /geometry_too_large/);
const collection = gpkg.decodeGeometry(binary(wkb(7, [u32(2), point, polygon])));
assert.deepEqual(collection.geometries.map(g => g.type), ['Point', 'Polygon']);
function node(depth, cells) {
    const b = Buffer.alloc(4 + cells.length * 24); b.writeUInt16BE(depth); b.writeUInt16BE(cells.length, 2);
    cells.forEach(([id, box], i) => {
        const at = 4 + i * 24; b.writeBigUInt64BE(BigInt(id), at);
        [box[0], box[2], box[1], box[3]].forEach((v, j) => b.writeFloatBE(v, at + 8 + j * 4));
    });
    return b;
}
const nodes = new Map([[1, node(1, [[2, [22, 47, 23, 48]], [3, [26, 44, 27, 45]]])], [2, node(0, [[101, [22.8, 47.7, 22.9, 47.8]]])], [3, node(0, [[202, [26.1, 44.1, 26.2, 44.2]]])]]);
assert.deepEqual(gpkg.indexHits(nodes, [22.7, 47.6, 23, 48]), [101], 'only intersecting leaf ids, not node ids');
assert.deepEqual(gpkg.indexHits(nodes, [25, 43, 28, 46]), [202]);
assert.deepEqual(gpkg.indexHits(nodes, [10, 10, 11, 11]), []);
assert.throws(() => gpkg.indexHits(new Map([[1, node(1, [[2, [22, 47, 23, 48]]])]]), [22, 47, 23, 48]), /invalid_spatial_index/);
assert(gpkg.projectBounds([22, 47, 23, 48], p => p)[0] < 22, 'projected envelope includes a safety margin');

function setup() {
    const ids = ['heritageToggle', 'patrimoniuToggle', 'naturalProtectedToggle', 'archaeologicalHeritageRow', 'naturalProtectedRow', 'naturalProtectedOpacitySlider', 'naturalProtectedPct', 'naturalProtectedStatus', 'patrimoniuOpacitySlider', 'patrimoniuPct', 'heritageSubLayers', 'heritageExpandBtn', 'heritageExpandIcon'];
    const elements = Object.fromEntries(ids.map(id => [id, { id, checked: false, style: {}, value: id === 'patrimoniuOpacitySlider' ? '35' : '55', textContent: '', hidden: false,
        classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } }]));
    const timers = new Map(); let timerId = 0, epoch = 0, zoom = 10, openCount = 0, closeCount = 0;
    const hooks = {}, members = new Set(), calls = [], requests = [];
    const document = { documentElement: { lang: 'en' }, baseURI: 'https://test.example/', getElementById: id => elements[id], addEventListener: (name, cb) => { hooks[name] = cb; } };
    const map = { on(names, cb) { names.split(' ').forEach(name => { hooks[name] = cb; }); }, getZoom: () => zoom,
        getBounds: () => ({ getWest: () => 22, getSouth: () => 47, getEast: () => 23, getNorth: () => 48 }),
        getPane: () => ({ style: {} }), createPane() {}, removeLayer(layer) { members.delete(layer); }, hasLayer: layer => members.has(layer) };
    function layer() { return { options: {}, count: 0, addTo() { members.add(this); return this; }, clearLayers() { this.count = 0; }, addData(fc) { this.count = fc.features.length; }, setStyle() {}, eachLayer() {} }; }
    const root = { document, _dlMap: map, L: { canvas: () => ({}), geoJSON: layer }, console: { warn() {} }, Comlink: {}, proj4() {},
        togglePatrimoniuLayer(on) { calls.push(on); }, setPatrimoniuOpacity(value) { elements.patrimoniuPct.textContent = value + '%'; },
        DetectLabGeoPackage: { open: async () => {
            openCount++; return { close() { closeCount++; }, features: () => new Promise((resolve, reject) => requests.push({ resolve, reject, epoch: ++epoch })) };
        } } };
    const context = { window: root, document, URL, AbortController, Uint8Array, clearTimeout: id => timers.delete(id), setTimeout: cb => { timers.set(++timerId, cb); return timerId; } };
    vm.runInNewContext(source, context);
    async function tick() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
    async function flush() { const tasks = Array.from(timers.values()); timers.clear(); tasks.forEach(cb => cb()); await tick(); }
    return { root, elements, map, members, hooks, calls, requests, tick, flush, zoom: n => { zoom = n; }, opens: () => openCount, closes: () => closeCount };
}
(async () => {
    const h = setup(), w = h.root, e = h.elements;
    assert(!e.heritageToggle.checked && !e.patrimoniuToggle.checked && !e.naturalProtectedToggle.checked, 'all sources start off');
    assert.equal(h.opens(), 0, 'no protected-site request at startup');
    w.toggleRomanianHeritage(true);
    assert(e.heritageToggle.checked && e.patrimoniuToggle.checked && e.naturalProtectedToggle.checked);
    await h.flush();
    assert.equal(h.opens(), 1);
    h.requests.shift().resolve({ type: 'FeatureCollection', features: [{ properties: {}, geometry: null }] });
    await h.tick();
    assert.match(e.naturalProtectedStatus.textContent, /1 protected sites/);
    w.setPatrimoniuOpacity(63); w.setNaturalProtectedOpacity(41);
    w.toggleRomanianHeritage(false);
    assert(!e.heritageToggle.checked && !e.patrimoniuToggle.checked && !e.naturalProtectedToggle.checked);
    assert.equal(e.patrimoniuOpacitySlider.value, 63);
    assert.equal(e.naturalProtectedOpacitySlider.value, 41, 'parent off retains both opacities');
    assert.equal(h.closes(), 1, 'off closes the SQLite worker and its byte cache');
    w.toggleRomanianHeritage(true);
    assert(e.patrimoniuToggle.checked && e.naturalProtectedToggle.checked);
    assert.equal(e.naturalProtectedOpacitySlider.value, 41);
    w.togglePatrimoniuLayer(false);
    assert(e.heritageToggle.checked && e.naturalProtectedToggle.checked && !e.patrimoniuToggle.checked);
    w.toggleRomanianHeritage(false); w.toggleRomanianHeritage(true);
    assert(!e.patrimoniuToggle.checked && e.naturalProtectedToggle.checked, 'master restores the selected subset');
    // These are the same legacy entry points Detect mode uses to borrow and
    // restore archaeology. Nature must never be touched by that round-trip.
    w.togglePatrimoniuLayer(true); w.togglePatrimoniuLayer(false);
    assert(e.naturalProtectedToggle.checked);
    w.setNaturalProtectedOpacity(0);
    assert(!e.naturalProtectedToggle.checked && !e.heritageToggle.checked);
    assert.equal(e.naturalProtectedOpacitySlider.value, 0);
    w.setPatrimoniuOpacity(20);
    assert(e.patrimoniuToggle.checked && e.heritageToggle.checked && !e.naturalProtectedToggle.checked);
    w.setPatrimoniuOpacity(0);
    assert(!e.heritageToggle.checked);
    w.setNaturalProtectedOpacity(38);
    assert(!e.patrimoniuToggle.checked && e.naturalProtectedToggle.checked && e.heritageToggle.checked);
    await h.flush();
    const stale = h.requests.shift();
    w.toggleNaturalProtectedSites(false);
    stale.resolve({ type: 'FeatureCollection', features: [{}] });
    await h.tick();
    assert(!e.heritageToggle.checked && !h.members.has(w._naturalProtectedLayer), 'late responses never resurrect an off layer');
    w.toggleNaturalProtectedSites(true); await h.flush();
    h.requests.shift().reject(new Error('fixture failure')); await h.tick();
    assert.match(e.naturalProtectedStatus.textContent, /Data unavailable/);
    h.root.document.documentElement.lang = 'ro'; h.hooks['detectlab:langchange']();
    assert.match(e.naturalProtectedStatus.textContent, /Datele nu sunt disponibile/);
    w.toggleNaturalProtectedSites(false); h.zoom(6); w.toggleNaturalProtectedSites(true); await h.flush();
    assert.match(e.naturalProtectedStatus.textContent, /nivelul 8/);
    w.toggleRomanianHeritageSubLayers(); assert.equal(e.heritageSubLayers.style.display, 'none');
    w.toggleRomanianHeritageSubLayers(); assert.equal(e.heritageSubLayers.style.display, 'flex');
    // A newer viewport is queued while a SQLite query is in flight.
    w.toggleNaturalProtectedSites(false); h.zoom(10); w.toggleNaturalProtectedSites(true); await h.flush();
    const oldView = h.requests.shift(); h.hooks.moveend(); await h.flush();
    oldView.resolve({ type: 'FeatureCollection', features: [{}] }); await h.tick();
    assert.equal(w._naturalProtectedLayer.count, 0, 'old viewport is not painted');
    await h.flush(); h.requests.shift().resolve({ type: 'FeatureCollection', features: [{}, {}] }); await h.tick();
    assert.equal(w._naturalProtectedLayer.count, 2, 'latest coalesced viewport is painted');
    w.toggleNaturalProtectedSites(false);
    console.log('OK — Romanian Heritage markup/i18n, switches, opacity isolation, Detect compatibility, async races, WKB and RTree.');
})().catch(error => { console.error(error); process.exitCode = 1; });
