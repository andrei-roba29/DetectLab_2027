'use strict';
// Regression guard: Ariadne is no longer built or selectable as a TRAIN provider.
const assert=require('assert');
const providers=require('./js/apm-next/apm-providers.js');
assert.strictEqual(providers.createAriadneSiteProvider,undefined,'Ariadne provider must not be shipped');
assert.strictEqual(typeof providers.createCsvSiteProvider,'function','CSV fallback provider remains available');
console.log('Ariadne provider removed; CSV fallback retained.');
