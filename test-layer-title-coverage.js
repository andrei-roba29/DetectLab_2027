#!/usr/bin/env node
'use strict';
/* Dynamically generated layer titles must cover every menu language too. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = __dirname;
const UI_LANGS = ['en','ro','de','fr','it','es','pl','uk','hu','cs','sk','nl','bg','el','pt','da','sv','no','fi','et','lv','lt','hr','sr','sl'];
const FILES = ['js/layer-registry.js','js/danish-layers.config.js','js/finland-layers.config.js','js/asig-albania-layers.config.js','js/uk-heritage-layers.js'];

function findLanguageObjects(src, prop) {
    const out = [];
    const re = new RegExp('\\b' + prop + ':\\s*\\{', 'g');
    let m;
    while ((m = re.exec(src))) {
        const open = src.indexOf('{', m.index);
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
        if (end < 0) continue;
        let obj;
        try { obj = vm.runInNewContext('(' + src.slice(open, end) + ')'); } catch (e) { continue; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
        const keys = Object.keys(obj);
        if (!keys.some(k => UI_LANGS.includes(k))) continue;
        if (!keys.every(k => /^[a-z]{2,3}$/.test(k))) continue;
        out.push(obj);
    }
    return out;
}

let total = 0;
for (const rel of FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    let objects = [];
    for (const prop of ['title', 'label', 'groupLabel']) objects = objects.concat(findLanguageObjects(src, prop));
    objects.forEach((obj, i) => {
        UI_LANGS.forEach(lang => assert.ok(obj[lang] !== undefined,
            rel + ' object #' + (i + 1) + ' (' + (obj.en || '') + ') is missing ' + lang));
    });
    total += objects.length;
}
assert.ok(total > 200, 'the check covered the generated layer catalogues (got ' + total + ')');
console.log('OK — ' + total + ' dynamic title/label objects cover all 25 menu languages.');
