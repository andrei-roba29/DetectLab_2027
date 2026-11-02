#!/usr/bin/env node
'use strict';
/* Real SQLite WASM + HTTP Range + Leaflet + 3D mirror, no external services.
 * Requirements: Python 3; playwright and a Chromium build. Optionally use
 * @sparticuz/chromium. Set PLAYWRIGHT_MODULE_DIR=/path/to/node_modules and/or
 * CHROMIUM_EXECUTABLE_PATH=/path/to/chromium. Skips if Playwright is absent. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const ROOT = __dirname;
let playwright, chromium;
for (const dir of [process.env.PLAYWRIGHT_MODULE_DIR, path.join(ROOT, 'node_modules')].filter(Boolean)) {
    try {
        const req = createRequire(path.resolve(dir, 'index.js'));
        playwright = req('playwright');
        try { chromium = req('@sparticuz/chromium'); } catch (_) { /* normal Playwright install */ }
        break;
    } catch (_) { /* next installation */ }
}
if (!playwright) { console.log('SKIP — install playwright (plus Chromium) for Romanian heritage browser tests'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detectlab-heritage-'));
const fixturePath = path.join(tmp, 'fixture.gpkg');
execFileSync('python3', [path.join(ROOT, 'test/fixtures/create-heritage-gpkg.py'), fixturePath]);
const fixture = fs.readFileSync(fixturePath);
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const block = index.slice(index.indexOf('<!-- Romanian Heritage:'), index.indexOf('<!-- HISTORICAL MAPS layer group -->'));
const dictionaries = { en: JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/en.json'))), ro: JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ro.json'))) };
const harness = `<!doctype html><html lang="en"><head>
<link rel="stylesheet" href="/css/leaflet.css"><link rel="stylesheet" href="/css/styles.css">
<link rel="stylesheet" href="/css/romania-heritage.css">
<style>body{padding:20px;display:flex;gap:20px;background:#101327}#map{width:600px;height:560px;flex-shrink:0}#transpPanel{position:static!important;display:block!important;width:330px;max-height:none;height:auto;opacity:1;visibility:visible;transform:none;padding:8px;overflow:visible}@media(max-width:600px){body{padding:8px;display:block}#map{width:100%;height:250px}#transpPanel{width:100%;padding:8px 0}}</style>
</head><body><div id="map"></div><div id="transpPanel" class="transp-panel open">${block}</div>
<script src="/js/leaflet.js"></script><script src="/js/map-rotate.js"></script><script src="/js/map3d-mirror.js"></script>
<script>
window._dlMap=L.map('map',{zoomAnimation:false,rotate:true}).setView([47.77,22.88],10);
window._patrimoniuLayer=L.layerGroup([L.circleMarker([47.77,22.88])]);
window.togglePatrimoniuLayer=function(on){if(on)_patrimoniuLayer.addTo(_dlMap);else _dlMap.removeLayer(_patrimoniuLayer);};
window.setPatrimoniuOpacity=function(value){document.getElementById('patrimoniuPct').textContent=value+'%';};
window._currentLang=function(){return document.documentElement.lang;};
window.setLang=function(lang){document.documentElement.lang=lang;var dict=${JSON.stringify(dictionaries)}[lang];document.querySelectorAll('.t[data-key]').forEach(function(n){if(dict[n.dataset.key])n.textContent=dict[n.dataset.key];});document.dispatchEvent(new CustomEvent('detectlab:langchange'));};
</script><script src="/js/romania-heritage.js"></script></body></html>`;
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };
let sourceRequests = 0, vendorRequests = 0, breakSource = false;
function dataResponse(range, broken) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match ? Math.min(Number(match[2]), fixture.length - 1) : fixture.length - 1;
    let body = fixture.subarray(start, end + 1);
    if (broken && body.length !== 100) body = body.subarray(0, 8);
    return { status: match ? 206 : 200, body,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length),
            'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
            ...(match ? { 'Content-Range': `bytes ${start}-${end}/${fixture.length}` } : {}) } };
}
const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://test').pathname;
    if (name === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(harness); return; }
    if (/^\/(fixture|no-range|bad-range)\.gpkg$/.test(name)) {
        const response = dataResponse(name === '/no-range.gpkg' ? null : req.headers.range, name === '/bad-range.gpkg');
        res.writeHead(response.status, response.headers);
        res.end(req.method === 'HEAD' ? undefined : response.body); return;
    }
    if (name.includes('/vendor/geopackage/')) vendorRequests++;
    const file = path.resolve(ROOT, '.' + name);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
(async () => {
    let browser;
    await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
    try {
        browser = await playwright.chromium.launch({ headless: true,
            ...(chromium ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || await chromium.executablePath(), args: chromium.args } : process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
        const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' });
        await context.route('https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/ariinaturaleprotejate.gpkg*', async route => {
            sourceRequests++;
            const req = route.request(), response = dataResponse(req.headers().range, breakSource);
            await route.fulfill({ ...response, body: req.method() === 'HEAD' ? Buffer.alloc(0) : response.body });
        });
        let breakComlink = true;
        await context.route('**/js/vendor/geopackage/comlink.js', route => breakComlink ? route.abort() : route.continue());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = 'http://127.0.0.1:' + server.address().port;
        await page.goto(base);
        assert.equal(sourceRequests, 0); assert.equal(vendorRequests, 0, 'reader assets are lazy');
        assert.equal(await page.locator('#romanianHeritageRow > input[type=range]').count(), 0);
        assert.equal(await page.locator('#romanianHeritageRow input[type=range]').count(), 2);
        await page.locator('#naturalProtectedRow .apm-toggle-switch').click();
        await page.waitForFunction(() => document.getElementById('naturalProtectedStatus').classList.contains('is-error'));
        await page.waitForFunction(() => window.DetectLabGeoPackage && window.proj4);
        assert.equal(await page.evaluate(() => typeof window.Comlink), 'undefined', 'first attempt failed only the Comlink asset');
        assert.equal(sourceRequests, 0, 'partial runtime load must not start a data request');
        breakComlink = false;
        await page.evaluate(() => { toggleNaturalProtectedSites(false); toggleNaturalProtectedSites(true); });
        await page.waitForFunction(() => window._naturalProtectedLayer && _naturalProtectedLayer.getLayers().length === 3);
        assert(await page.locator('#heritageToggle').isChecked());
        assert(!await page.locator('#patrimoniuToggle').isChecked(), 'nature never auto-enables archaeology');
        const rendering = await page.evaluate(() => {
            const child = _naturalProtectedLayer.getLayers()[0];
            const mirrored = DetectLabMirror.collect(_dlMap).items.filter(item => item.kind === 'vector');
            return { rings: child.feature.geometry.coordinates.length, popup: child.getPopup().getContent()(child),
                mirrorCount: mirrored.reduce((n, item) => n + item.geojson.features.length, 0) };
        });
        assert.equal(rendering.rings, 2, 'polygon hole is preserved');
        assert(rendering.popup.includes('&lt;script&gt;') && !rendering.popup.includes('<script>'), 'source attributes are escaped');
        assert.equal(rendering.mirrorCount, 3, 'all protected polygons mirror to 3D');
        await page.evaluate(() => { setNaturalProtectedOpacity(42); setPatrimoniuOpacity(66); });
        const paint = await page.evaluate(() => ({ natural: _naturalProtectedLayer.getLayers()[0].options.fillOpacity, arch: document.getElementById('patrimoniuOpacitySlider').value }));
        assert(Math.abs(paint.natural - .32 * .42) < 1e-9); assert.equal(paint.arch, '66');
        await page.evaluate(() => toggleRomanianHeritage(false));
        assert(!await page.locator('#heritageToggle').isChecked());
        assert.equal(await page.locator('#naturalProtectedOpacitySlider').inputValue(), '42');
        assert.equal(await page.locator('#patrimoniuOpacitySlider').inputValue(), '66');
        assert.equal(await page.evaluate(() => DetectLabMirror.collect(_dlMap).items.filter(item => item.kind === 'vector').length), 0);
        await page.evaluate(() => toggleRomanianHeritage(true));
        await page.waitForFunction(() => _naturalProtectedLayer.getLayers().length === 3);
        await page.evaluate(() => setLang('ro'));
        assert.equal(await page.locator('#heritageTitle').innerText(), 'Patrimoniu');
        assert.equal(await page.locator('#archaeologicalHeritageTitle').innerText(), 'Patrimoniu arheologic');
        assert.equal(await page.locator('#naturalProtectedTitle').innerText(), 'Arii naturale protejate');
        assert.match(await page.locator('#naturalProtectedStatus').innerText(), /arii protejate/);
        await page.setViewportSize({ width: 390, height: 844 });
        const boxes = await page.locator('#romanianHeritageRow input[type=range]').evaluateAll(inputs => inputs.map(input => {
            const row = input.parentElement.getBoundingClientRect(), slider = input.getBoundingClientRect();
            return { left: slider.left - row.left, right: row.right - slider.right, width: slider.width };
        }));
        assert(boxes.every(box => box.left >= 0 && box.right >= -1 && box.width > 150), 'mobile sublayer sliders fit their own rows');
        await page.evaluate(() => _dlMap.setZoom(6));
        await page.waitForFunction(() => document.getElementById('naturalProtectedStatus').textContent.includes('nivelul 8'));
        assert.equal(await page.evaluate(() => _naturalProtectedLayer.getLayers().length), 0);
        await page.evaluate(() => toggleNaturalProtectedSites(false));
        await page.evaluate(() => _dlMap.setZoom(10));
        breakSource = true;
        await page.evaluate(() => toggleNaturalProtectedSites(true));
        await page.waitForFunction(() => document.getElementById('naturalProtectedStatus').classList.contains('is-error'));
        assert(await page.locator('#patrimoniuToggle').isChecked(), 'failed nature source does not change archaeology');
        breakSource = false;
        await page.evaluate(() => { toggleNaturalProtectedSites(false); toggleNaturalProtectedSites(true); });
        await page.waitForFunction(() => _naturalProtectedLayer.getLayers().length === 3);
        await page.evaluate(() => toggleRomanianHeritage(false));
        const reader = await page.evaluate(async base => {
            const opts = { workerUrl: base + '/js/geopackage-worker.js', wasmUrl: base + '/js/vendor/geopackage/sql-wasm.wasm' };
            const db = await DetectLabGeoPackage.open(base + '/fixture.gpkg', opts);
            const visible = await db.features([22.8, 47.7, 23, 47.9]);
            const capped = await db.features([22.8, 47.7, 23, 47.9], 1);
            const empty = await db.features([19, 43, 20, 44]);
            const stats = await db.stats(); db.close();
            const failures = [];
            for (const name of ['no-range', 'bad-range']) {
                try { const unexpected = await DetectLabGeoPackage.open(base + '/' + name + '.gpkg', opts); unexpected.close(); failures.push('unexpected success'); }
                catch (error) { failures.push(error.message); }
            }
            const controller = new AbortController(); controller.abort();
            let aborted;
            try { await DetectLabGeoPackage.open(base + '/fixture.gpkg', { ...opts, signal: controller.signal }); }
            catch (error) { aborted = error.name; }
            return { visible, capped, empty, stats, failures, aborted };
        }, base);
        assert.equal(reader.visible.features.length, 3, 'multi-table, projected CRS and no-index envelope fallback');
        const p = reader.visible.features.find(feature => feature.id === 'projected/1').geometry.coordinates[0][0];
        assert(Math.abs(p[0] - 22.84) < 1e-6 && Math.abs(p[1] - 47.73) < 1e-6, 'EPSG:3857 reprojects to longitude/latitude');
        assert(reader.capped.truncated && reader.capped.features.length === 1);
        assert.equal(reader.empty.features.length, 0);
        assert.equal(reader.stats.totalBytes, fixture.length);
        assert(reader.stats.totalFetchedBytes < fixture.length / 10, 'small viewport must not fetch the full GeoPackage');
        assert.match(reader.failures[0], /range_requests_required/);
        assert.notEqual(reader.failures[1], 'unexpected success', 'reject incomplete range responses');
        assert.equal(reader.aborted, 'AbortError');
        assert.deepEqual(errors, [], 'no uncaught browser errors');
        // Also boot the actual application. Keep all unrelated third-party
        // APIs offline; supply one archaeological point and our GPKG fixture.
        const full = await browser.newContext({ viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' });
        await full.route('**/*', async route => {
            const req = route.request(), url = req.url();
            if (url.startsWith(base + '/')) return route.continue();
            if (url.includes('/Harti/ariinaturaleprotejate.gpkg')) {
                const response = dataResponse(req.headers().range, false);
                return route.fulfill({ ...response, body: req.method() === 'HEAD' ? Buffer.alloc(0) : response.body });
            }
            if (url.includes('/api/layers/')) {
                const point = { type: 'Feature', properties: { NUMESIT: 'Fixture archaeological site', CODSIT: 'TEST-1' }, geometry: { type: 'Point', coordinates: [22.88, 47.77] } };
                return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features: url.includes('/layers/0/') ? [point] : [] }) });
            }
            return route.abort();
        });
        const app = await full.newPage();
        await app.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
        await app.waitForFunction(() => window.DetectLabRomanianHeritage && window._dlMap && _dlMap._loaded);
        await app.evaluate(() => { _dlMap.setView([47.77, 22.88], 10, { animate: false }); toggleRomanianHeritage(true); });
        await app.waitForFunction(() => window._naturalProtectedLayer && _naturalProtectedLayer.getLayers().length === 3);
        await app.waitForFunction(() => _heritage3dBridge._dl3dFeatures().geojson.features.length > 0);
        await app.evaluate(() => { setPatrimoniuOpacity(38); setNaturalProtectedOpacity(64); setLang('ro'); });
        const actual = await app.evaluate(() => ({
            master: document.getElementById('heritageToggle').checked,
            arch: _dlMap.hasLayer(_patrimoniuLayer), nature: _dlMap.hasLayer(_naturalProtectedLayer),
            archPaint: _heritage3dBridge._dl3dFeatures().geojson.features.find(f => f.properties.kind === 'site').properties.fillOpacity,
            siteCanvas: document.querySelector('.leaflet-map-pane > canvas[style*="z-index: 655"]').style.opacity,
            title: document.getElementById('archaeologicalHeritageTitle').textContent,
            natureTitle: document.getElementById('naturalProtectedTitle').textContent,
            archMirrorTitle: _heritage3dBridge.options.name
        }));
        assert(actual.master && actual.arch && actual.nature);
        assert.equal(actual.siteCanvas, '0.38');
        assert(Math.abs(actual.archPaint - .9 * .38) < 1e-9, 'actual archaeology opacity reaches 2D and 3D pins');
        assert.equal(actual.title, 'Patrimoniu arheologic'); assert.equal(actual.natureTitle, 'Arii naturale protejate');
        assert.equal(actual.archMirrorTitle, 'Patrimoniu arheologic', '3D source label follows the archaeological child');
        await app.evaluate(() => {
            DetectLabVerticalOpacity.select('patrimoniuOpacitySlider');
            DetectLabVerticalOpacity.select('naturalProtectedOpacitySlider');
        });
        const owners = await app.locator('.vertical-opacity-control.visible').evaluateAll(nodes => nodes.map(n => n.dataset.owner));
        assert(owners.includes('patrimoniuOpacitySlider') && owners.includes('naturalProtectedOpacitySlider'), 'actual map-side mirrors belong to the two children');
        await app.evaluate(() => toggleRomanianHeritage(false));
        assert(!await app.evaluate(() => _dlMap.hasLayer(_patrimoniuLayer) || _dlMap.hasLayer(_naturalProtectedLayer)));
        // browser.close() below owns both contexts (Lambda Chromium runs in
        // single-process mode and cannot safely close one context in isolation).
        console.log('OK — real browser: full app, source switches, RO/EN, mobile controls, polygons/holes, escaped popups, 3D mirror, opacity, retry, SQLite ranges, CRS, limits and cancellation.');
        console.log(`Small viewport fetched ${reader.stats.totalFetchedBytes} of ${reader.stats.totalBytes} bytes (${reader.stats.totalRequests} range requests).`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
