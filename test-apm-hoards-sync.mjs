// Synthetic ArcGIS transport fixture. Never contacts a live endpoint.
import assert from 'node:assert/strict';
import { capture,inspect } from './tools/sync-hoards.mjs';
const layers=[8,9,10,11,12,15,16];
let calls=0;
globalThis.fetch=async input=>{
 calls++;const u=new URL(input),id=Number(u.pathname.split('/').filter(Boolean).at(u.pathname.endsWith('/query')?-2:-1));
 assert(layers.includes(id));let data;
 if(!u.pathname.endsWith('/query'))data={geometryType:'esriGeometryPoint',maxRecordCount:1,advancedQueryCapabilities:{supportsPagination:false},fields:[{name:'OBJECTID',type:'esriFieldTypeOID'}]};
 else if(u.searchParams.has('returnCountOnly'))data={count:2};
 else if(u.searchParams.has('returnIdsOnly'))data={objectIdFieldName:'OBJECTID',objectIds:[1,2]};
 else {assert.equal(u.searchParams.get('outSR'),'4326');assert.equal(u.searchParams.get('outFields'),'*');const oid=Number(u.searchParams.get('objectIds'));data={spatialReference:{wkid:4326},features:[{attributes:{OBJECTID:oid},geometry:{x:25,y:46}}]};}
 return {ok:true,json:async()=>data};
};
const evidence=await capture();assert.equal(calls,35,'metadata/count/IDs plus two ID batches for each layer');
const report=inspect(evidence);
for(const id of layers){assert.equal(report.reports[id].fetched,2);assert.equal(report.reports[id].kept,0);assert.equal(report.reports[id].drop_reasons['unreviewed-layer-schema'],2);assert.equal(report.reports[id].supportsPagination,false);}
globalThis.fetch=async()=>({ok:true,json:async()=>({geometryType:'esriGeometryPolygon'})});
await assert.rejects(capture(),/not a point layer/);
console.log('PASS sync capture: verified metadata, ID batching without assumed pagination, 4326 output, count/identity checks; unreviewed mappings drop closed; non-points rejected. All synthetic.');
