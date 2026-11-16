// Test suite for the layers window's glass material and the per-row tile photo
// of every historical-map sublayer.
// Usage: node test-layer-panel-rows.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('[Test] Layers window: glass rows + historical tile-photo rows...');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const css = read('css/styles.css');
const html = read('index.html');
const sw = read('sw.js');
const moduleSource = read('js/layer-panel-rows.js');
const registrySource = read('js/layer-registry.js');
/* The registry mirrors the Danish config, so the sandbox loads it first — the
 * very order index.html uses. Without it the Danish rows cannot be checked. */
const danishConfigSource = read('js/danish-layers.config.js');

const flatHtml = html.replace(/\n\s*/g, ' ');
function ruleOf(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing CSS rule for ' + selector);
    return m[1];
}

/* ── 1. The window and its rows are ONE material: the control glass ────── */
const panel = ruleOf(css, '.transp-panel');
assert(/backdrop-filter:\s*var\(--ctl-blur\)/.test(panel),
    'the layers window blurs what is behind it with the control glass blur');
assert(/var\(--ctl-border\)/.test(panel),
    'the window edge is the violet control border, not the old sky-blue one');
assert(!/rgba\(10,20,42,0\.97\)/.test(panel),
    'the near-opaque navy slab must be gone — the window is translucent now');
const panelAlpha = (panel.match(/rgba\(20,14,34,var\(--panel-top-alpha\)\)/) || [])[0];
assert(panelAlpha, 'the window carries its own violet tint behind the blur');
assert(/--panel-top-alpha:\s*0\.6\d/.test(panel) && /--panel-bottom-alpha:\s*0\.7\d/.test(panel),
    'both tint stops stay under 0.8 alpha so the map really shows through');
assert(/padding:\s*22px 16px 0/.test(panel), 'the compact panel padding is unchanged');

const rows = ruleOf(css, '.transp-layer-row,\n        .dl-sublayer-row');
assert(/background:\s*var\(--ctl-bg\)/.test(rows) && /border:\s*1px solid var\(--ctl-border\)/.test(rows),
    'layer rows use the same translucent violet box as the map controls');
assert(!/backdrop-filter/.test(rows),
    'rows add no second blur layer inside the already-blurred window — the blur is the pane\'s');
assert(/position:\s*relative/.test(rows), 'rows anchor their own background photo');
assert(/--row-radius:\s*var\(--ctl-radius\)/.test(rows), 'the row radius comes from the control material');

/* Nested rows the accordions render take the very same rule. */
const subRows = ruleOf(css, '#transpPanel .dl-sublayer-row');
assert(/--row-radius:\s*10px/.test(subRows), 'nested rows are a compact version of the same box');
console.log('  ✓ window + top-level rows + nested rows share the --ctl-* glass material');

/* ── 2. The tile photo: mean-ed out, violet-washed, under the controls ─── */
const before = ruleOf(css, '.transp-layer-row[data-row-preview]::before,\n        .dl-sublayer-row[data-row-preview]::before');
assert(/background-image:\s*var\(--row-preview\)/.test(before),
    'the row background is the layer\'s own tile, passed in as --row-preview');
const filter = (before.match(/filter:([^;]+);/) || [])[1] || '';
assert(!/blur\(/.test(filter), 'tile details remain recognizable, not blurred away');
assert(/saturate\(0\.85\)/.test(filter) && /brightness\(0\.9\)/.test(filter),
    'the preview keeps map colours and detail beneath the dark wash');
assert(/opacity:\s*0\.95/.test(before), 'the preview is visible rather than a faint colour wash');
assert(/clip-path:\s*inset\(0 round var\(--row-radius\)\)/.test(before),
    'the blur is clipped back to the row radius');

const after = ruleOf(css, '.transp-layer-row[data-row-preview]::after,\n        .dl-sublayer-row[data-row-preview]::after');
assert(/linear-gradient\(180deg,\s*rgba\(45,33,74,0\.4/.test(after),
    'a violet fade sits on top of the photo');
assert(/radial-gradient\([^)]*rgba\(126,94,214,0\.30\)/.test(after), 'the fade carries the engaged-violet tint');

const above = ruleOf(css, '.transp-layer-row[data-row-preview] > *,\n        .dl-sublayer-row[data-row-preview] > *');
assert(/z-index:\s*1/.test(above), 'the switch, slider, info button and labels paint above the photo');
console.log('  ✓ the photo is a mean, violet-washed backdrop underneath the controls');

/* ── 3. Every historical sublayer row opts in, and every id resolves ───── */
const tagged = [...html.matchAll(/data-preview-layer="([^"]+)"/g)].map(m => m[1]);
assert(tagged.length === 29, 'all 29 remaining historical sublayer rows carry a preview layer id (got ' + tagged.length + ')');
assert.deepStrictEqual(tagged, [...new Set(tagged)], 'no row is tagged twice');

const fakeDocument = {
    readyState: 'complete',
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};
const sandboxWindow = { document: fakeDocument };
const sandbox = {
    window: sandboxWindow,
    document: fakeDocument,
    console,
    setTimeout, clearTimeout,
    Image: function () {}
};
vm.createContext(sandbox);
vm.runInContext(danishConfigSource, sandbox, { filename: 'js/danish-layers.config.js' });
vm.runInContext(registrySource, sandbox, { filename: 'js/layer-registry.js' });
assert(sandboxWindow.DetectLabLayers, 'the shared registry loads before the row chrome');
vm.runInContext(moduleSource, sandbox, { filename: 'js/layer-panel-rows.js' });

const api = sandboxWindow.DetectLabPanelRows;
assert(api && typeof api.urlFor === 'function' && typeof api.urlsFor === 'function' && api.anchors,
    'js/layer-panel-rows.js exports its URL and fallback-candidate APIs');
assert(typeof api.isHistoricalSheet === 'function' && api.sparsePreviews,
    'the row chrome exports the sheet test and its extra-candidate table');

tagged.forEach(id => {
    assert(sandboxWindow.DetectLabLayers.get(id), 'unknown layer id on a row: ' + id);
    const candidates = api.urlsFor(id);
    assert(candidates.length > 0, 'no tile-photo candidates for the tagged row ' + id);
    const url = api.urlFor(id);
    assert(url, 'no tile-photo URL for the tagged row ' + id);
    assert(/^https:\/\//.test(url), 'the row photo is an https tile request: ' + id);
});

/* Every historical layer of the registry either declares a bounding box or is
 * listed in the anchors table — a new sheet cannot silently lose its photo. */
const historical = sandboxWindow.DetectLabLayers.list().filter(def =>
    (def.group === 'hist-free' || def.group === 'hist-premium') &&
    ['xyz', 'arcgis-image', 'wms'].indexOf(def.kind) !== -1 &&
    !def.runtimeOverlays);
const unbounded = historical.filter(def => !def.bounds || def.bounds.length !== 2);
unbounded.forEach(def => {
    assert(api.anchors[def.id], 'unbounded historical layer without an anchor: ' + def.id);
});
console.log('  ✓ ' + tagged.length + ' tagged rows resolve; ' + unbounded.length + ' unbounded layers are anchored');

/* ── 4. The URL really is one of that layer's OWN tiles ────────────────── */
const escapeLiteral = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Split a tile template into its literal parts and its {z}/{x}/{y} tokens, so
 * the generated URL can be read back without assuming an order: ArcGIS
 * pyramids are {z}/{y}/{x}, XYZ pyramids are {z}/{x}/{y}. */
function readBack(template, url) {
    const pieces = template.split(/(\{[zxy]\})/);
    const names = [];
    let pattern = '';
    pieces.forEach(piece => {
        const token = /^\{([zxy])\}$/.exec(piece);
        if (token) {
            names.push(token[1]);
            pattern += '(\\d+)';
        } else {
            pattern += escapeLiteral(piece);
        }
    });
    const m = new RegExp('^' + pattern + '$').exec(url);
    if (!m) return null;
    const out = {};
    names.forEach((name, i) => { out[name] = Number(m[i + 1]); });
    return out;
}

function tileCentre(tile) {
    const span = Math.pow(2, tile.z);
    const n = Math.PI - 2 * Math.PI * (tile.y + 0.5) / span;
    return {
        lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
        lng: (tile.x + 0.5) / span * 360 - 180
    };
}

const pyramids = historical.filter(def => def.kind === 'xyz' || def.kind === 'arcgis-image');
let bounded = 0;
pyramids.forEach(def => {
    const previewUrl = api.urlFor(def.id);
    if (api.sheetPhotos && api.sheetPhotos[def.id]) {
        assert.strictEqual(previewUrl, api.sheetPhotos[def.id],
            def.id + ' previews its supplied sheet scan');
        return;
    }
    const parsed = readBack(def.url, previewUrl);
    assert(parsed, 'the row photo is built from the layer tile template: ' + def.id);
    assert(parsed.z >= (def.minZoom || 0) && parsed.z <= (def.maxZoom || 22),
        'the preview zoom is inside the layer zoom window: ' + def.id);
    if (def.bounds && def.bounds.length === 2) {
        const centre = tileCentre(parsed);
        const south = def.bounds[0][0], west = def.bounds[0][1];
        const north = def.bounds[1][0], east = def.bounds[1][1];
        assert(centre.lat >= south - 0.5 && centre.lat <= north + 0.5 &&
               centre.lng >= west - 0.5 && centre.lng <= east + 0.5,
            'the preview tile falls inside ' + def.id + ' (' + centre.lat.toFixed(3) + ', ' +
            centre.lng.toFixed(3) + ' vs its declared bounds)');
        bounded++;
    }
});
assert(bounded >= 8, 'the bounded pyramids are checked against their own footprint');
console.log('  ✓ ' + pyramids.length + ' tile pyramids resolve to a tile inside their own coverage');

/* Sparse sheets must try known or in-coverage tiles at several zooms. */
assert.strictEqual(api.urlFor('premium.walachia-1855'),
    'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/szathm-ri-s-series-1-57-600-5-l.jpg',
    'Walachia uses the Szathmári sheet as its layer-panel preview');
assert.strictEqual(api.urlsFor('premium.walachia-1855').length, 1,
    'Walachia does not fall back to an empty XYZ tile');
const sparseBounds = {
    'premium.moldova-1868': [44.9959, 26.2354, 48.3124, 29.8389],
    'premium.polish-tactical-1933': [47.6950, 22.0166, 48.3124, 28.3887],
    'premium.ww1': [43.3252, 22.3242, 48.3416, 29.8828],
    'premium.ww2': [43.8345, 20.0391, 48.4584, 29.8828]
};
Object.keys(sparseBounds).forEach(id => {
    const def = sandboxWindow.DetectLabLayers.get(id);
    const tiles = api.urlsFor(id).map(url => readBack(def.url, url));
    assert(tiles.length >= 6 && new Set(tiles.map(tile => tile.z)).size >= 3,
        id + ' retries across locations and native zoom levels');
    const [south, west, north, east] = sparseBounds[id];
    tiles.forEach(tile => {
        assert(tile && tile.z >= def.minZoom && tile.z <= def.maxNativeZoom, id + ' native zoom');
        const c = tileCentre(tile);
        assert(c.lat >= south - 1 && c.lat <= north + 1 && c.lng >= west - 1 && c.lng <= east + 1,
            id + ' preview stays near its footprint');
    });
});

/* WMS mosaics preview through a small GetMap over the sheet's middle. */
const josephine = api.urlFor('premium.josephine');
assert(/r2\.dev\/Josephine\/\d+\/\d+\/\d+\.jpg$/.test(josephine), 'Josephine previews its own R2 mosaic tile');

const mitteleuropa = api.urlFor('premium.mitteleuropa');
['service=WMS', 'request=GetMap', 'version=1.1.1', 'layers=ihpan%3Aukvme_2180',
    'srs=EPSG:3857', 'width=168', 'height=96', 'transparent=true'].forEach(part => {
    assert(mitteleuropa.includes(part), 'the WMS preview carries ' + part);
});
const titleLayer = sandboxWindow.DetectLabLayers.get('premium.mitteleuropa');
assert(mitteleuropa.startsWith(titleLayer.url), 'the preview asks the layer\'s own WMS endpoint');

const austrian = api.urlFor('hist.austrian');
assert(/version=1\.1\.0/.test(austrian) && /srs=EPSG:3857/.test(austrian),
    'a 1.1.0 service is asked with SRS, not CRS');
assert(/layers=eharta%3Amozaic_austrian_200k/.test(austrian), 'the free historical rows preview too');

/* The CENAGIS catalogue rows are resolved from their data-map-id. */
const cenagisUrl = api.urlFor('cenagis.wig100k');
assert(/layers=ihpan%3Awig100k_3857/.test(cenagisUrl),
    'a CENAGIS catalogue row previews its own catalogue sheet');

/* Non-historical layers are left alone. */
assert.strictEqual(api.urlFor('premium.josephine') && api.urlFor('basemap.osm'), null,
    'only historical layers get a row photo');
console.log('  ✓ WMS mosaics preview through GetMap; XYZ/ArcGIS through their own tile template');

/* ── 4b. Denmark: the generated Historical maps rows join the others ──
 * js/danish-layers.js builds its rows at runtime, so nothing Danish is tagged
 * in index.html: the renderer tags each sheet row with its registry id, and
 * the registry says which Danish layers are map sheets (`panelGroup:
 * 'historical'`, mirrored from js/danish-layers.config.js). The photo is a
 * small GetMap through the same-origin /api/geo/dk-dtk25 proxy — the sheet's
 * own endpoint — so the Dataforsyningen token stays server-side for the row
 * background too. */
const danishConfig = sandboxWindow.DANISH_LAYERS_CONFIG;
assert(danishConfig && typeof danishConfig.byId === 'function',
    'the Danish config (loaded before the registry) describes the sheets');
const danishSheets = danishConfig.panelGroups
    .find(group => group.id === 'historical').layers
    .map(id => 'danish.' + id);
assert(danishSheets.length >= 6, 'Denmark still publishes its six historical sheets');
danishSheets.forEach(id => {
    const def = sandboxWindow.DetectLabLayers.get(id);
    assert(def, 'the registry mirrors the Danish sheet ' + id);
    assert.strictEqual(def.panelGroup, 'historical', id + ' is filed under Historical maps');
    assert(api.isHistoricalSheet(def), id + ' is a map sheet, so its row gets a photo');
    /* The mirror carries no bounding box, and the country-wide one would
     * centre in the Kattegat: the anchor table names a town of the series. */
    assert(api.anchors[id], id + ' has an anchor town its own series covers');
    const urls = api.urlsFor(id);
    assert(urls.length > 0, id + ' resolves to at least one GetMap window');
    const url = urls[0];
    assert(url.startsWith(def.url), id + " previews through the layer's own endpoint: " + url);
    assert(/^\/api\/geo\/dk-dtk25/.test(url),
        id + ' stays on the same-origin proxy — no credential in the row photo');
    ['service=WMS', 'request=GetMap', 'version=1.3.0', 'crs=EPSG:3857',
        'transparent=false', 'width=168', 'height=96'].forEach(part => {
        assert(url.includes(part), id + ' carries ' + part);
    });
    assert(url.includes('layers=' + encodeURIComponent(def.layer)),
        id + ' asks for its own WMS layer name');
});

/* The other three Danish sections are registers, hillshades and orthophoto
 * years — not sheets — so their rows keep the plain glass box. */
['lidar', 'heritage', 'orthophoto'].forEach(groupId => {
    danishConfig.panelGroups.find(group => group.id === groupId).layers.forEach(layerId => {
        const id = 'danish.' + layerId;
        const def = sandboxWindow.DetectLabLayers.get(id);
        assert(def, 'the registry mirrors ' + id);
        assert(!api.isHistoricalSheet(def), id + ' is not a historical map sheet');
        assert.strictEqual(api.urlFor(id), null, id + ' gets no row photo');
    });
});

/* The scanned series are sheet-by-sheet, so the two narrowest keep alternates
 * the loader tries in order; a sheet with none asks for one window only. */
assert(api.urlsFor('danish.hist_preussen').length >= 4,
    'the Prussian sheets (South Jutland only) try more than one town');
assert(api.urlsFor('danish.hist_hoeje').length >= 4,
    'the 1842–1899 high sheets try more than one town');
assert.strictEqual(api.urlsFor('danish.hist_lave').length, 1,
    'a sheet with no declared alternates still asks for exactly one window');

/* The renderer is what tags the rows, and only the config's own panelGroup
 * decides — so a new Danish sheet is photographed the day it is added. */
const danishRenderer = read('js/danish-layers.js');
assert(danishRenderer.includes("var isHistoricalSheet = layer.panelGroup === 'historical';"),
    "js/danish-layers.js decides the row photo from the config's panelGroup");
assert(danishRenderer.includes("'data-preview-layer': isHistoricalSheet ? 'danish.' + layer.id : null"),
    'the generated sheet rows carry their registry id, and only they do');
console.log('  ✓ Denmark: ' + danishSheets.length +
    ' generated sheet rows preview through the same-origin proxy');

/* End to end, on a stubbed pane: a Danish sheet row that is on screen really
 * gets its photo painted, and a row of the same module that is not a sheet is
 * never even asked. (The real rows are built by js/danish-layers.js; only the
 * tag and the registry id matter here.) */
{
    function fakeRow(id, previewId) {
        const attrs = { 'data-preview-layer': previewId };
        const props = {};
        return {
            id,
            style: { setProperty: (name, value) => { props[name] = value; }, props },
            getAttribute: name => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
            setAttribute: (name, value) => { attrs[name] = String(value); },
            hasAttribute: name => Object.prototype.hasOwnProperty.call(attrs, name),
            removeAttribute: name => { delete attrs[name]; },
            getClientRects: () => [{}],          /* on screen */
            parentElement: null,
            classList: { contains: () => false, add() {} }
        };
    }
    const sheet = fakeRow('danishRow_hist_hoeje', 'danish.hist_hoeje');
    const hillshade = fakeRow('danishRow_lidar_hillshade_historik', 'danish.lidar_hillshade_historik');
    const host = {
        querySelectorAll: selector => selector.indexOf('data-preview-layer') !== -1 ? [sheet, hillshade] : [],
        classList: { contains: name => name === 'open' },
        addEventListener() {}
    };
    sheet.parentElement = host;
    hillshade.parentElement = host;
    const asked = [];
    /* The module reads everything off its own `root`, which is the page's
     * `window` — the stub's Image lives there, not on the vm global. */
    sandboxWindow.Image = function () {
        const img = {};
        Object.defineProperty(img, 'src', {
            set(value) { asked.push(value); if (img.onload) img.onload(); }   /* the proxy answered */
        });
        return img;
    };
    fakeDocument.getElementById = id => (id === 'transpPanel' ? host : null);
    api.sweep();
    assert.deepStrictEqual(asked, [api.urlFor('danish.hist_hoeje')],
        "exactly one request goes out, for that sheet's own GetMap");
    assert(sheet.hasAttribute('data-row-preview'), 'the sheet row is marked as carrying a photo');
    assert.strictEqual(sheet.getAttribute('data-row-preview-state'), 'ok',
        'the loaded tile is painted, not left pending');
    const painted = sheet.style.props['--row-preview'] || '';
    assert(/^url\("\/api\/geo\/dk-dtk25\?layer=hist_hoeje/.test(painted),
        '--row-preview is the same-origin proxy GetMap: ' + painted);
    assert.strictEqual(hillshade.getAttribute('data-row-preview-state'), 'unavailable',
        'a LiDAR hillshade row is not a map sheet');
    assert(!hillshade.hasAttribute('data-row-preview'), 'so it keeps the plain glass box');
    fakeDocument.getElementById = () => null;
    sandboxWindow.Image = function () {};
}
console.log('  \u2713 a Danish sheet row paints its own tile; its LiDAR neighbour does not');


/* ── 5. Loading is lazy, greedy-free and failure-tolerant ──────────────── */
assert(/data-row-preview-state/.test(moduleSource),
    'a row remembers it was already tried, so a dead service is asked once');
assert(/img\.onerror/.test(moduleSource) && /data-row-preview-state', 'failed'/.test(moduleSource),
    'a tile that fails to load leaves the plain glass row behind');
assert(/READY\[url\]/.test(moduleSource) && /BROKEN\[url\]/.test(moduleSource),
    'a loaded tile is remembered and a broken one is never retried — the CENAGIS '
    + 'catalogue re-renders on every country change');
assert(/MAX_IN_FLIGHT/.test(moduleSource) && /pump\(\)/.test(moduleSource),
    'requests are capped instead of opening one socket per row');
assert(/classList\.contains\('open'\)/.test(moduleSource),
    'nothing is fetched while the window is closed');
assert(/subtree:\s*true/.test(moduleSource),
    'the pane observer watches the rows too: the country filter shows and hides '
    + 'them by class while the click lands outside the window');
assert(/getClientRects/.test(moduleSource),
    'collapsed accordions and hidden tabs are skipped until they are shown');
assert(/\.cenagis-map-row/.test(moduleSource) && /removeAttribute\('style'\)/.test(moduleSource),
    'the CENAGIS rows drop their generated inline dark box and take the shared material');
assert(/SubLayers\$/.test(moduleSource), 'the nested rows are found through their *SubLayers containers');
console.log('  ✓ previews load only for visible rows, once, and fail soft');

/* Refreshing generated rows must not erase an already-loaded background. */
{
    const classes = new Set();
    let removals = 0;
    const row = {
        classList: { contains: key => classes.has(key), add: key => classes.add(key) },
        removeAttribute: name => { assert.strictEqual(name, 'style'); removals++; }
    };
    const host = { querySelectorAll: selector => selector === '.cenagis-map-row' ? [row] : [] };
    fakeDocument.getElementById = id => id === 'transpPanel' ? host : null;
    api.markGlass();
    api.markGlass();
    assert.strictEqual(removals, 1, 'later sweeps preserve the preview custom property');
    fakeDocument.getElementById = () => null;

}

/* ── 6. Wiring: cache-busting, precache, shell version ─────────────────── */
const TAG = '20261115-danish-panel-rows';
const STYLES_TAG = '20261115-danish-panel-rows';
assert(html.includes('js/layer-panel-rows.js?v=' + TAG), 'index.html loads the row chrome, versioned');
assert(sw.includes("'js/layer-panel-rows.js?v=" + TAG + "'"), 'sw.js precaches the row chrome');
const stylesUrl = (html.match(/href="(css\/styles\.css\?v=[^"]+)"/) || [])[1];
assert(stylesUrl && stylesUrl.endsWith(STYLES_TAG), 'the restyled stylesheet is re-tagged (' + stylesUrl + ')');
assert(sw.includes("'" + stylesUrl + "'"), 'sw.js precaches the live stylesheet URL');
const cacheNum = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
assert(cacheNum >= 270, 'the service-worker cache is bumped for the new shell (got v' + cacheNum + ')');
const stylesTagPos = html.indexOf('css/styles.css?v=' + STYLES_TAG);
const rowsTagPos = html.indexOf('js/layer-panel-rows.js?v=' + TAG);
const registryTagPos = html.indexOf('js/layer-registry.js?v=');
assert(registryTagPos !== -1 && registryTagPos < rowsTagPos,
    'the row chrome loads after the registry it reads its endpoints from');
assert(stylesTagPos !== -1, 'the stylesheet is wired');
console.log('  ✓ cache wiring: ?v=' + TAG + ', shell v' + cacheNum);

console.log('\nAll layers-window glass + row-photo checks passed.');
