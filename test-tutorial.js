// Regression test for the "?" map tutorial (js/tutorial.js). Static, no DOM:
// the walkthrough must track the real UI (IDs that exist), every slide must be
// bilingual, the Friends slide must open/close the real panel without ever
// popping the auth modal over the guide, and the shipped file must be
// cache-busted + pre-cached.
//
// Run: node test-tutorial.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TUT_SRC = fs.readFileSync(path.join(ROOT, 'js/tutorial.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const UI_SRC = ['index.html', 'js/friends.js', 'js/map-app.js', 'js/map-rotate.js', 'js/events.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

let passed = 0;
function check(name, cond, extra) {
    if (!cond) {
        console.error('✗ ' + name + (extra ? '\n    ' + extra : ''));
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log('✓ ' + name);
}

/* ── 1. Slide deck ─────────────────────────────────────────────────────── */
const stepIds = [...TUT_SRC.matchAll(/\{\s*\n\s*id: '(\w+)',/g)].map(m => m[1]);
check('the walkthrough has 13 slides covering controls, layers and recent features',
    JSON.stringify(stepIds) === JSON.stringify(['left', 'bottom', 'friends', 'layers', 'catalog', 'view3d', 'lidar3d', 'analysis', 'apmmanual', 'apmtrain', 'historical', 'tricks', 'performance']),
    JSON.stringify(stepIds));
check('the header comment describes the 13-slide walkthrough incl. Friends',
    /opens a 13-slide/.test(TUT_SRC) && /the Friends panel: unified people search/.test(TUT_SRC));

/* ── 2. Every arrow target resolves to a real control ──────────────────── */
// Collect every #id the tutorial points at and require it to exist in the
// shipped UI (markup or JS-rendered). Catches stranded selectors left behind
// by UI refactors (e.g. the removed PWA bottom bar).
const selLines = TUT_SRC.split('\n').filter(l => /^\s*sel: /.test(l));
const ids = new Set();
selLines.forEach(l => {
    const m = l.match(/#[A-Za-z][\w-]*/g) || [];
    m.forEach(id => ids.add(id));
});
check('the tutorial points at ' + ids.size + ' control ids', ids.size >= 10, [...ids].join(' '));
const missing = [...ids].filter(id => UI_SRC.indexOf(id.slice(1)) === -1);
check('every targeted id exists in the shipped UI', missing.length === 0, 'missing: ' + missing.join(' '));

/* ── 3. No stranded references to removed UI ───────────────────────────── */
['pwaBottomBar', 'pwa-bottom-bar', 'detectlab-compass-track', 'detectlab-compass-lock-dock',
 'SLIDE_MAX', 'Glisează busola', 'slide the compass'].forEach(function (stale) {
    check('no stranded reference to "' + stale + '"', TUT_SRC.indexOf(stale) === -1);
});

/* ── 4. Copy tracks the latest UI ──────────────────────────────────────── */
['＋ Adaugă prieten', '＋ Add friend', 'muresan', 'Mureșan', 'ana cluj',
 'sub busolă', 'under the compass',
 'butonul cu lupă', 'magnifier button', 'Stocare (pin-uri', 'Storage (pins'].forEach(function (snippet) {
    check('tutorial copy mentions "' + snippet + '"', TUT_SRC.indexOf(snippet) !== -1);
});

/* The installed PWA has separate bottom-right GPS and account controls. */
['în dreapta-jos', 'at the bottom-right'].forEach(function (snippet) {
    check('the live-location slide documents "' + snippet + '"', TUT_SRC.indexOf(snippet) !== -1);
});
['nu deschide meniul contului', 'does not open the account menu'].forEach(function (snippet) {
    check('the account slide distinguishes live location: "' + snippet + '"', TUT_SRC.indexOf(snippet) !== -1);
});
check('the account slide targets both the website and PWA account controls',
    /sel: \['#navUser', '#pwaUserItem'\]/.test(TUT_SRC));

['La prima poziție', 'următoarele actualizări GPS', 'On the first fix',
 'zoom out or pan', 'below live location', 'sub locația live'].forEach(function (snippet) {
    check('tutorial documents current live-location and account behavior: "' + snippet + '"', TUT_SRC.includes(snippet));
});
check('tutorial does not claim the PWA account menu is absent',
    !TUT_SRC.includes('not available from the installed app') && !TUT_SRC.includes('a fost scos din dreapta-jos'));

/* ── 5. Friends slide mechanics ────────────────────────────────────────── */
check('the friends slide opens the real panel on the search tab',
    /window\.openFriends\('search'\)/.test(TUT_SRC));
check('the guide only ever closes a panel it opened itself',
    /else if \(!open && state\.openedFriends\)/.test(TUT_SRC) &&
    /window\._closeFriendsPanel\(\)/.test(TUT_SRC));
check('an already-open panel is switched to the search tab, not rebuilt blindly',
    /#friendsManagerPanel \.fr-tab\[data-tab="search"\]/.test(TUT_SRC));
check('the friends slide points at both new tabs (search bar + friend list)',
    TUT_SRC.indexOf('data-tab="friends"') !== -1 &&
    TUT_SRC.indexOf('sel: \'#frSearchInput\'') !== -1);
check('signed-out visitors get an explanatory note, never the auth modal',
    /step\.requiresAuth && !signedIn\(\)/.test(TUT_SRC) &&
    /tr\(step\.authNote\)/.test(TUT_SRC) &&
    TUT_SRC.indexOf('openAuth') === -1);
check('waiting for the async friends render has a hard cap (never stuck)',
    /FRIENDS_MAX_WAIT = 6000/.test(TUT_SRC) && /waited >= FRIENDS_MAX_WAIT/.test(TUT_SRC));
check('closing the guide also closes a guide-opened friends panel',
    /ensureFriends\(false\)/.test(TUT_SRC));

/* ── 6. Bilingual completeness ─────────────────────────────────────────── */
// Evaluate only the declarative data, so inline and multiline translations
// are all checked (a regex silently misses long/one-line copy blocks).
const vm = require('vm');
const data = vm.runInNewContext(TUT_SRC.slice(TUT_SRC.indexOf('var STEPS = ['),
    TUT_SRC.indexOf('    // ── Slide transition timing')) + '\n({ STEPS, CATALOG, PERF });');
let translatedBlocks = 0;
function bilingual(value, location) {
    if (!value || typeof value !== 'object') return;
    if ('ro' in value || 'en' in value) {
        translatedBlocks++;
        check(location + ' has nonempty RO+EN copy',
            typeof value.ro === 'string' && value.ro.trim().length > 0 &&
            typeof value.en === 'string' && value.en.trim().length > 0);
        return;
    }
    Object.keys(value).forEach(key => bilingual(value[key], location + '.' + key));
}
bilingual(data, 'tutorial');
check('full bilingual coverage includes headings, notes and catalogue', translatedBlocks > 130);
const guides = data.STEPS.filter(step => step.type === 'guide');
check('seven feature cards have useful sections without invoking UI actions',
    guides.length === 7 && guides.every(step => step.sections.length >= 3 &&
        !step.openPanel && !step.openFriends && !step.requiresAuth));
function featureCopy(id) {
    const step = guides.find(step => step.id === id);
    return step.sections.map(section => section.desc.en).join(' ');
}
[
    ['view3d', ['Ctrl/⌘+drag', 'two fingers', 'non-LiDAR', 'DEM']],
    ['lidar3d', ['Whole layers', '1 km radius', 'not height measurements', 'numeric DTM']],
    ['apmmanual', ['Premium', '1–10 km', 'weight 0', 'GeoJSON', 'not calibrated']],
    ['apmtrain', ['50 km', 'Romanian', 'CSV', 'All periods', 'AUC/Kvamme', 'down-weighted']],
    ['historical', ['half a second', '3 km', 'Reset position', 'CORONA', 'Other maps']],
    ['tricks', ['two vertical controls', 'switches off only', '100 km²', '10 days']]
].forEach(([id, snippets]) => {
    const copy = featureCopy(id);
    snippets.forEach(snippet => check(id + ' documents ' + snippet,
        copy.toLowerCase().includes(snippet.toLowerCase())));
});
check('catalogue includes Next-Gen, vegetation fingerprint and Other maps',
    ['APM Next-Gen', 'Vegetation Fingerprint', 'Other maps'].every(name =>
        data.CATALOG.premium.some(layer => layer.name.en === name)));
check('feature cards use textContent and an accessible scroll region',
    /body.tabIndex = 0/.test(TUT_SRC) && /body.setAttribute\('role', 'region'\)/.test(TUT_SRC) &&
    /textContent = tr\(section.desc\)/.test(TUT_SRC));

/* ── 7. Versioned + pre-cached ─────────────────────────────────────────── */
const tutUrl = (INDEX_SRC.match(/src="(js\/tutorial\.js\?v=[^"]+)"/) || [])[1];
check('index.html loads a cache-busted js/tutorial.js', !!tutUrl, 'no ?v= on js/tutorial.js');
if (tutUrl) {
    check('that exact tutorial URL is pre-cached in sw.js',
        SW_SRC.indexOf("'" + tutUrl + "'") !== -1, tutUrl + ' not pre-cached');
}

console.log('\n' + passed + ' checks passed.');
if (process.exitCode) console.error('FAILED');
