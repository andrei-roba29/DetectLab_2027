'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const config=require('./js/apm-next/hoards.config.js');
const h=require('./js/apm-next/apm-hoards.js');
const provider=require('./js/apm-next/apm-hoard-provider.js');
const scale=require('./js/apm-next/apm-hoard-scale.js');
const core=require('./js/apm-next/apm-core.js');
const fixture=require('./test/fixtures/hoards.schema-examples.synthetic.json');
const ran=require('./js/apm-next/apm-romania-sites.js');
const pipeline=require('./js/apm-next/apm-pipeline.js');
let n=0;
function test(label,fn){fn();console.log('PASS '+label);n++;}
(async()=>{
 test('Romanian buckets, descriptive/place-name traps, diacritics, uncertainty and La Tène',()=>{
  for(const [name,bucket] of [
   ['Tezaurul monetar de la Band - Cetate','hoard-only'],['Așezarea și tezaurul de la Band','mixed'],
   ['Tezaur posibil de la Band','uncertain'],['Tezaurul? din Band','uncertain'],['Comoară romană din Band','hoard-only'],
   ['Voivodeni - La comoara','not-a-find'],['Așezarea de la Comoara','not-a-find'],
   ['Depozitul La Tène de la Band','hoard-only'],['Siliștea cu depozit din Band','mixed']])assert.equal(h.classifyRomanian(name).bucket,bucket,name);
 });
 test('Keyword ordering, multiple periods, unknown periods and object-date provenance',()=>{
  assert.deepEqual(h.periodsRomanian('Tezaur eneolitic de la Roman').map(p=>p.key),['eneolitic']);
  assert.deepEqual(h.periodsRomanian('Tezaur roman republican de la Band').map(p=>p.key),['roman-republican']);
  assert.deepEqual(h.periodsRomanian('Tezaur carpic din Band').map(p=>p.key),['carpic']);
  assert.deepEqual(h.periodsRomanian('Tezaur roman și medieval de la Band').map(p=>p.key),['roman','medieval']);
  assert.equal(h.periodsRomanian('Tezaur de la Roman').length,0);
  const row=h.deriveRomanian({layer_id:0,object_id:1,lat:46,lon:25,attributes:{NUMESIT:'Tezaur roman și medieval de la Band',COORD:'NU'}}).row;
  assert.equal(row.multiple_periods,true);assert.equal(row.deposit_start_year,null);assert.equal(row.date_basis,'name-keyword');assert.equal(row.position_class,'approximate');
 });
 test('Astronomical years and unknown quality values fail closed',()=>{
  assert.equal(h.year('2200 BC'),-2199);assert.equal(h.year('1 BC'),0);assert.equal(h.year(-2199,'astronomical'),-2199);assert.equal(h.year(-2200,'historical'),-2199);
  assert.equal(h.year('1965?'),null);assert.equal(h.position('DA',config.ranPosition),'exact');assert.equal(h.position('NU',config.ranPosition),'approximate');assert.equal(h.position('',config.ranPosition),'unknown');assert.equal(h.position('undocumented',{}),'unknown');
 });
 test('Unreviewed schemas cannot be used; synthetic normalisation never uses discovery years or coin counts',()=>{
  assert.equal(h.normaliseDarmc(fixture['8'],8).dropped,'unreviewed-layer-schema');
  for(const [layer,mapping,start,end] of [
   [8,{idField:'COUP_ID',nameField:'NAME_COUP',dateStartField:'DATE_E',dateEndField:'DATE_L',qualityFields:['FINDSPOT_Q'],positionMapping:{'{"FINDSPOT_Q":"TEST_EXACT"}':'exact'}},800,825],
   [12,{idField:'id_no',nameField:'Name',dateStartField:'start_date',dateEndField:'end_date'},220,250],
   [15,{idField:'HOBBS_NO',nameField:'PLACE',dateStartField:'START_D',dateEndField:'END_D',centroidValues:['TEST_REGION']},300,350]]){
    const m={reviewed:true,dateBasis:'deposit',...mapping};const r=h.normaliseDarmc(fixture[layer],layer,m).row;
    assert.equal(r.deposit_start_year,start);assert.equal(r.deposit_end_year,end);
    if(layer===15)assert.equal(r.position_class,'approximate');
    for(const f of ['FINDDATE','Find_year','YEAR_DISC','COINS_MN','COINS_MX'])assert.equal(h.normaliseDarmc(fixture[layer],layer,{...m,dateStartField:f}).dropped,'unverified-or-forbidden-date-fields');
   }
 });
 test('Real 8/12/15 projections: date/count separation, geometry agreement and unmapped quality',()=>{
  const real=require('./test/fixtures/hoards.real-projections.json');
  const result=h.normaliseDarmc(real['12'],12,{reviewed:true,idField:'OBJECTID',nameField:'Name',dateStartField:'start_date',dateEndField:'end_date',dateBasis:'deposit',yearConvention:'ce'}).row;
  assert.equal(result.deposit_start_year,218);assert.equal(result.deposit_end_year,222);assert.equal(result.position_class,'unknown');assert.equal(result.source_id,'1');
  assert.notEqual(result.deposit_start_year,real['12'].attributes.hoardsize);
  assert.equal(h.normaliseDarmc(real['15'],15).dropped,'unreviewed-layer-schema');
  assert.equal(h.normaliseDarmc(real['15'],15,{reviewed:true,idField:'HOBBS_NO'}).dropped,'missing-source-id');
  assert.equal(real['8'].attributes.COINS_MN,25);assert.equal(real['8'].attributes.DATE_E,755);assert.equal(real['8'].attributes.FINDDATE,1972);
  assert.notEqual(real['15'].attributes.START_D,real['15'].attributes.D_TPQ,'do not conflate coin/object start with deposition TPQ');
  for(const [id,lat,lon] of [[8,'LATITUDE','LONGITUDE'],[12,'Latitude','Longitude'],[15,'DEC_LAT','DEC_LONG']]){
   const f=real[id];assert(h.distanceM({lat:f.geometry.y,lon:f.geometry.x},{lat:f.attributes[lat],lon:f.attributes[lon]})<1);
  }
 });
 test('Worker honours per-point accuracy neighbourhoods and raster-water sampling',()=>{
  const ctx={console};ctx.self=ctx;let reply;
  ctx.postMessage=m=>{reply=m;};
  ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'js/apm-next',file.split('?')[0]),'utf8'),ctx));
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/apm-next/apm-worker.js','utf8'),ctx);
  const w=31,step=150/mpd(46).lon,dlat=150/mpd(46).lat,elev=new Float32Array(w*w),mask=new Uint8Array(w*w);
  function mpd(lat){return core.metresPerDegree(lat);}
  for(let j=13;j<=17;j++)for(let i=13;i<=17;i++)elev[j*w+i]=100;
  mask[15*w+5]=1;
  ctx.onmessage({data:{op:'setWater',id:1,classes:{medium:new Float64Array([24.9,46,25.1,46])}}});
  ctx.onmessage({data:{op:'sampleTile',id:2,w,h:w,elev,dxM:150,dyM:150,tile:{west:25-15.5*step,north:46+15.5*dlat,dLon:step,dLat:dlat},points:new Float64Array([25,46,25,46]),siteMask:new Uint8Array([1,1]),positionRadii:[60,1000],waterMasks:{medium:mask}}});
  assert(!reply.error,JSON.stringify(reply));assert.equal(reply.values[0],100);assert.equal(reply.values[5],0);assert.equal(reply.water.medium[0],1500);
 });
 test('Likely duplicates require distance, overlapping deposit interval and similar name',()=>{
  const rows=[{id:'a',lat:46,lon:25,name:'Band hoard',deposit_start_year:200,deposit_end_year:300},{id:'b',lat:46.004,lon:25,name:'Band hoard',deposit_start_year:250,deposit_end_year:350},
   {id:'c',lat:46,lon:25,name:'Other deposit',deposit_start_year:250,deposit_end_year:350},{id:'d',lat:46,lon:25,name:'Band hoard',deposit_start_year:700,deposit_end_year:800}];
  assert.equal(h.markDuplicates(rows).length,1);assert.equal(rows[1].duplicate_of,'a');
  assert.equal(h.markDuplicates(rows,{distanceM:1}).length,0);
 });
 test('Hoard training/prediction use identical aligned grid resolution; mismatch fails',()=>{
  const centre={lat:46.77,lon:23.59},train=scale.grid(core.circleBBox(centre.lat,centre.lon,151000),centre,150);
  for(const km of [1,5,10])assert(scale.assertSame(train,scale.grid(core.circleBBox(centre.lat,centre.lon,km*1000+3000),centre,150)));
  assert.throws(()=>scale.assertSame(train,scale.grid(core.circleBBox(centre.lat,centre.lon,4000),centre,25)),/resolution mismatch/);
  assert.equal(scale.pointRadius({positionAccuracy:1000},60),1000);
 });
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{rows:Array.from({length:9},(_,i)=>({id:String(i),lat:46,lon:25,position_class:'exact'})),usable:9,truncated:false,period_counts:{}}};}};
 const empty=await provider.createProvider({client}).getSites({lat:46,lon:25},999);
 assert.equal(empty.length,0);assert(empty._meta.offerCsv);assert.equal(calls[0].name,'apm_hoards_within');assert.equal(calls[0].args.p_radius_km,150);
 console.log('PASS hoard provider: insufficient observations return no training records and offer CSV; one isolated RPC');n++;
 const original=config.excludeRomanianHoardSettlements;
 try{
  const response={rows:[{object_id:1,lat:46,lon:25,name:'Tezaur roman de la Band',coord_flag:'DA'},{object_id:2,lat:46,lon:25,name:'Așezarea romană de la Band',coord_flag:'DA'}]};
  const siteClient={rpc:async(name)=>{assert.equal(name,'apm_sites_within');return {data:response};}};
  config.excludeRomanianHoardSettlements=true;const filtered=await ran.createProvider({client:siteClient}).getSites({lat:46,lon:25},50);assert.equal(filtered.length,1);assert.equal(filtered._meta.excludedHoard,1);
  config.excludeRomanianHoardSettlements=false;assert.equal((await ran.createProvider({client:siteClient}).getSites({lat:46,lon:25},50)).length,2);
  console.log('PASS settlement exclusion switch and site/hoard RPC isolation');n++;
 }finally{config.excludeRomanianHoardSettlements=original;}
 await assert.rejects(pipeline.runTrain({}, {category:'hoards'}),/review|validation/i);console.log('PASS release gates prevent any terrain request before evidence/performance review');n++;
 // Real UI execution with the existing mocked network harness is run separately.
 const csv=provider.fromCsv('id,lat,lon,type,positionAccuracy,periodStart,periodEnd\na,46,25,coin,50,2200 BC,2100 BC',{lat:46,lon:25},false);
 assert.equal(csv.length,1);assert.equal(csv[0].periodStart,-2199);assert.equal(csv[0].type,'hoard');
 const i18n=require('./js/apm-next/apm-i18n.js');
 for(const key of Object.keys(i18n.STRINGS.en).filter(k=>k.startsWith('hoard.')))assert(i18n.STRINGS.ro[key],key);
 console.log(`PASS ${n} hoard groups plus CSV and bilingual strings (synthetic edge cases + real feature projections; no live test requests)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
