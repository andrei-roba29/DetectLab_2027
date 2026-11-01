const assert = require('node:assert/strict');
const api = require('./js/apm-next/apm-romania-sites.js');
assert.equal(api.normaliseName('Așezarea   COTOFENI'), 'asezarea cotofeni');
assert.equal(api.inferPeriod('Asezarea Cotofeni de la Romanesti').periodLabel, 'Eneolitic / Chalcolitic');
assert.equal(api.inferPeriod('Situl arheologic de la Roman - centru').periodLabel, 'unknown');
assert.equal(api.isExcludedType('Necropola romana de la Alba'), true);
assert.equal(api.insideRomania(46,25), true);
assert.equal(api.insideRomania(51,10), false);
console.log('Canonical Romania inference/provider checks pass');
