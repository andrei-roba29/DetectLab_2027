'use strict';
// Offline numeric/worker/pipeline/DOM checks. Synthetic data, no live services.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { JSDOM } = createRequire(path.join(__dirname, 'tools/apm-test/package.json'))('jsdom');
const core = require('./js/apm-next/apm-core.js'), R = require('./js/apm-next/apm-raster.js');
const rbush = require('./js/rbush.min.js'), providers = require('./js/apm-next/apm-providers.js');
const i18n = require('./js/apm-next/apm-i18n.js');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function workerContext(post) {
    const c = { console }; c.self = c; c.postMessage = post;
    c.importScripts = (...files) => files.forEach(f => vm.runInContext(read('js/apm-next/' + f.split('?')[0]), c));
    vm.createContext(c); vm.runInContext(read('js/apm-next/apm-worker.js'), c); return c;
}
function seeded() { let seed = 4211; return () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296); }
function elevation(g) { return Float32Array.from({ length: g.w * g.h }, (_, i) => {
    const lon = g.west + (i % g.w + .5) * g.dLon, lat = g.north - (Math.floor(i / g.w) + .5) * g.dLat;
    return 300 + 100 * Math.sin(lon * 80) + 70 * Math.cos(lat * 95) + lon * 10;
}); }
const records = Array.from({ length: 24 }, (_, i) => ({ id: String(i), name: 'Fixture ' + i,
    lat: 46.77 + ((i % 6) - 3) * .026, lon: 23.59 + (Math.floor(i / 6) - 2) * .04,
    type: 'settlement', positionAccuracy: 5, source: 'csv', periods: [] }));
class Worker {
    constructor() { this.dead = false; this.c = workerContext((m, t = []) => {
        const copy = structuredClone(m, { transfer: t }); queueMicrotask(() => { if (!this.dead) this.onmessage({ data: copy }); });
    }); }
    postMessage(m, t = []) { this.c.onmessage({ data: structuredClone(m, { transfer: t }) }); }
    terminate() { this.dead = true; this.c = null; }
}
async function runPipeline(observer) {
    const ledger = [], observations = [];
    const oldDem = providers.demPlan, oldWater = providers.waterPlan;
    providers.demPlan = () => [{ use: true, provider: { id: 'fixture-dem', label: 'Fixture DEM', nominalResM: 500,
        fetchBlock: async g => { ledger.push(['dem', { ...g }]); return elevation(g); } } }];
    providers.waterPlan = () => [{ use: true, provider: { id: 'fixture-water', label: 'Fixture water', fetchWater: async box => {
        ledger.push(['water', { ...box }]); return { lines: [
            { cls: 'small', coords: [[23.6, 46], [23.6, 48]] },
            { cls: 'large', coords: [[23.9, 46], [23.9, 48]] }], polygons: [], meta: {} }; } } }];
    const c = { module: { exports: {} }, require: id => require(path.join(__dirname, 'js/apm-next', id)), console,
        Promise, Map, Set, Date, Math, Float32Array, Float64Array, Uint8Array, Int32Array, Uint32Array, Uint8ClampedArray,
        setTimeout, clearTimeout, performance, Worker,
        computeArcheoExclusionMask: async g => ({ mask: new Uint8Array(g.w * g.h), stats: { unknown: 0 } }) };
    vm.runInNewContext(read('js/apm-next/apm-pipeline.js'), c);
    const session = {}, start = performance.now();
    try {
        const result = await c.module.exports.runTrain(session, { centre: { lat: 46.77, lon: 23.59 }, records,
            radiusKm: 1, minSlopeDeg: .5, smoothDem: true, includeDrainage: false,
            waterClasses: ['small', 'large'], bgCount: 100, rnd: seeded(), cacheInputs: false,
            token: { cancelled: false }, onPreview: observer === false ? undefined : e => {
                observations.push(structuredClone(e)); if (observer) observer(e);
            } });
        return { result: structuredClone(result), ledger, observations, ms: performance.now() - start };
    } finally { if (session.worker) session.worker.terminate(); providers.demPlan = oldDem; providers.waterPlan = oldWater; }
}
function domHarness(reduced = false) {
    const dom = new JSDOM('<html><body><div id="host"></div></body></html>', { runScripts: 'outside-only', url: 'https://fixture.invalid' });
    const w = dom.window, frames = new Map(), events = [], draw = []; let id = 0, now = 0, language = 'en';
    Object.defineProperty(w.performance, 'now', { value: () => now });
    const media = { matches: reduced, addEventListener(_, f) { this.listener = f; }, removeEventListener() { this.listener = null; } };
    w.matchMedia = () => media;
    w.requestAnimationFrame = f => { frames.set(++id, f); return id; }; w.cancelAnimationFrame = n => frames.delete(n);
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { set(o, k, v) { o[k] = v; return true; }, get(o, k) {
        return o[k] || ((...args) => { draw.push([k, ...args]); });
    } });
    w.fetch = () => { throw Error('Preview network forbidden'); }; w.DetectLabApmCore = core;
    w.eval(read('js/apm-next/apm-loading-preview.js'));
    const instance = w.DetectLabApmLoadingPreview.create({ host: w.document.querySelector('#host'), t: (k, v) => i18n.t(k, language, v),
        onSkip: () => events.push('skip'), onCancel: () => events.push('cancel'), onStop: () => events.push('stop') });
    return { dom, w, instance, frames, draw, events, media,
        language(v) { language = v; w.document.dispatchEvent(new w.Event('detectlab:langchange')); },
        frame(t) { now = t; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(f => f(t)); } };
}
(async () => {
    await test('nearest-water witness preserves original distance, projection, degenerate/tied/no-water cases', () => {
        for (const segments of [[23, 46, 23, 47], [23, 46, 23, 46], [23, 46, 23, 47, 23, 46, 23, 47], []]) {
            const index = R.buildSegmentIndex(rbush, Float64Array.from(segments));
            for (const [lon, lat] of [[23.001, 46.5], [23, 46], [25, 48]]) {
                const out = {}, a = R.nearestWaterM(index, lon, lat), b = R.nearestWaterM(index, lon, lat, out);
                assert.equal(a, b);
                if (segments.length) {
                    const mp = core.metresPerDegree(lat), d = Math.hypot((out.point.lon - lon) * mp.lon, (out.point.lat - lat) * mp.lat);
                    assert(Math.abs(d - a) < 1e-6); assert.equal(out.segment.length, 2); assert.equal(out.distanceM, a);
                } else assert.equal(out.point, null);
            }
        }
    });
    await test('real worker: capped original site samples, nearest enabled class, raw DEM patch, unchanged numeric arrays', () => {
        let reply; const c = workerContext(m => reply = m);
        const send = (op, args) => { c.onmessage({ data: { op, id: 1, ...args } }); assert(reply.ok, reply.error); return reply; };
        send('setWater', { classes: { small: Float64Array.from([23.005, 46, 23.005, 48]), large: Float64Array.from([23.008, 46, 23.008, 48]) } });
        const args = { w: 32, h: 32, dxM: 25, dyM: 25, tile: { west: 23, north: 47, dLon: .0003, dLat: .0002 },
            elev: Float32Array.from({ length: 1024 }, (_, i) => 300 + (i % 32) * 2 + Math.floor(i / 32)),
            points: Float64Array.from(Array.from({ length: 9 }, (_, i) => [23.003 + i * .0001, 46.997]).flat()),
            siteMask: new Uint8Array(9).fill(1), positionRadiusM: 60, smooth: true };
        const plain = send('sampleTile', args), view = send('sampleTile', { ...args, previewIndices: [0, 1, 2, 3, 4, 5], previewWaterClasses: ['large'] });
        assert.equal(plain.previews, undefined); assert.equal(view.previews.length, 4);
        for (const field of ['values', 'inside']) assert.deepEqual([...view[field]], [...plain[field]]);
        for (const cls of ['small', 'large']) assert.deepEqual([...view.water[cls]], [...plain.water[cls]]);
        const s = view.previews[0]; assert.equal(s.nearest.waterClass, 'large');
        assert.equal(s.nearest.distanceM, view.water.large[0]); assert.equal(s.patch.elevation.length, 81);
        const cell = R.cellOf({ w: 32, h: 32, ...args.tile }, args.points[0], args.points[1]);
        assert.equal(s.patch.elevation[40], args.elev[cell]); assert.equal(s.altitude, view.values[0]);
        assert(JSON.stringify(view.previews).length < 32000);
    });
    let observed;
    await test('real TRAIN off/on: identical request ledger, fitting, validation, thresholds, polygons, areas, heatmap', async () => {
        const plain = await runPipeline(false); observed = await runPipeline();
        assert.deepEqual(observed.ledger, plain.ledger);
        for (const k of ['geojson', 'thresholds', 'areaKm2', 'scoreStats', 'heatmap', 'warnings']) assert.deepEqual(observed.result[k], plain.result[k], k);
        for (const k of ['weights', 'curves', 'cv', 'confidence', 'downweightedSites', 'sitesInSample', 'backgroundInSample'])
            assert.deepEqual(observed.result.diagnostics[k], plain.result.diagnostics[k], k);
        assert.equal(observed.observations[0].type, 'start'); assert.equal(observed.observations[0].total, 24);
        const samples = observed.observations.filter(e => e.type === 'sample'), refs = observed.observations.filter(e => e.type === 'reference');
        assert.equal(samples.length, 4); assert.equal(refs.length, 4);
        for (const s of samples) { assert.equal(s.lat, records[s.index].lat); assert.equal(s.lon, records[s.index].lon); assert.equal(s.id, records[s.index].id); }
        for (const r of refs) if (r.included) assert(r.soilPercentile >= 0 && r.soilPercentile <= 1);
        const threw = await runPipeline(() => { throw Error('renderer broke'); });
        assert.equal(threw.observations.length, 1); assert.deepEqual(threw.result.heatmap, plain.result.heatmap);
        console.log(JSON.stringify({ scope: 'OFFLINE real-worker fixture, 50km training/1km prediction, not phone timing', offMs: plain.ms,
            onMs: observed.ms, providerCalls: observed.ledger.length, previewBytes: JSON.stringify(observed.observations).length }));
    });
    await test('canvas UI: real payloads, one rAF, no network, bilingual labels, static mode, skip/cancel and ten-cycle cleanup', () => {
        for (let cycle = 0; cycle < 10; cycle++) {
            const h = domHarness(cycle === 0), { instance, w } = h;
            for (const e of observed.observations) instance.update(e);
            const text = w.document.body.textContent;
            assert(text.includes('4 of 24')); assert(!/undefined|NaN|Infinity|preview\./.test(text));
            assert(w.document.querySelector('.apm-preview-values').textContent.includes(observed.observations.find(e => e.type === 'sample').altitude.toFixed(1)));
            assert.equal(w.document.querySelectorAll('canvas').length, 1); assert(h.frames.size <= 1);
            if (cycle === 0) assert.equal(h.frames.size, 0, 'reduced motion is static');
            else { h.frame(2500); h.frame(5000); assert(h.frames.size <= 1); }
            h.language('ro'); assert(w.document.body.textContent.includes('Cum este eșantionat mediul'));
            w.document.querySelector('[data-preview-key="preview.soil"]').click();
            assert(w.document.body.textContent.includes('nu un studiu pedologic'));
            w.document.querySelector('[data-preview-key="run.cancel"]').click(); assert(h.events.includes('cancel'));
            const canvas = w.document.querySelector('canvas');
            w.document.querySelector('[data-preview-key="preview.skip"]').click();
            assert.deepEqual(h.events.slice(-2), ['stop', 'skip']); assert.equal(h.frames.size, 0); assert.equal(canvas.width, 0);
            assert.equal(w.document.querySelectorAll('.apm-loading-preview').length, 0); assert.equal(h.media.listener, null);
            instance.stop(); instance.update(observed.observations[1]); assert.equal(h.frames.size, 0);
            h.dom.window.close();
        }
    });
    await test('visibility/reduced-motion/pagehide cancel frames, keep geometry unchanged and release listeners', () => {
        const h = domHarness(); for (const e of observed.observations) h.instance.update(e);
        const before = JSON.stringify(observed.observations);
        Object.defineProperty(h.w.document, 'hidden', { configurable: true, value: true });
        h.w.document.dispatchEvent(new h.w.Event('visibilitychange')); assert.equal(h.frames.size, 0);
        Object.defineProperty(h.w.document, 'hidden', { configurable: true, value: false });
        h.w.document.dispatchEvent(new h.w.Event('visibilitychange')); assert.equal(h.frames.size, 1);
        h.media.matches = true; h.media.listener(); assert.equal(h.frames.size, 0);
        h.w.dispatchEvent(new h.w.Event('pagehide')); assert.equal(h.w.document.querySelectorAll('canvas').length, 0);
        assert.equal(JSON.stringify(observed.observations), before); h.dom.window.close();
    });
    await test('new local assets precached/versioned; no preview fetch, camera, map membership or tool flags', () => {
        const src = read('js/apm-next/apm-loading-preview.js'), html = read('index.html'), sw = read('sw.js');
        assert(!/\bfetch\s*\(|XMLHttpRequest|\.fitBounds\(|\.addTo\(|\.removeLayer\(|dlApmPicking\s*=/.test(src));
        // The shell cache name moves with every release; assert the shape and
        // that it is a real const, not a frozen snapshot of an older build.
        assert(/const CACHE_NAME = 'detectlab-v\d+-[a-z0-9-]+';/.test(sw));
        assert(html.indexOf('<script src="js/apm-next/apm-loading-preview.js') < html.indexOf('<script src="js/apm-next/apm-ui.js'));
        for (const f of ['apm-raster', 'apm-worker', 'apm-loading-preview', 'apm-ui', 'apm-i18n', 'apm-pipeline'])
            assert(sw.includes('js/apm-next/' + f + '.js?v=20261109-apm-hoard-wording'));
        for (const k of ['preview.title', 'preview.method.water', 'preview.method.relief', 'preview.method.soil'])
            for (const lang of ['en', 'ro']) assert.notEqual(i18n.t(k, lang), k);
    });
    console.log(passed + ' loading preview checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
