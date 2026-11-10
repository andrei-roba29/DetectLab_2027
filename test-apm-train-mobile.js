'use strict';
// Offline: actual TRAIN/worker maths + IndexedDB API, synthetic public inputs.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {createRequire}=require('node:module');
const {IDBFactory,IDBObjectStore}=createRequire(path.join(__dirname,'tools/apm-test/package.json'))('fake-indexeddb');
const cacheModule=require('./js/apm-next/apm-train-cache.js');
const core=require('./js/apm-next/apm-core.js'),raster=require('./js/apm-next/apm-raster.js');
const sites=require('./js/apm-next/apm-sites.js'),prov=require('./js/apm-next/apm-providers.js');
// Optional full output benchmark; the normal parallel suite uses a small
// prediction window while still sampling the unchanged 50 km training area.
const fullBenchmark=process.env.APM_MOBILE_FULL_BENCH==='1';
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
function worker(){
    const ctx={console};let response;
    ctx.self=ctx;ctx.postMessage=m=>response=m;
    ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(read('js/apm-next/'+f.split('?')[0]),ctx));
    vm.createContext(ctx);vm.runInContext(read('js/apm-next/apm-worker.js'),ctx);
    return (op,p={})=>{ctx.onmessage({data:{...p,op,id:1}});assert.equal(response.ok,true,response.error);return response;};
}
function seeded(){let seed=4211;return ()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);}
function elevation(g){
    const out=new Float32Array(g.w*g.h);
    for(let y=0;y<g.h;y++)for(let x=0;x<g.w;x++){
        const lon=g.west+(x+.5)*g.dLon,lat=g.north-(y+.5)*g.dLat;
        out[y*g.w+x]=300+100*Math.sin(lon*80)+70*Math.cos(lat*95)+lon*10;
    }return out;
}
class CloneWorker {
    static instances=[];
    constructor(){
        CloneWorker.instances.push(this);this.transfers=[];this.stats=[];this.dead=false;
        const ctx={console};ctx.self=ctx;
        ctx.postMessage=(m,t=[])=>{const reply=structuredClone(m,{transfer:t});queueMicrotask(()=>{if(!this.dead)this.onmessage({data:reply});});};
        ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(read('js/apm-next/'+f.split('?')[0]),ctx));
        vm.createContext(ctx);vm.runInContext(read('js/apm-next/apm-worker.js'),ctx);this.ctx=ctx;
    }
    postMessage(m,t=[]){
        this.transfers.push({op:m.op,bytes:t.reduce((n,b)=>n+b.byteLength,0),count:t.length});
        const clone=structuredClone(m,{transfer:t});
        for(const b of t)assert.equal(b.byteLength,0,'sender ownership transferred');
        this.ctx.onmessage({data:clone});
    }
    terminate(){this.dead=true;this.ctx=null;}
}
function pipeline(idb){
    const ctx={module:{exports:{}},require:id=>require(path.join(__dirname,'js/apm-next',id)),
        console,Promise,Map,Set,Date,Math,Float32Array,Float64Array,Uint8Array,Int32Array,Uint32Array,Uint8ClampedArray,
        setTimeout,clearTimeout,performance,indexedDB:idb,Worker:CloneWorker,navigator:{deviceMemory:4},
        computeArcheoExclusionMask:async g=>({mask:new Uint8Array(g.w*g.h),stats:{unknown:0}})};
    vm.runInNewContext(read('js/apm-next/apm-pipeline.js'),ctx);return ctx.module.exports;
}
(async()=>{
    await test('RAM cache bounded, TTL, oversized input, transfer-safe retained buffers',async()=>{
        const c=cacheModule.create({indexedDB:null,memoryBytes:16,diskBytes:32,ttlMs:30});
        const b=new Uint8Array([1,2,3,4]).buffer;await c.put('a',b,4);structuredClone(b,{transfer:[b]});
        const hit=await c.get('a');assert.deepEqual([...new Uint8Array(hit)],[1,2,3,4]);structuredClone(hit,{transfer:[hit]});
        assert.equal((await c.get('a')).byteLength,4);
        for(let i=0;i<20;i++)await c.put('k'+i,new ArrayBuffer(4),4);
        assert(c.memoryStats().bytes<=16);assert(c.memoryStats().entries<=16);
        assert.equal(await c.put('oversize',new ArrayBuffer(33),33),false);
        await delay(35);assert.equal(await c.get('k19'),undefined);
    });
    await test('IndexedDB eviction scans metadata only; byte/entry limits and TTL enforced',async()=>{
        const idb=new IDBFactory(),c=cacheModule.create({indexedDB:idb,diskBytes:16,memoryBytes:8});
        const getAll=IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll=function(...args){assert.notEqual(this.name,'data','never clone all raster values to evict');return getAll.apply(this,args);};
        try{
            for(const k of ['a','b','c'])await c.put(k,new ArrayBuffer(8),8);
            assert.equal(await c.get('a'),undefined);assert.equal((await c.get('c')).byteLength,8);
            const x=await c.get('c');structuredClone(x,{transfer:[x]});assert.equal((await c.get('c')).byteLength,8);
            const many=cacheModule.create({indexedDB:new IDBFactory()});
            for(let i=0;i<140;i++)await many.put(String(i).padStart(3,'0'),new ArrayBuffer(1),1);
            let count=0;for(let i=0;i<140;i++)if(await many.get(String(i).padStart(3,'0')))count++;
            assert.equal(count,128);
        }finally{IDBObjectStore.prototype.getAll=getAll;}
        const exp=cacheModule.create({indexedDB:new IDBFactory(),ttlMs:20});await exp.put('a',new ArrayBuffer(4),4);
        await delay(30);assert.equal(await exp.get('a'),undefined);
    });
    await test('quota/security/blocked/stalled IndexedDB cannot block TRAIN; late open closed',async()=>{
        const original=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(...args){if(this.name==='data')throw new DOMException('full','QuotaExceededError');return original.apply(this,args);};
        const c=cacheModule.create({indexedDB:new IDBFactory()});
        try{assert.equal(await c.put('a',new ArrayBuffer(8),8),false);assert.equal((await c.get('a')).byteLength,8);}
        finally{IDBObjectStore.prototype.put=original;}
        const restricted=cacheModule.create({indexedDB:{open(){throw Error('SecurityError');}}});
        await restricted.put('a',new ArrayBuffer(8),8);assert.equal((await restricted.get('a')).byteLength,8);
        let req,closed=0;
        const blocked=cacheModule.create({indexedDB:{open(){return req={};}},timeoutMs:10});
        const pending=blocked.get('x');req.onblocked();await pending;
        req.result={close(){closed++;}};req.onsuccess();assert.equal(closed,1);
        const stalled=cacheModule.create({indexedDB:{open(){return {}; }},timeoutMs:10});
        assert.equal(await stalled.get('x'),undefined);
        let aborts=0;
        const db={transaction(){return {objectStore(){return {get(){return {};}};},abort(){aborts++;}};}};
        const hung=cacheModule.create({indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess();});return r;}},timeoutMs:10});
        assert.equal(await hung.get('x'),undefined);assert.equal(aborts,1);
    });
    await test('smaller tiles with derivative/smoothing halo match full-window positive/background values',async()=>{
        const g={w:1050,h:40,west:23,north:47,dLon:.00033,dLat:.000225};
        const dx=25,dy=25,points=[511,512,999,1000,513].flatMap(x=>[g.west+(x+.5)*g.dLon,g.north-20.5*g.dLat]);
        const sample=(grid,pts,smooth,mask)=>worker()('sampleTile',{elev:elevation(grid),w:grid.w,h:grid.h,dxM:dx,dyM:dy,
            tile:grid,points:new Float64Array(pts),siteMask:new Uint8Array(mask),positionRadiusM:60,smooth});
        for(const smooth of [false,true]){
            const full=sample(g,points,smooth,[1,1,1,1,0]);
            for(const tilePx of [512,1000])for(let p=0;p<5;p++){
                const x=[511,512,999,1000,513][p],pad=Math.ceil(60/25)+(smooth?2:1),i0=Math.floor(x/tilePx)*tilePx;
                const hg=prov.subGrid(g,i0-pad,-pad,Math.min(tilePx,g.w-i0)+2*pad,g.h+2*pad);
                const small=sample(hg,points.slice(2*p,2*p+2),smooth,[p===4?0:1]);
                for(let k=0;k<5;k++)assert(Math.abs(full.values[p*5+k]-small.values[k])<1e-6,`tile=${tilePx}, smooth=${smooth}, p=${p}, k=${k}`);
            }
        }
    });
    await test('TRAIN skips supplied reference collection independently; MANUAL still derives references',async()=>{
        const g={w:32,h:32,west:23,north:47,dLon:.001,dLat:.001},base={grid:g,elev:elevation(g),smooth:false,
            circle:{lat:46.984,lon:23.016,radiusM:50000},waterMasks:{}};
        const send=worker();
        assert.equal(send('setAnalysis',{...base,altRef:[200,300,400],soilRef:[-1,0,1]}).stats.referenceValuesCollected,0);
        assert(send('setAnalysis',{...base,altRef:[200,300,400]}).stats.referenceValuesCollected>0);
        assert(send('setAnalysis',{...base,soilRef:[-1,0,1]}).stats.referenceValuesCollected>0);
        assert(send('setAnalysis',base).stats.referenceValuesCollected>1024);
    });
    await test('real mobile TRAIN cold/warm period switch, transfer ownership, fallback and cache invalidation',async()=>{
        const originalDem=prov.demPlan,originalWater=prov.waterPlan,downloads=[];
        let waterRequests=0,probeOldTerminated=false;
        const dem={id:'mobile-fixture',version:'1',endpoint:'fixture:dem',label:'Synthetic DEM',nominalResM:100,tilePx:1000,
            fetchBlock:async g=>{downloads.push(g.w*g.h);await delay(2);return elevation(g);}};
        const water={id:'fixture-hydro',label:'Synthetic hydro',endpoint:'fixture:water',fetchWater:async()=>{
            waterRequests++;await delay(40);return {lines:[],polygons:[],meta:{}};
        }};
        prov.demPlan=()=>[{provider:dem,use:true}];prov.waterPlan=()=>[{provider:water,use:true}];
        const p=pipeline(new IDBFactory()),session={worker:{terminate(){probeOldTerminated=true;}}};
        assert.equal(p.mobileTrainProfile(),true);
        const records=sites.parseSitesCsv('latitude,longitude,type,positionAccuracy\n'+Array.from({length:40},(_,i)=>
            `${46.77+((i%8)-4)*.04},${23.59+(Math.floor(i/8)-2)*.06},settlement,5`).join('\n'),'test').records;
        // Existing period contract: positives differ, but environmental grids do not.
        records.forEach((r,i)=>{r.periods=[i<20?{label:'Roman',start:100,end:300}:{label:'Medieval',start:1000,end:1300}];});
        const params={centre:{lat:46.77,lon:23.59},records,radiusKm:fullBenchmark?50:1,minSlopeDeg:0,smoothDem:true,includeDrainage:false,
            waterClasses:[],workerUrl:'worker.js',bgCount:100,minAreaM2:2500,token:{cancelled:false}};
        const run=async(period,extra={})=>{
            const start=performance.now(),before=downloads.length,wBefore=waterRequests;
            const result=await p.runTrain(session,{...params,period:period==='roman'?{start:100,end:300}:{start:1000,end:1300},rnd:seeded(),...extra});
            return {result,elapsedMs:Math.round(performance.now()-start),demRequests:downloads.length-before,waterRequests:waterRequests-wBefore};
        };
        try{
            const coldJob=run('roman');assert(probeOldTerminated,'old analysis freed before provider awaits');
            const cold=await coldJob,warm=await run('medieval');
            assert.equal(cold.result.diagnostics.sitesInSample,20);assert.equal(warm.result.diagnostics.sitesInSample,20);
            assert.equal(warm.demRequests,1,'only the existing DEM provider probe remains');assert.equal(warm.waterRequests,0);
            assert(warm.result.diagnostics.performance.demCacheHits>0);assert.equal(warm.result.diagnostics.performance.waterCacheHits,1);
            assert(cold.result.diagnostics.performance.maxSampleTileCells<=522*522);
            assert.equal(cold.result.diagnostics.performance.sampleTilePx,512);
            assert.equal(cold.result.provenance.dem.predictionCells,warm.result.provenance.dem.predictionCells);
            assert.equal(cold.result.provenance.dem.cellM,warm.result.provenance.dem.cellM);
            const latest=CloneWorker.instances.at(-1);
            assert(latest.transfers.filter(x=>['sampleTile','setAnalysis'].includes(x.op)).every(x=>x.bytes>0));
            assert.equal(session.stats.referenceValuesCollected,0);
            // Optional full benchmark uses the actual 50 km prediction area.
            // Remaining invalidation checks always use a small output.
            params.radiusKm=1;
            const desktop=await run('medieval',{mobileProfile:false});
            assert(desktop.result.diagnostics.performance.maxSampleTileCells>3*cold.result.diagnostics.performance.maxSampleTileCells);
            const smallCached=await run('medieval');
            const smallUncached=await run('medieval',{cacheInputs:false});
            assert.deepEqual(smallCached.result.diagnostics.weights,smallUncached.result.diagnostics.weights,'cache cannot change fitting');
            assert.deepEqual(smallCached.result.heatmap.rgba,smallUncached.result.heatmap.rgba,'cache cannot change heatmap');
            const changedWater=await run('medieval',{includeDrainage:true});assert.equal(changedWater.waterRequests,1);
            dem.version='2';const changedDem=await run('medieval');assert(changedDem.demRequests>1);
            // Fallback selection and warnings must still run even when fallback data is cached.
            const failing={...water,id:'unavailable-primary',fetchWater:async()=>{throw Error('fixture unavailable');}};
            prov.waterPlan=()=>[{provider:failing,use:true},{provider:water,use:true}];
            const fallback=await run('medieval');assert.equal(fallback.waterRequests,0);
            assert(fallback.result.warnings.some(x=>x.key==='warn.waterFallback'));
            // No cache of a partial successful response: provider must be retried.
            water.id='incomplete';water.fetchWater=async()=>{waterRequests++;return {lines:[],polygons:[],meta:{incompleteTiles:1}};};
            prov.waterPlan=()=>[{provider:water,use:true}];
            await run('roman');const partial=await run('roman');assert.equal(partial.waterRequests,1);
            const evidence={scope:'OFFLINE synthetic providers; not a live phone/browser benchmark',trainingRadiusKm:50,predictionRadiusKm:fullBenchmark?50:1,backgroundPoints:100,cold:{ms:cold.elapsedMs,demRequests:cold.demRequests,waterRequests:cold.waterRequests,...cold.result.diagnostics.performance},
                desktopSampleTileCells:desktop.result.diagnostics.performance.maxSampleTileCells,
                periodSwitch:{ms:warm.elapsedMs,demRequests:warm.demRequests,waterRequests:warm.waterRequests,...warm.result.diagnostics.performance}};
            if(fullBenchmark)fs.writeFileSync(path.join(__dirname,'test-results/mobile-train-benchmark.json'),JSON.stringify(evidence,null,2)+'\n');
            console.log(JSON.stringify(evidence));
        }finally{if(session.worker)session.worker.terminate();prov.demPlan=originalDem;prov.waterPlan=originalWater;}
    });
    await test('cancelled provider download cannot resurrect a worker or terminate a newer run',async()=>{
        const oldDem=prov.demPlan,oldWater=prov.waterPlan;
        let resolveWater;
        const dem={id:'cancel-dem',label:'fixture',nominalResM:1000,tilePx:512,fetchBlock:async g=>elevation(g)};
        prov.demPlan=()=>[{provider:dem,use:true}];
        prov.waterPlan=()=>[{provider:{id:'cancel-water',fetchWater:()=>new Promise(r=>resolveWater=r)},use:true}];
        const p=pipeline(),token={cancelled:false},session={},before=CloneWorker.instances.length;
        const records=sites.parseSitesCsv('latitude,longitude,type,positionAccuracy\n'+Array.from({length:12},(_,i)=>`46.77,${23.5+i*.01},settlement,5`).join('\n'),'test').records;
        try{
            const job=p.runTrain(session,{centre:{lat:46.77,lon:23.59},records,period:null,radiusKm:50,minSlopeDeg:0,bgCount:10,
                waterClasses:[],token,cacheInputs:false});
            while(!resolveWater)await delay(0);
            token.cancelled=true;let newerTerminated=false;const newer={terminate(){newerTerminated=true;}};session.worker=newer;
            resolveWater({lines:[],polygons:[]});await assert.rejects(job,e=>p.isCancelled(e));
            assert.equal(CloneWorker.instances.length,before);assert.equal(session.worker,newer);assert.equal(newerTerminated,false);
        }finally{prov.demPlan=oldDem;prov.waterPlan=oldWater;}
    });
    await test('PWA cache module ordering and worker version are coherent',()=>{
        const html=read('index.html'),sw=read('sw.js'),ui=read('js/apm-next/apm-ui.js');
        for(const asset of ['apm-train-cache','apm-pipeline','apm-ui']){
            const tag=`js/apm-next/${asset}.js?v=${asset==='apm-train-cache'?'20261105-apm-mobile-train':'20261109-apm-hoard-wording'}`;assert(html.includes(tag)&&sw.includes(tag));
        }
        assert(html.indexOf('apm-train-cache.js')<html.indexOf('apm-pipeline.js'));
        assert(/const CACHE_NAME = 'detectlab-v\d+-[a-z0-9-]+';/.test(sw));assert(ui.includes('apm-worker.js?v=20261109-apm-hoard-wording'));
    });
    console.log(`${checks} mobile TRAIN regressions passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
