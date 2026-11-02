#!/usr/bin/env node
'use strict';

// Real Leaflet + map-rotate regression: the 1 km focus disc and its centre
// must follow a reference geographic marker on EVERY frame, not just zoomend.
// Uses the shipped renderer/drawDisc and 3D -> 2D camera handoff functions.
// Optional browser dependencies (no app/package changes needed):
// npm install --prefix /tmp/browser-tools puppeteer-core @sparticuz/chromium
// PUPPETEER_MODULE_DIR=/tmp/browser-tools/node_modules node test-lidar-disc-zoom-anchor.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const source = read('js/lidar-3d-focus.js');
const renderer = source.slice(source.indexOf('    var discRenderer = null;'), source.indexOf('    function clearDisc()'));
assert(renderer.includes('function drawDisc('));
assert.strictEqual((source.match(/renderer: discRendererOption\(map, pane\)/g) || []).length, 3,
    'disc, centre dot and point-picking preview must all use the anchored renderer');
assert(read('index.html').includes('js/lidar-3d-focus.js?v=20261102-lidar-disc-zoom-anchor'));
assert(read('sw.js').includes('js/lidar-3d-focus.js?v=20261102-lidar-disc-zoom-anchor'));

function loadBrowser() {
    for (const dir of [process.env.PUPPETEER_MODULE_DIR, path.join(__dirname, 'node_modules'), '/home/user/browser-tools/node_modules'].filter(Boolean)) {
        try {
            const req = createRequire(path.join(dir, 'index.js'));
            const chromium = req('@sparticuz/chromium');
            return { puppeteer: req('puppeteer-core'), chromium: chromium.default || chromium };
        } catch (_) { /* optional local installation */ }
    }
    return null;
}
const deps = loadBrowser();
if (!deps) {
    console.log('PASS: renderer/cache wiring; SKIP browser checks (install optional dependencies above).');
    process.exit(0);
}
const viewer = read('js/map3d-terrain.js');
const cameraFunctions = ['bearingFlip', 'settleLeafletMotion', 'cameraTo2D'].map(name => {
    const match = viewer.match(new RegExp('function ' + name + '\\([^]*?\\n {4}\\}'));
    assert(match, 'production handoff function: ' + name);
    return match[0];
}).join('\n');

(async () => {
    const browser = await deps.puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await deps.chromium.executablePath(),
        args: deps.chromium.args, headless: true
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1000, height: 800 });
        await page.setContent('<div id="map" style="width:900px;height:700px"></div>');
        await page.addStyleTag({ content: read('css/leaflet.css') });
        await page.addScriptTag({ content: read('js/leaflet.js') });
        await page.addScriptTag({ content: read('js/map-rotate.js') });
        await page.addScriptTag({ content: `
            var lmap = L.map('map', {rotate:true, zoomAnimation:true}).setView([45.12,24.34], 14);
            function leaflet() { return L; }
            function leafletMap() { return lmap; }
            var PANE_NAME = 'pane_lidar_3d_focus', PANE_Z = 656;
            function ensurePane(map) {
                var pane = map.getPane(PANE_NAME) || map.createPane(PANE_NAME);
                pane.style.zIndex = PANE_Z;
                pane.style.pointerEvents = 'none';
            }
            var discState = {circle:null, dot:null};
            ${renderer}
            var map;
            ${cameraFunctions}
            drawDisc({lat:45.12,lng:24.34,radiusKm:1});
            var reference = L.marker([45.12,24.34], {icon:L.divIcon({
                className:'reference', iconSize:[8,8], iconAnchor:[4,4]
            })}).addTo(lmap);
            window.checkView = async function(bearing, width, height) {
                document.getElementById('map').style.width = width + 'px';
                document.getElementById('map').style.height = height + 'px';
                lmap.invalidateSize({animate:false});
                // Mimic the real close(): cameraTo2D copies bearing, centre and zoom.
                map = {getCenter:()=>({lat:45.119,lng:24.341}), getZoom:()=>14,
                       getBearing:()=>-bearing};
                cameraTo2D();
                lmap.panBy([12,-8], {animate:false});
                await new Promise(r=>setTimeout(r,50));
                var maxError = 0, frames = 0;
                function measure() {
                    var rect = reference.getElement().getBoundingClientRect();
                    var ref = {x:rect.x+rect.width/2, y:rect.y+rect.height/2};
                    [discState.circle, discState.dot].forEach(layer=>{
                        var el=layer.getElement(), box=el.getBBox();
                        var p=new DOMPoint(box.x+box.width/2,box.y+box.height/2)
                            .matrixTransform(el.getScreenCTM());
                        maxError=Math.max(maxError,Math.hypot(p.x-ref.x,p.y-ref.y));
                    });
                    frames++;
                }
                for (var zoom of [15,13,16,14]) {
                    await new Promise(resolve=>{
                        var running=true;
                        function frame() { measure(); if(running) requestAnimationFrame(frame); }
                        lmap.once('zoomend', ()=>{running=false; measure(); resolve();});
                        // Off-centre zoom: scaling around the wrong origin is most obvious here.
                        lmap.setZoomAround(L.point(width*0.53,height*0.48),zoom,{animate:true});
                        requestAnimationFrame(frame);
                    });
                    await new Promise(r=>setTimeout(r,40));
                }
                return {bearing,width,height,maxError,frames,radius:discState.circle.getRadius()};
            };
        ` });
        for (const [width, height] of [[900, 700], [390, 620]]) {
            for (const bearing of [0, 35, 90, -120]) {
                const result = await page.evaluate((b, w, h) => window.checkView(b, w, h), bearing, width, height);
                assert(result.frames > 12, 'real zoom animation frames must be sampled');
                assert.strictEqual(result.radius, 1000, 'ground radius remains 1 km');
                // Leaflet rounds path/marker points independently; an 8x animated
                // zoom amplifies their sub-pixel difference to a few pixels.
                assert(result.maxError < 6, JSON.stringify(result));
                console.log('PASS', JSON.stringify(result));
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
