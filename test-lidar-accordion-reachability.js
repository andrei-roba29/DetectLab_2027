/* LiDAR accordion reachability
 * ============================
 * The Danish LiDAR rows are mounted INSIDE the shared European LiDAR accordion
 * (`#lidarEuropeanSubLayers`), which ships collapsed (`max-height:0`). Two
 * things follow from that, and both were broken:
 *
 *   1. the chevron that opens the accordion (`#lidarExpandBtn`) must always be
 *      findable and must report its state — it used to be a ~16 px hotspot with
 *      no aria state, so on a phone it was effectively a dead switch;
 *   2. the accordion's master switch (`#lidarToggle`) only knew about
 *      `LIDAR_SUB_LAYERS`, so switching the family off left the Danish rows
 *      "on" inside a collapsed container — on the map, with no switch in reach.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('index.html');
const mapApp = read('js/map-app.js');
const danish = read('js/danish-layers.js');
const css = read('css/styles.css');

let checks = 0;
function check(ok, message) {
    if (!ok) {
        console.error('\n❌ ' + message);
        process.exitCode = 1;
        throw new Error(message);
    }
    checks += 1;
    console.log('  ✓ ' + message);
}

/* ── 1. The chevron is reachable ─────────────────────────────────────────── */
const btn = (html.match(/<button[^>]*id="lidarExpandBtn"[^>]*>/) || [])[0] || '';
check(btn, 'index.html renders #lidarExpandBtn');
check(/type="button"/.test(btn), 'it is an explicit button (no implicit submit)');
check(/onclick="toggleLidarSubLayers\(\)"/.test(btn), 'it still calls toggleLidarSubLayers()');
check(/aria-controls="lidarEuropeanSubLayers/.test(btn), 'it names the panels it controls');
check(/aria-expanded="false"/.test(btn), 'it starts reporting the collapsed state');
/* A 12 px icon with 2 px of padding is a ~16 px target: below every touch
   guideline, and the only way into the Danish LiDAR rows. */
const padding = (btn.match(/padding:(\d+)px/) || [])[1];
check(Number(padding) >= 8, 'its touch target is at least 16 px wide (padding:' + padding + 'px)');
check(/margin:-7px 0/.test(btn), 'the bigger target does not push the row taller');

/* ── 2. The chevron reports its state ───────────────────────────────────── */
check(mapApp.includes("expandBtn.setAttribute('aria-expanded', _lidarSubExpandedState ? 'true' : 'false')"),
    'toggleLidarSubLayers() keeps aria-expanded in step');
check(mapApp.includes('if (icon) icon.style.transform'),
    'a missing chevron icon cannot throw inside the toggle');

/* ── 3. The master switch reaches the Danish rows ───────────────────────── */
check(danish.includes('deactivatePanelGroup: function (groupId)'),
    'js/danish-layers.js exposes deactivatePanelGroup()');
check(mapApp.includes("dkLidar.deactivatePanelGroup('lidar')"),
    'the LiDAR master switch uses it when the family is turned off');
check(/runtime\.guard\[id\] = 'unknown'/.test(danish),
    'and the remembered probe verdict is dropped, so the next switch-on re-asks the deployment');

/* ── 4. The CSS keeps the taller target clickable ───────────────────────── */
/* Selectors, not text: the word may legitimately appear in a comment. */
const danishSelectors = css.split('}')
    .map((block) => block.split('{')[0] || '')
    .filter((sel) => /\.danish-(layer-row|group-row|group-sublayers)|#danishRow\b/.test(sel));
check(danishSelectors.length > 0, 'the Danish row rules were found (' + danishSelectors.length + ' selectors)');
const disabled = css.split('}')
    .filter((block) => /\.danish-(layer-row|group-row|group-sublayers)|#danishRow\b/.test(block.split('{')[0] || ''))
    .filter((block) => /pointer-events:\s*none/.test(block.split('{')[1] || ''));
check(disabled.length === 0, 'no Danish row rule disables pointer events');

console.log('\n✅ test-lidar-accordion-reachability.js passed all ' + checks + ' checks.\n');
