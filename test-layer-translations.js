#!/usr/bin/env node
'use strict';
/* Every layer-panel label has an equivalent in every available language. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = __dirname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

const html = read('index.html');
const translations = parseTranslations(read('js/translations.js'));
const UI_LANGS = [...new Set([...html.matchAll(/data-lang="([a-z]{2})"/g)].map(m => m[1]))].sort();
assert.strictEqual(UI_LANGS.length, 25, 'all 25 menu languages are available');
assert.ok(UI_LANGS.includes('sl'), 'Slovenian is in the language menu');
UI_LANGS.forEach(lang => assert.ok(translations[lang], lang + ': dictionary exists'));
assert.strictEqual(Object.keys(translations).length, 25, 'exactly the 25 menu dictionaries exist');
assert.ok(!Object.prototype.hasOwnProperty.call(translations, 'ru'),
    'the legacy Russian pack is not one of the 25 menu dictionaries');

const enKeys = Object.keys(translations.en);
UI_LANGS.forEach(lang => {
    const missing = enKeys.filter(key => !(key in translations[lang]));
    assert.deepStrictEqual(missing, [], lang + ': has every English dictionary key');
});

const dataKeys = [...new Set([...html.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]))];
UI_LANGS.forEach(lang => {
    const missing = dataKeys.filter(key => !(key in translations[lang]));
    assert.deepStrictEqual(missing, [], lang + ': has every .t[data-key] translation');
});

const HIST = {
    en: 'Historical maps', ro: 'Hărți istorice', de: 'Historische Karten', fr: 'Cartes historiques',
    it: 'Mappe storiche', es: 'Mapas históricos', pl: 'Mapy historyczne', uk: 'Історичні карти',
    hu: 'Történelmi térképek', cs: 'Historické mapy', sk: 'Historické mapy', nl: 'Historische kaarten',
    bg: 'Исторически карти', el: 'Ιστορικοί χάρτες', pt: 'Mapas históricos', da: 'Historiske kort',
    sv: 'Historiska kartor', no: 'Historiske kart', fi: 'Historialliset kartat', et: 'Ajaloolised kaardid',
    lv: 'Vēsturiskās kartes', lt: 'Istoriniai žemėlapiai', hr: 'Povijesne karte', sr: 'Историјске карте',
    sl: 'Zgodovinski zemljevidi'
};
Object.entries(HIST).forEach(([lang, value]) => {
    assert.strictEqual(translations[lang].layer_historical, value, lang + ': free historical group name');
    assert.strictEqual(translations[lang].layer_historical_premium, value, lang + ': premium historical group name');
});

const enJson = JSON.parse(read('tools/en.json'));
const roJson = JSON.parse(read('tools/ro.json'));
assert.strictEqual(enJson.layer_historical_premium, 'Historical maps');
assert.strictEqual(roJson.layer_historical_premium, 'Hărți istorice');
assert.strictEqual(roJson.layer_historical, 'Hărți istorice');

assert.doesNotMatch(html, /Hărți istorice\s*\/\s*Historical Maps/,
    'the premium group no longer shows a hard-coded bilingual name');
assert.ok(/data-key="layer_historical_premium">Hărți istorice</.test(html),
    'the Romanian fallback text uses the proper diacritics');
assert.ok(read('js/translations.js').includes('window._t ='),
    'dynamic layer rows have a translation lookup helper');
assert.ok(Number((read('sw.js').match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]) >= 402,
    'the service-worker cache was bumped for the new dictionaries');

console.log('OK — 25 menu languages, ' + dataKeys.length + ' static keys and canonical historical-map names.');
