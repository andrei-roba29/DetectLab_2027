/* Planuri de tragere · „Dezactivează fundal” (vector tiles)
 * =======================================================
 * The firing-plans row can swap its raster mosaic for the traced MVT tiles.
 * These checks pin the contract:
 *
 *   1. the checkbox exists in the panel, under the row, translated everywhere;
 *   2. it is wired to a handler that loads the module lazily and remembers
 *      the choice — nothing about the vector is downloaded before a tick;
 *   3. the module draws an OUTLINE, no fill, in orange (#ff7a00);
 *   4. the raster WMS is taken off the map while the vector stands in, and put
 *      back when the box is cleared — and the row's own switch stays master;
 *   5. a storage/CORS failure is reported in the row, never silently blank;
 *   6. the asset is precached and the shell version is bumped.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html');
const css = read('css/styles.css');
const mapApp = read('js/map-app.js');
const sw = read('sw.js');
const vector = read('js/firing-plans-vector.js');

let checks = 0;
function ok(message) {
    checks += 1;
    console.log('  ✓ ' + message);
}

/* ── 1. The checkbox sits under the row, in the panel ───────────────────── */
const rowStart = html.indexOf('id="firingPlansRow"');
const sovietStart = html.indexOf('id="sovietMapRow"');
assert.ok(rowStart !== -1 && sovietStart > rowStart, 'the firing-plans row exists in index.html');
const rowHtml = html.slice(rowStart, sovietStart);
assert.ok(rowHtml.includes('id="firingPlansDisableBg"'), 'the checkbox lives INSIDE the firing-plans row');
assert.ok(/type="checkbox"/.test(rowHtml.slice(rowHtml.indexOf('firingPlansDisableBg') - 200)),
    'it is a checkbox');
assert.ok(rowHtml.includes('onchange="setFiringPlansVectorBackground(this.checked)"'),
    'it calls the handler with its own state');
assert.ok(rowHtml.includes('data-key="layer_disable_background"'),
    'the label is translated through the shared .t[data-key] mechanism');
assert.ok(rowHtml.includes('id="firingPlansVectorStatus"'),
    'the row has its own status line for failures');
assert.ok(/role="status"/.test(rowHtml), 'the status line is announced without stealing focus');
ok('the „Dezactivează fundal” checkbox is under the firing-plans row');

/* ── 2. The label exists in all 25 languages ────────────────────────────── */
function parseTranslations(src) {
    const start = src.indexOf('const translations = {');
    const open = src.indexOf('{', start);
    let depth = 0, quote = null, esc = false, inLine = false, inBlock = false, end = -1;
    for (let i = open; i < src.length; i++) {
        const ch = src[i], next = src[i + 1];
        if (inLine) { if (ch === '\n') inLine = false; continue; }
        if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
        if (quote) { if (esc) { esc = false; continue; } if (ch === '\\') { esc = true; continue; } if (ch === quote) quote = null; continue; }
        if (ch === '/' && next === '/') { inLine = true; i++; continue; }
        if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const sandbox = {};
    vm.runInNewContext('translations = ' + src.slice(open, end) + ';', sandbox);
    return sandbox.translations;
}
const translations = parseTranslations(read('js/translations.js'));
const langs = Object.keys(translations);
assert.strictEqual(langs.length, 25, 'all 25 dictionaries are present');
const missing = langs.filter((l) => !translations[l].layer_disable_background);
assert.deepStrictEqual(missing, [], 'every language has the „Disable background” label');
assert.strictEqual(translations.ro.layer_disable_background, 'Dezactivează fundal', 'the Romanian label is exact');
assert.strictEqual(translations.en.layer_disable_background, 'Disable background', 'the English label is exact');
ok('the label is translated in all 25 languages (RO + EN exact)');

/* ── 3. Wiring: lazy, remembered, and one owner of the handler ──────────── */
assert.ok(mapApp.includes('window.setFiringPlansVectorBackground = function (enabled)'),
    'map-app.js owns the inline handler (so it exists before the module loads)');
assert.ok(mapApp.includes("script.src = 'js/firing-plans-vector.js?v="),
    'the vector module is injected lazily, not shipped with the shell');
assert.ok(mapApp.includes("localStorage.setItem('detectlab.firingPlansVectorOn'"),
    'the visitor\'s choice is remembered');
assert.ok(mapApp.includes("localStorage.getItem('detectlab.firingPlansVectorOn')"),
    'and restored on the next visit');
/* Exactly one owner: the module must NOT redeclare the two globals. */
assert.ok(!/window\.setFiringPlansVectorBackground\s*=/.test(vector),
    'the module never competes with map-app.js for the inline handler');
assert.ok(!/window\.setFiringPlansVectorOpacity\s*=/.test(vector),
    'nor for the opacity helper');
assert.ok(vector.includes('setBackground: setBackground') && vector.includes('setOpacity: setOpacity'),
    'it exposes both through window.FiringPlansVector instead');
ok('the checkbox is lazy, remembered, and has a single handler owner');

/* ── 4. Outline only, orange, no fill ───────────────────────────────────── */
assert.ok(vector.includes("var STROKE = '#ff7a00';"), 'the outline is orange (#ff7a00)');
assert.ok(/fill: false/.test(vector), 'polygons are drawn with NO fill');
assert.ok(/fillOpacity: 0/.test(vector), 'and no residual fill opacity');
assert.ok(/stylePass\(STROKE, 3\)/.test(vector),
    'a clearly visible 3 px stroke (stylePass(STROKE, 3))');
assert.ok(/lineCap: 'round'/.test(vector) && /lineJoin: 'round'/.test(vector),
    'rounded joins keep the traced rings readable');
assert.ok(vector.includes('radius: 4'), 'stray points stay visible without a fill');
ok('the vector is an orange outline with no fill');

/* ── 5. Raster swap and the row master ──────────────────────────────────── */
assert.ok(vector.includes('function rasterVisible('), 'the module can take the raster off the map');
assert.ok(/state\.vectorOn && state\.rowOn/.test(vector), 'the vector needs BOTH the box and the row');
assert.ok(mapApp.includes("var vectorOn = !!(window.FiringPlansVector && window.FiringPlansVector.state.vectorOn)"),
    'toggling the row respects a ticked box');
assert.ok(mapApp.includes('window.setFiringPlansRowActive(!!on)'),
    'the row switch tells the vector module its state');
assert.ok(mapApp.includes('window.setFiringPlansRowActive(!!(on && fToggleRow && fToggleRow.checked))'),
    'and so does the Historical-maps master switch');
ok('the raster is swapped out and the row switch stays the master');

/* ── 6. Failures are visible ────────────────────────────────────────────── */
assert.ok(vector.includes("tileerror"), 'tile failures are watched');
assert.ok(vector.includes('loadingFailed'), 'and reported in the row');
assert.ok(vector.includes('rendererFailed'), 'a missing renderer is reported too');
assert.ok(!/console\.(warn|error)/.test(vector.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the module explains failures in the UI, not only in the console');
ok('a storage/CORS failure is reported in the row');

/* ── 7. Cache wiring ────────────────────────────────────────────────────── */
assert.ok(sw.includes("'js/firing-plans-vector.js?v=20261114-firing-vector'"),
    'sw.js precaches the vector module');
assert.ok(sw.includes("'js/Leaflet.VectorGrid.js?v="), 'sw.js precaches the MVT renderer');
const shell = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
assert.ok(shell >= 424, 'the service-worker shell is bumped (got v' + shell + ')');
const cssUrl = (html.match(/href="(css\/styles\.css\?v=[^"]+)"/) || [])[1];
assert.ok(cssUrl && sw.includes("'" + cssUrl + "'"), 'the live stylesheet is precached under the same tag');
assert.ok(/\.firingplans-bg-toggle/.test(css), 'the checkbox has its own style block');
assert.ok(/\.firingplans-bg-status/.test(css), 'and the status line does too');
ok('the shell, the stylesheet and both vector assets are cache-tagged together');

console.log('\n✅ test-firing-plans-vector.js passed all ' + checks + ' checks.\n');
