'use strict';
// Dev-only Chromium. Real Leaflet/panel/pipeline/workers; synthetic providers,
// premium entitlement and free-land mask. No production services or phone claims.
if (!process.env.PUPPETEER_MODULE_DIR || !process.env.CHROMIUM_EXECUTABLE_PATH) {
    console.log('SKIP loading-preview browser: set PUPPETEER_MODULE_DIR and CHROMIUM_EXECUTABLE_PATH');
    return;
}
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const puppeteer = require(path.join(process.env.PUPPETEER_MODULE_DIR, 'puppeteer-core'));
const scripts = ['apm-core', 'apm-raster', 'apm-heatmap', 'apm-sites', 'romania-periods.config', 'apm-providers', 'hoards.config',
    'apm-hoards', 'apm-hoard-provider', 'apm-hoard-scale', 'apm-romania-sites', 'apm-i18n', 'apm-train-cache', 'apm-pipeline', 'apm-loading-preview'];
const setup = `
window.fixture={events:[],ledger:[],atPrediction:false,done:false};
window._dlIsPremium=()=>true;
localStorage.setItem('detectlab_lang','en');
window._dlMap=L.map('detectlab-map',{center:[46.77,23.59],zoom:11});
L.polyline([[46,23.6],[48,23.6]],{color:'#a5a0b0',weight:3,interactive:false}).addTo(_dlMap);
L.control.scale({imperial:false}).addTo(_dlMap);
window.computeArcheoExclusionMask=g=>new Promise((resolve,reject)=>{
 fixture.atPrediction=true;
 fixture.release=()=>resolve({mask:new Uint8Array(g.w*g.h),stats:{unknown:0}});
 fixture.fail=()=>reject(new Error('Synthetic prediction failure'));
});
const records=Array.from({length:24},(_,i)=>({id:String(i),name:'Fixture site '+i,
 lat:46.77+((i%6)-3)*.026,lon:23.59+(Math.floor(i/6)-2)*.04,
 type:'settlement',positionAccuracy:5,source:'csv',periods:[]}));
records._meta={outsideRomania:false,returned:24,usable:24,total:24};
DetectLabRomaniaApmSites.createProvider=()=>({getSites:async()=>records});
function elev(g){return Float32Array.from({length:g.w*g.h},(_,i)=>{
 const lon=g.west+(i%g.w+.5)*g.dLon,lat=g.north-(Math.floor(i/g.w)+.5)*g.dLat;
 return 300+100*Math.sin(lon*80)+70*Math.cos(lat*95)+lon*10;
});}
DetectLabApmProviders.demPlan=()=>[{use:true,provider:{id:'fixture-dem',label:'Synthetic DEM',nominalResM:500,
 fetchBlock:async g=>{fixture.ledger.push(['dem',g]);return elev(g);}}}];
DetectLabApmProviders.waterPlan=()=>[{use:true,provider:{id:'fixture-water',label:'Synthetic water',fetchWater:async box=>{
 fixture.ledger.push(['water',box]);return {lines:[{cls:'small',coords:[[23.6,46],[23.6,48]]}],polygons:[],meta:{}};
}}}];
const realRun=DetectLabApmPipeline.runTrain;
DetectLabApmPipeline.runTrain=(session,params)=>{
 fixture.events=[];fixture.ledger=[];fixture.atPrediction=false;fixture.done=false;fixture.error=null;
 params.bgCount=100;params.cacheInputs=false;
 let seed=4211;params.rnd=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const callback=params.onPreview;
 if(callback)params.onPreview=e=>{fixture.events.push(e);callback(e);};
 const job=realRun(session,params);
 job.then(r=>{fixture.result=r;fixture.done=true;},e=>{fixture.error=e.message;fixture.done=true;});
 return job;
};
document.addEventListener('DOMContentLoaded',()=>{DetectLabApmUi.init();DetectLabApmUi.setEnabled(true);});
`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/leaflet.css"><link rel="stylesheet" href="/css/next-gen-apm.css">
<style>html,body{margin:0;height:100%;background:#0d1420;font:13px system-ui;color:#eee}.map-frame{position:relative;height:100%;width:100%}
#detectlab-map{height:100%;background-color:#303841;background-image:linear-gradient(#45495255 1px,transparent 1px),linear-gradient(90deg,#45495255 1px,transparent 1px);background-size:48px 48px}
.fixture-label{position:absolute;left:55px;top:10px;z-index:1100;max-width:70%;background:#111c;padding:8px;border-radius:5px;font-size:11px}</style></head>
<body><div class="map-frame"><div id="detectlab-map"></div><div class="fixture-label">OFFLINE SYNTHETIC FIXTURE · Real Leaflet + TRAIN worker · not production map data</div></div>
<script src="/js/leaflet.js"></script>${scripts.map(s => '<script src="/js/apm-next/' + s + '.js"></script>').join('')}
<script>${setup}</script><script src="/js/apm-next/apm-ui.js"></script></body></html>`;
async function click(page, text) {
    assert(await page.evaluate(text => {
        const b = [...document.querySelectorAll('#apmNextPanel button')].find(b => b.textContent.trim() === text);
        if (!b || b.disabled) return false; b.click(); return true;
    }, text), 'button unavailable: ' + text);
}
(async () => {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture');
        if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
        const f = path.resolve(__dirname, '.' + url.pathname);
        if (!f.startsWith(__dirname + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
        res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        res.end(fs.readFileSync(f));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--js-flags=--expose-gc'] }).catch(error => { server.close(); throw error; });
    const directory = path.join(__dirname, 'test-results/partial-preview'); fs.mkdirSync(directory, { recursive: true });
    const evidence = { scope: 'Chromium synthetic provider fixtures; real Leaflet/panel/pipeline/worker; no installed phone or production claim', browser: await browser.version(), viewports: [] };
    try {
        for (const width of [1280, 390]) {
            const page = await browser.newPage(), errors = [], forbidden = [];
            page.on('pageerror', e => errors.push(e.stack || e.message));
            await page.setViewport({ width, height: width === 390 ? 844 : 900, deviceScaleFactor: 2, isMobile: width === 390, hasTouch: width === 390 });
            await page.setRequestInterception(true);
            page.on('request', r => { if (r.url().startsWith(origin + '/')) r.continue(); else { forbidden.push(r.url()); r.abort(); } });
            if (width === 390) await page.evaluateOnNewDocument(() => {
                const real = window.matchMedia.bind(window);
                window.matchMedia = query => query.includes('display-mode: standalone') ? { matches: true, addEventListener() {}, removeEventListener() {} } : real(query);
                document.addEventListener('DOMContentLoaded', () => { document.body.classList.add('is-pwa'); document.documentElement.classList.add('is-pwa'); });
            });
            await page.goto(origin, { waitUntil: 'networkidle0' });
            await click(page, 'Pick point on map');
            await page.mouse.click(width / 2, (width === 390 ? 844 : 900) / 2);
            await click(page, 'TRAIN');
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Run TRAIN model' && !b.disabled));
            await click(page, 'Run TRAIN model');
            await page.waitForFunction(() => fixture.atPrediction && document.querySelector('.apm-preview-values')?.textContent.includes('Altitude'));
            const layers = await page.evaluate(() => Object.keys(_dlMap._layers).length);
            const frames = await page.evaluate(async () => { const dt = []; let last; await new Promise(resolve => {
                const end = performance.now() + 1100; function tick(t) { if (last) dt.push(t - last); last = t;
                    if (t < end) requestAnimationFrame(tick); else resolve(); } requestAnimationFrame(tick);
            }); return dt; });
            for (const phase of ['water', 'relief', 'soil']) {
                await page.evaluate(p => document.querySelector('[data-preview-key="preview.' + p + '"]').click(), phase);
                await page.screenshot({ path: path.join(directory, width + '-' + phase + '.png') });
            }
            const layout = await page.evaluate(() => {
                const p = document.querySelector('#apmNextPanel').getBoundingClientRect(), c = document.querySelector('canvas.apm-preview-canvas');
                return { panel: { left: p.left, right: p.right, width: p.width }, canvasWidth: c.width, cssWidth: c.getBoundingClientRect().width,
                    buttons: [...document.querySelectorAll('.apm-preview-button')].map(b => b.getBoundingClientRect().height),
                    scope: document.querySelector('.apm-loading-preview').textContent, picking: !!window.dlApmPicking,
                    requestLedger: fixture.ledger, previewEvents: fixture.events.length };
            });
            assert(layout.panel.left >= 0 && layout.panel.right <= width); assert(layout.buttons.every(h => h >= 44));
            assert(layout.canvasWidth <= layout.cssWidth * 2 + 1); assert(!layout.picking);
            assert(layout.scope.includes('4 of 24')); assert(!/NaN|Infinity|undefined/.test(layout.scope));
            await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
            await page.screenshot({ path: path.join(directory, width + '-reduced.png') });
            await page.evaluate(() => { localStorage.setItem('detectlab_lang', 'ro'); document.dispatchEvent(new Event('detectlab:langchange')); });
            assert(await page.evaluate(() => document.querySelector('.apm-loading-preview').textContent.includes('Cum este eșantionat mediul')));
            await page.evaluate(() => { localStorage.setItem('detectlab_lang', 'en'); document.dispatchEvent(new Event('detectlab:langchange')); fixture.release(); });
            await page.waitForFunction(() => fixture.done && !document.querySelector('.apm-loading-preview'));
            assert.equal(await page.evaluate(() => fixture.error), null);
            const baseline = await page.evaluate(() => JSON.stringify({ ledger: fixture.ledger, thresholds: fixture.result.thresholds,
                areas: fixture.result.areaKm2, weights: fixture.result.diagnostics.weights, polygons: fixture.result.geojson, heatmap: Array.from(fixture.result.heatmap.rgba) }));
            // Disabled: same cold source calls and final outputs, no preview events or canvas.
            await page.evaluate(() => { document.querySelector('#apmLoadingPreviewEnabled').checked = false; });
            await click(page, 'Run TRAIN model'); await page.waitForFunction(() => fixture.atPrediction);
            assert.equal(await page.$('.apm-loading-preview'), null);
            await page.evaluate(() => fixture.release()); await page.waitForFunction(() => fixture.done);
            assert.equal(await page.evaluate(() => fixture.events.length), 0);
            const off = await page.evaluate(() => JSON.stringify({ ledger: fixture.ledger, thresholds: fixture.result.thresholds,
                areas: fixture.result.areaKm2, weights: fixture.result.diagnostics.weights, polygons: fixture.result.geojson, heatmap: Array.from(fixture.result.heatmap.rgba) }));
            assert.equal(off, baseline);
            await page.evaluate(() => { document.querySelector('#apmLoadingPreviewEnabled').checked = true; });
            // Skip is not Cancel: worker completes with exactly the same provider ledger.
            await click(page, 'Run TRAIN model'); await page.waitForFunction(() => fixture.atPrediction);
            await page.click('[data-preview-key="preview.skip"]');
            assert.equal(await page.$('.apm-loading-preview'), null); assert(!await page.evaluate(() => fixture.done));
            await page.evaluate(() => fixture.release()); await page.waitForFunction(() => fixture.done);
            // Close does not cancel pipeline; an error also cleans the preview.
            await click(page, 'Run TRAIN model'); await page.waitForFunction(() => fixture.atPrediction);
            await page.evaluate(() => DetectLabApmUi.close()); assert.equal(await page.$('.apm-loading-preview'), null);
            await page.evaluate(() => { fixture.release(); DetectLabApmUi.open(); }); await page.waitForFunction(() => fixture.done);
            await click(page, 'Run TRAIN model'); await page.waitForFunction(() => fixture.atPrediction);
            await page.evaluate(() => fixture.fail()); await page.waitForFunction(() => fixture.done && !document.querySelector('.apm-loading-preview'));
            assert.equal(await page.evaluate(() => fixture.error), 'Synthetic prediction failure');
            // Repeated starts/cancels: inspect live DOM/layers and retained JS heap after forced GC.
            const cdp = await page.createCDPSession(), heaps = [];
            const layersBeforeCancel = await page.evaluate(() => Object.keys(_dlMap._layers).length);
            for (let n = 0; n < 10; n++) {
                await click(page, 'Run TRAIN model'); await page.waitForFunction(() => fixture.atPrediction);
                await page.click('[data-preview-key="run.cancel"]');
                await page.evaluate(() => fixture.release()); await page.waitForFunction(() => fixture.done);
                assert.equal(await page.$('.apm-loading-preview'), null);
                await cdp.send('HeapProfiler.collectGarbage'); heaps.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
            }
            assert.equal(await page.evaluate(() => Object.keys(_dlMap._layers).length), layersBeforeCancel, 'cancelled previews never change existing result/map layers');
            assert.equal(forbidden.length, 0); assert.deepEqual(errors, []);
            evidence.viewports.push({ width, standaloneCssEmulated: width === 390, ...layout, rAFIntervalsMs: frames, tenCancelHeapBytes: heaps,
                note: 'rAF intervals are browser callback intervals, not proof of physical-phone FPS; GC heap is not whole-browser memory.' });
            await page.close();
        }
        fs.writeFileSync(path.join(directory, 'browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
        console.log('PASS Chromium preview phases, 1280/390 standalone CSS, reduced motion, output/request equivalence, skip/close/error/10 cancels.');
    } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
