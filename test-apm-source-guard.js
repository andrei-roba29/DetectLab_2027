'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Spelled as codepoints so the guard itself does not reintroduce the forbidden identifier.
const forbidden = String.fromCharCode(97,114,105,97,100,110,101);
const hits = [];
function walk(dir) {
    for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
        if (['.git','node_modules'].includes(ent.name)) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile()) {
            const bytes = fs.readFileSync(p);
            if (!bytes.subarray(0,8192).includes(0) && bytes.toString('utf8').toLowerCase().includes(forbidden)) hits.push(p);
            if (p.toLowerCase().includes(forbidden)) hits.push(p+' (filename)');
        }
    }
}
walk(__dirname);
assert.deepEqual(hits,[], 'Removed site-source identifier must not return anywhere in the working tree');
console.log('PASS whole working-tree source guard (case-insensitive; Git internals and dependencies excluded)');
