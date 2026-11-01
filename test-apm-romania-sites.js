'use strict';
const assert=require('assert');
const cfg=require('./js/apm-next/romania-periods.config.js');
const api=require('./js/apm-next/apm-romania-sites.js');
let n=0;function test(name,fn){try{fn();n++;console.log('  ok',name)}catch(e){console.error(' FAIL',name,e);process.exitCode=1;}}
test('normalises diacritics and whitespace',()=>assert.strictEqual(api.normaliseName('  Cetatea  Oradeá '),'cetatea oradea'));
test('uses descriptive part before de la (Roman/Romanesti place names do not imply Roman period)',()=>{assert.strictEqual(api.inferPeriod('Situl arheologic de la Roman - cartier').periodLabel,'unknown');assert.strictEqual(api.inferPeriod('Situl arheologic de la Romanesti - punct').periodLabel,'unknown');assert.strictEqual(api.inferPeriod('Castru roman de la X - punct').periodLabel,'Roman');});
test('specific period keywords win over substrings (Eneolitic is not Neolitic)',()=>{assert.strictEqual(api.inferPeriod('Cultura eneolitica de la X').periodLabel,'Eneolitic / Chalcolitic');});
test('name without de la uses whole name and lower confidence',()=>{let r=api.inferPeriod('Castru roman - centru');assert.strictEqual(r.periodLabel,'Roman');assert.strictEqual(r.confidence,'low');});
test('editable non-settlement exclusions',()=>{assert(api.isExcludedType('Necropola medievala'));assert(api.isExcludedType('Ruinele bisericii'));assert(!api.isExcludedType('Asezare medievala'));});
test('position dedupe requires close coordinates AND same normalized name; never groups by CODSIT',()=>{let rows=[{name:'Așezare Romană',lat:46,lon:25,codsit:'1.01'},{name:'Asezare Romana',lat:46.00001,lon:25,codsit:'1.02'},{name:'Asezare Romana',lat:46.01,lon:25,codsit:'1.03'}];assert.strictEqual(api.dedupe(rows).length,2);});
test('Romania boundary and border-crossing background restriction',()=>{assert(api.insideRomania(46,25));assert(!api.insideRomania(51,10));const pipe=require('./js/apm-next/apm-pipeline.js');let seed=123456;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);const bg=pipe.sampleBackground({lat:43.8,lon:25},70000,40,[],0,rnd,(lat,lon)=>api.insideRomania(lat,lon));assert(bg.length>0);assert(bg.every(p=>api.insideRomania(p.lat,p.lon)));});
test('COORD config defaults to DA-only; empty positions opt-in setting exists',()=>{assert.strictEqual(cfg.includeEmptyCoord,false);assert(cfg.periods.length>=7);});
console.log(`${n} Romania provider checks passed`);
