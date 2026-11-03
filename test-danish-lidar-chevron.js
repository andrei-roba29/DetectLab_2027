'use strict';

/* Heritage, Historical maps and Ortophoto are generated at runtime, so the
 * LiDAR-style arrow is verified both in the renderer source and in the
 * stylesheet / service-worker wiring that makes the change reach a browser. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./js/danish-layers.config.js');

const ROOT = __dirname;
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const js = read('js/danish-layers.js');
const css = read('css/styles.css');
const html = read('index.html');
const sw = read('sw.js');
const danishTest = read('test-danish-layers.js');
const panelRowsTest = read('test-layer-panel-rows.js');
const mobileTest = read('test-map3d-mobile.js');

let checks = 0;
function check(condition, message) {
    assert.ok(condition, message);
    checks++;
}

const groups = CONFIG.panelGroups
    .filter((group) => !group.mount && group.id !== 'lidar')
    .map((group) => group.id);
check(JSON.stringify(groups) === JSON.stringify(['heritage', 'historical', 'orthophoto']),
    'the three generated Denmark sections are Heritage, Historical maps and Ortophoto');

/* 1. The renderer uses the LiDAR accordion's 12 x 12 SVG chevron. */
check(js.includes("var SVG_NS = 'http://www.w3.org/2000/svg';"), 'SVG namespace is declared');
check(js.includes("document.createElementNS(SVG_NS, 'svg')"), 'a real SVG chevron is created');
check(js.includes("document.createElementNS(SVG_NS, 'polyline')") ||
    js.includes("svgElement('polyline'"), 'the SVG polyline is created');
check(js.includes('<polyline points="2,4 6,8 10,4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />'),
    'the exact LiDAR polyline markup is present');
check(js.includes('width="12" height="12" viewBox="0 0 12 12" fill="none"'),
    'the chevron keeps LiDAR’s 12 x 12 viewBox');
check(js.includes('aria-hidden="true" focusable="false"'), 'the decorative SVG is hidden from assistive tech');
check(js.includes('transition:transform 0.25s ease'), 'the arrow has LiDAR’s quarter-second rotation');
check(js.includes('transform:rotate(-90deg)'), 'the collapsed arrow is rotated -90 degrees');
check(js.includes("expanded ? 'rotate(0deg)' : 'rotate(-90deg)'"), 'expansion rotates the arrow to 0 degrees');
check(!js.includes('▾'), 'the red triangular text glyph is gone from the Danish renderer');
check(!js.includes('rgba(214,69,80,0.85)'), 'the red arrow colour is gone');
check(!js.includes('rgba(214,69,80,0.3)'), 'the red section rail is gone');
check(!js.includes('font-size:0.72rem'), 'the old text-arrow sizing is gone');

/* 2. LiDAR blue, hover/focus, and the three groups' shared chrome. */
check(js.includes("var LIDAR_BLUE = 'rgba(79,195,247,0.8)';"), 'LiDAR blue at rest is shared');
check(js.includes("var LIDAR_BLUE_HOVER = '#4fc3f7';"), 'LiDAR hover blue is shared');
check(js.includes("var LIDAR_BLUE_RAIL = 'rgba(79,195,247,0.3)';"), 'LiDAR blue rail is shared');
check(js.includes("var LIDAR_STYLE_GROUP_IDS = ['heritage', 'historical', 'orthophoto'];"),
    'only the three requested Denmark groups are marked LiDAR-style');
check(js.includes('transition:color 0.2s'), 'the expand button has LiDAR’s colour transition');
check(js.includes("onmouseover: \"this.style.color='#4fc3f7'\""), 'hover brightens the arrow');
check(js.includes("onmouseout: \"this.style.color='rgba(79,195,247,0.8)'\""), 'mouseout restores LiDAR blue');
check(js.includes("expandBtn.addEventListener('mouseover'"), 'hover also works without inline handlers');
check(js.includes("expandBtn.addEventListener('focus'"), 'keyboard focus brightens the arrow');
check(js.includes("'aria-controls': bodyId"), 'the arrow controls its group body');
check(js.includes("'aria-expanded': expanded ? 'true' : 'false'"), 'aria-expanded still reflects the group');
check(js.includes("entry.body.setAttribute('aria-hidden', expanded ? 'false' : 'true')"),
    'collapsed bodies are hidden from assistive tech');
check(js.includes("'data-lidar-arrow': 'true'"), 'the arrow carries a LiDAR-style marker');
check(js.includes("'data-chevron-svg', LIDAR_CHEVRON_SVG"), 'the exact SVG markup is exposed for DOM checks');
check(js.includes('danish-group-chevron dl-expand-chevron lidar-style-chevron'),
    'a shared chevron class is used by all three groups');
check(js.includes('layer-info-btn danish-group-info lidar-style-info'),
    'group headers carry the LiDAR-style info button');
check(js.includes('window.showDanishInfo()'), 'the group info button opens the Danish info panel');
check(js.includes('showDanishGroupInfo()'), 'the group info click has a no-inline-JS path');
check(js.includes('LIDAR_GROUP_MARKER_SVG'), 'group headers use the LiDAR-style leading marker');
check(js.includes('circle cx="6.5" cy="6.5" r="4.5" stroke="#4fc3f7"'),
    'the leading marker is the LiDAR blue target');
check(js.includes('role: \'group\''), 'the generated section is an accessible group');
check(js.includes('role: \'region\''), 'the generated body is an accessible region');
check(js.includes('aria-labelledby'), 'group and body are labelled by the translated title');
check(js.includes('transp-layer-row active danish-group-row lidar-style-group'),
    'the row keeps the shared glass row and gains LiDAR-style classes');
check(js.includes("'data-lidar-arrow-group': isLidarStyleGroup ? 'true' : 'false'"),
    'LiDAR-style gating is explicit on each section');
check(js.includes('styleLidarChevron(icon, runtime.expanded)'), 'the legacy static icon is restyled too');
check(js.includes("icon.innerHTML = LIDAR_CHEVRON_SVG"), 'the legacy static icon receives the SVG chevron');

/* 3. Stylesheet: hover, focus, blue rail and reduced motion. */
check(css.includes('.danish-group-chevron'), 'stylesheet styles the Danish chevron');
check(css.includes('.lidar-style-chevron'), 'stylesheet styles the shared LiDAR chevron class');
check(css.includes('.dl-expand-chevron'), 'stylesheet styles the expand-chevron class');
check(css.includes('#danishExpandIcon'), 'stylesheet covers the legacy static icon');
check(css.includes('color: rgba(79,195,247,0.8)'), 'stylesheet uses LiDAR blue at rest');
check(css.includes('color: #4fc3f7'), 'stylesheet uses the brighter hover blue');
check(css.includes('transition: transform 0.25s ease'), 'stylesheet animates arrow rotation');
check(css.includes('transition: color 0.2s'), 'stylesheet animates hover colour');
check(css.includes('outline: 2px solid #4fc3f7'), 'group focus rings are blue');
check(css.includes('border-left-color: rgba(79,195,247,0.3) !important'), 'group rails are LiDAR blue');
check(css.includes('border-left: 2px solid rgba(79, 195, 247, 0.3)'), 'the outer Denmark rail is blue');
check(css.includes('transform: rotate(0deg)'), 'expanded chevrons point down');
check(css.includes('transform: rotate(-90deg)'), 'collapsed chevrons point right');
const reducedMotionBlocks = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g) || [];
const reducedMotion = reducedMotionBlocks.find((block) => block.includes('.danish-group-chevron')) || '';
check(reducedMotion.includes('.danish-group-chevron'),
    'reduced motion includes the dynamic Danish chevrons');
check(reducedMotion.includes('#danishExpandIcon'),
    'reduced motion includes the legacy Danish icon');
check(reducedMotion.includes('transition: none !important'),
    'reduced motion disables the arrow transition');
check(reducedMotion.includes('.danish-group-expand-btn'),
    'reduced motion disables the button transition');
check(reducedMotion.includes('.danish-group-sublayers'),
    'reduced motion disables the body transition');

/* 4. Runtime test stub and cache-busting wiring. */
check(danishTest.includes('createElementNS'), 'the Danish DOM stub supports SVG elements');
check(danishTest.includes('danish-group-chevron'), 'the Danish suite asserts the new SVG chevron');
check(danishTest.includes('aria-hidden'), 'the Danish suite asserts the accessible collapsed state');
check(panelRowsTest.includes("const STYLES_TAG = '20261103-danish-lidar-chevron';"),
    'the stylesheet-tag test follows the live tag');
check(mobileTest.includes("'js/danish-layers.js': '20261103-danish-lidar-chevron'"),
    'the mobile cache test follows the live renderer tag');

const cssUrl = 'css/styles.css?v=20261103-danish-lidar-chevron';
const jsUrl = 'js/danish-layers.js?v=20261103-danish-lidar-chevron';
check(html.includes('href="' + cssUrl + '"'), 'index.html loads the restyled stylesheet');
check(html.includes('src="' + jsUrl + '"'), 'index.html loads the restyled renderer');
check(!html.includes('href="css/styles.css?v=20261102-report-lidar-window"'),
    'the old stylesheet tag is no longer live');
check(!html.includes('src="js/danish-layers.js?v=20261103-layer-i18n"'),
    'the old renderer tag is no longer live');
check(sw.includes("const CACHE_NAME = 'detectlab-v403-danish-lidar-chevron';"),
    'the service-worker shell is bumped to v403');
const cacheNum = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
check(cacheNum >= 403, 'the service-worker cache number is at least 403');
check(sw.includes("'" + cssUrl + "'"), 'sw.js precaches the live stylesheet URL');
check(sw.includes("'" + jsUrl + "'"), 'sw.js precaches the live renderer URL');
check(sw.includes("'css/styles.css?v=20261102-report-lidar-window'"),
    'historical stylesheet precache entries are preserved');
check(sw.includes("'js/danish-layers.js?v=20261103-layer-i18n'"),
    'the previous renderer precache entry is preserved');
check(!js.includes('layer-group-arrow-highlight'), 'the forbidden arrow-highlight class is not introduced');

console.log('\n✅ test-danish-lidar-chevron.js passed all ' + checks + ' checks successfully.');
