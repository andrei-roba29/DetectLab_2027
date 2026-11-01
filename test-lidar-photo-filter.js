// Offline regression: all 17 photo effects stay distinguishable, tile footprint is bounded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const panes = {};
const map = {
  createPane(n) { panes[n] = {style:{}}; }, getPane(n) { return panes[n]; },
  on() {}, getZoom() {return 17;},
  project({lat,lng}, z) {return {x:(lng+180)/360*256*2**z,y:(90-lat)/180*256*2**z};}
};
const win = {_dlMap:map,L:{GridLayer:{extend:()=>function(){}}}};
const doc = {body:{appendChild(){}},createElement(){return {hidden:true,setAttribute(){}};}};
vm.runInNewContext(fs.readFileSync('js/lidar-photo-filter.js','utf8'),{
  window:win,document:doc,console,CustomEvent:class{}
});
const {effect,tileCoordinates,chooseZoom,zoomTiles} = win.DLPhotoFilter._test;
const ids=['hillshade','multi-hillshade','slope','slrm','msrm','mstp','svf','asvf',
  'openness','local-dominance','sky-illumination','vat','combined-vat',
  'prismatic-openness','crim','e2mstp','e3mstp'];
const outputs=ids.map(id=>effect(100,110,120,20,-10,id));
assert.equal(outputs.length,17);
assert.equal(new Set(outputs.map(o=>JSON.stringify(o))).size,17, 'distinct visual responses');
const center={lat:52,lng:5};
const z=chooseZoom(center,{maxzoom:18});
assert.ok(z<=17 && tileCoordinates(center,z).length+tileCoordinates(center,z-1).length<=96);
console.log('Photo effects: 17 distinct styles; <=96 prefetched tiles.');

// Service windows (MapServer minLOD/maxLOD): LAKI III 9–17, Ro5m 7–15.
// The photo filter must never request a level the provider does not publish.
const laki = {minzoom:9, maxzoom:17};
const lakiZ = chooseZoom(center, laki);
assert.ok(lakiZ >= 9 && lakiZ <= 17, 'LAKI III stays inside its published window z9–z17');
assert.ok(zoomTiles(center, 17, 9).every(t => t.z >= 9), 'no LAKI III tile below z9');
const lowMap = map.getZoom; map.getZoom = () => 4;
assert.equal(chooseZoom(center, laki), 9, 'a far-out view still picks the lowest published level');
map.getZoom = lowMap;
const ro5m = {minzoom:7, maxzoom:15};
assert.equal(chooseZoom(center, ro5m), 15, 'Ro5m never asks for z16');
assert.ok(zoomTiles(center, 15, 7).every(t => t.z >= 7 && t.z <= 15), 'Ro5m tiles stay within z7–z15');
console.log('Photo filter: requested levels stay inside each provider window.');

const source = fs.readFileSync('js/lidar-photo-filter.js', 'utf8');
assert(!source.includes('rvt-photo-status'), 'no separate photo-effect status window');
assert(source.includes("CustomEvent('dl:photo-filter'"), 'settings still receive status updates');
