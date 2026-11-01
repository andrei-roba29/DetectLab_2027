'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/map3d-terrain.js', 'utf8');
const hint = source.slice(source.indexOf('    var desktopHint ='), source.indexOf('    /* ═', source.indexOf('    var desktopHint =')));
function check(navigator, coarse, language, expected) {
    const nodes = [];
    let timeout;
    const context = {
        root: { navigator, matchMedia: () => ({ matches: coarse }),
            setTimeout(fn, ms) { assert.equal(ms, 6000); timeout = fn; return 1; }, clearTimeout() {} },
        document: { createElement: () => ({ style: {}, setAttribute() {}, remove() { nodes.splice(nodes.indexOf(this), 1); } }),
            body: { appendChild: node => nodes.push(node) } },
        lang: () => language
    };
    vm.createContext(context);
    vm.runInContext(hint + '\nshowDesktopHint();', context);
    assert.equal(nodes.length, expected ? 1 : 0);
    if (expected) {
        assert.equal(nodes[0].textContent, expected);
        vm.runInContext('showDesktopHint();', context);
        assert.equal(nodes.length, 1, 'no duplicate hints');
        timeout();
        assert.equal(nodes.length, 0, 'hint auto-dismisses');
        vm.runInContext('showDesktopHint(); hideDesktopHint();', context);
        assert.equal(nodes.length, 0, 'exit cleanup');
    }
}
check({ userAgent: 'Windows', platform: 'Win32' }, false, 'ro', 'Foloseste CTRL + Click');
check({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }, false, 'en', 'Use CTRL +Click');
for (const navigator of [
    { userAgent: 'Android' }, { userAgent: 'iPhone' },
    { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 },
    { userAgentData: { mobile: true } }
]) check(navigator, false, 'en', null);
check({}, true, 'en', null);
assert(source.includes('if (!desktopHintShown)'), 'only show once per opening');
assert(source.includes('function close() {\n        hideDesktopHint();'), 'exit clears hint');
console.log('Desktop 3D hint: translations, mobile exclusions, deduplication and cleanup OK.');
