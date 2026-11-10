'use strict';
// Real TRAIN UI -> real provider -> real pipeline -> real worker, mocked network.
// Only Leaflet rendering and TIFF decoding are faked. No live services or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {JSDOM} = createRequire(path.join(__dirname,'tools/apm-test/package.json'))('jsdom');
const read = p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const fixture = require('./test/fixtures/romania-sites.synthetic.json');
const scripts=['apm-core','apm-raster','apm-heatmap','apm-sites','apm-providers','romania-periods.config','hoards.config','apm-hoards','apm-hoard-provider','apm-hoard-scale','apm-romania-sites',
    'ariadne/ariadne.config','ariadne/ariadne-tiles','ariadne/ariadne-parse','ariadne/ariadne-query','ariadne/ariadne-upstream','ariadne/ariadne-provider',
    'apm-site-merge','apm-dare-sites','apm-outside-sites','apm-i18n','apm-train-cache','apm-pipeline','apm-ui'];
const wcs='<wcs:Capabilities><wcs:ServiceMetadata><wcs:formatSupported>image/tiff</wcs:formatSupported><wcs:Extension><wcs:crsSupported>http://www.opengis.net/def/crs/EPSG/0/4326</wcs:crsSupported></wcs:Extension><wcs:MaxPixels>4000000</wcs:MaxPixels></wcs:ServiceMetadata><wcs:Contents><wcs:CoverageSummary><wcs:CoverageId>DEM_v11</wcs:CoverageId></wcs:CoverageSummary></wcs:Contents></wcs:Capabilities>';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<1000;i++){if(fn())return;await delay(10);}throw Error('Timeout: '+label);}
function harness(mode='ok') {
    const dom=new JSDOM('<body><div class="map-frame"></div></body>',{url:'https://detectlab.example',runScripts:'outside-only'});
    const w=dom.window,requests=[],events={},ops=[],panes={};let completed,runError,params;
    w.localStorage.setItem('detectlab_lang','en');w._dlIsPremium=()=>true;
    w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};
    const layer=()=>({addTo(){return this;},setStyle(){},setOpacity(){},eachLayer(){},bindPopup(){},on(){}});
    w.L={circleMarker:layer,circle:layer,geoJSON:layer,layerGroup:layer};
    w.map={on:(name,fn)=>events[name]=fn,off:name=>delete events[name],removeLayer(){},getContainer:()=>w.document.body,getPane:n=>panes[n],createPane:n=>(panes[n]={style:{}})};
    const sampleName=fixture[0].attributes.NUMESIT;
    const rows=Array.from({length:40},(_,i)=>({object_id:i+1,lat:46.6+(i%8)*.035,lon:24.8+Math.floor(i/8)*.05,name:sampleName,siruta:'100',coord_flag:'DA'}));
    rows[1] = Object.assign({},rows[1],{lat:rows[0].lat,lon:rows[0].lon,name:fixture[8].attributes.NUMESIT});
    const network=async(url)=>{
        requests.push(url);
        const u=new URL(url);
        if(u.host==='project.supabase.example') {
            if(u.pathname.endsWith('apm_hoards_within')) {
                if(mode==='hoardsMany') return {data:{rows:Array.from({length:14},(_,i)=>({id:'h'+i,lat:46.75+i*0.0008,lon:25+i*0.0004,position_class:'exact',period_groups:[]})),usable:14,total_in_area:14,truncated:false,period_counts:{}}};
                if(mode==='approximate') return {data:{rows:[],usable:3,total_in_area:3,truncated:false,period_counts:{},approximate_available:12,excluded_approximate:12}};
                return {data:{rows:Array.from({length:9},(_,i)=>({id:String(i),lat:46.75,lon:25,position_class:'exact',period_groups:[]})),usable:9,total_in_area:9,truncated:false,period_counts:{}}};
            }
            if(mode==='error')return {data:null,error:{message:'not authorised'}};
            return {data:{rows,total_in_area:40,excluded_approximate:0,excluded_unknown_coord:0,excluded_geometry:0,truncated:false},error:null};
        }
        if(u.host==='imperium.ahlfeldt.se') {
            if(mode==='outsideMany'){
                const many=Array.from({length:14},(_,i)=>({type:'Feature',id:'m'+i,
                    geometry:{type:'Point',coordinates:[10.0+(i%5)*0.03,51.0+Math.floor(i/5)*0.03]},
                    properties:{name:'Place '+i,numType:12}}));
                const body={type:'FeatureCollection',features:many};
                return {ok:true,status:200,headers:{get:()=>'application/json'},text:async()=>JSON.stringify(body),json:async()=>body};
            }
            const features=[
                {type:'Feature',id:'d1',geometry:{type:'Point',coordinates:[10.0,51.0]},properties:{name:'Gotinga',numType:12}},
                {type:'Feature',id:'d2',geometry:{type:'Point',coordinates:[10.1,51.05]},properties:{name:'Settling',numType:11}},
                {type:'Feature',id:'d3',geometry:{type:'Point',coordinates:[10.0,51.4]},properties:{name:'Far place',numType:13}},
                {type:'Feature',id:'d4',geometry:{type:'Point',coordinates:[10.05,51.02]},properties:{name:'A fort',numType:18}}
            ];
            const body={type:'FeatureCollection',features};
            return {ok:true,status:200,headers:{get:()=>'application/json'},text:async()=>JSON.stringify(body),json:async()=>body};
        }
        if(u.host==='portal.ariadne-infrastructure.eu') {
            const hit=(id,name,lat,lon)=>({id,data:{title:{text:name},resourceType:'Site/monument',
                ariadneSubject:[{prefLabel:'Site/monument'}],spatial:[{geopoint:{lat,lon}}]}});
            if(mode==='outsideMany') return {ok:true,status:200,headers:{get:()=>'application/json'},text:async()=>JSON.stringify({hits:[
                hit('b1','Place 0',51.0001,10.0001),
                hit('b2','Place 3',51.0002,10.0902)
            ],total:{value:2},aggregations:{}})};
            return {ok:true,status:200,headers:{get:()=>'application/json'},text:async()=>JSON.stringify({hits:[
                hit('a1','Gotinga',51.0005,10.0005),
                hit('a2','Other place',51.02,9.98)
            ],total:{value:2},aggregations:{}})};
        }
        if(u.host==='overpass-api.de') return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({elements:[]})};
        assert.equal(u.host,'image.discomap.eea.europa.eu','unexpected host: '+url);
        if(url.includes('GetCapabilities'))return {ok:true,status:200,text:async()=>wcs,headers:{get:()=> 'text/xml'}};
        if(url.includes('GetCoverage')) {
            const dims=u.searchParams.get('scalesize').match(/i\((\d+)\),j\((\d+)\)/);
            return {ok:true,status:200,headers:{get:()=> 'image/tiff'},arrayBuffer:async()=>({byteLength:8,w:+dims[1],h:+dims[2]})};
        }
        return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>url.includes('/query?') ?
            {type:'FeatureCollection',features:[]} : {layers:[{id:5,name:'Strahler 3',parentLayerId:4}]}};
    };
    w.fetch=network;
    // This is the existing app client surface. Any table read is a hard failure.
    w.supabaseClient={rpc:(name,args)=>{
        assert(['apm_sites_within','apm_hoards_within'].includes(name));assert(args.p_radius_km<=(name==='apm_sites_within'?50:150));
        return network('https://project.supabase.example/rest/v1/rpc/'+name);
    },from(){throw Error('Direct table read forbidden');}};
    w.GeoTIFF={fromArrayBuffer:async buf=>({getImage:async()=>({getWidth:()=>buf.w,getHeight:()=>buf.h,getGDALNoData:()=>null,
        readRasters:async()=>Float32Array.from({length:buf.w*buf.h},(_,i)=>200+(i%buf.w)*30+15*Math.sin(Math.floor(i/buf.w)/3))})})};
    w.Worker=class {
        constructor(){
            const ctx={console,setTimeout,clearTimeout,performance,Float32Array,Float64Array,Uint8Array,Int32Array,Uint32Array,Uint8ClampedArray,Map,Set,Math,Promise};
            ctx.self=ctx;ctx.postMessage=m=>queueMicrotask(()=>this.onmessage({data:m}));
            ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(read(path.normalize('js/apm-next/'+f.split('?')[0])),ctx,{filename:f}));
            vm.createContext(ctx);vm.runInContext(read('js/apm-next/apm-worker.js'),ctx);this.ctx=ctx;
        }
        postMessage(m){ops.push(m.op);this.ctx.onmessage({data:m});}
        terminate(){}
    };
    // The REAL protection mask is loaded. Legacy heritage loaders must never run.
    w._loadLocalLayerData=()=>{throw Error('Legacy heritage download forbidden during TRAIN');};
    // A cold UAT cache backed by free-land tiles; the real mask must load them.
    let uatRequests = 0;
    w._uatGetTile=async()=>{uatRequests++;return {data:new Uint8ClampedArray([0,0,0,255]),size:1};};
    w.eval(read('js/archeo-potential.js'));
    for(const s of scripts)w.eval(read('js/apm-next/'+s+'.js'));
    w.DetectLabApmUi.init();w.DetectLabApmUi.setEnabled(true);
    w.DetectLabApmProviders.CONFIG.euDem.nominalResM=1000; // keep synthetic test raster small
    w.DetectLabApmHeatmap.createLayer=layer;
    const real=w.DetectLabApmPipeline.runTrain;
    w.DetectLabApmPipeline.runTrain=(session,p)=>{
        params=p;p.bgCount=100;p.minSlopeDeg=0;
        return real(session,p).then(r=>{completed=r;return r;},e=>{runError=e;throw e;});
    };
    const clickText=text=>{const b=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert(b,'button '+text);b.click();};
    const pick=async(lat,lon)=>{
        w.document.querySelectorAll('.apm-tab')[1].click();
        w.document.querySelector('.apm-btn.apm-wide').click();
        assert(events.click,'map picker active');events.click({latlng:{lat,lng:lon}});
        await until(()=>!w.document.querySelector('.apm-status').textContent.includes('Loading exact-position'),'site loading');
    };
    return {w,dom,requests,ops,pick,clickText,get completed(){return completed;},get runError(){return runError;},get params(){return params;},get uatRequests(){return uatRequests;}};
}
(async()=>{
    const h=harness();
    try {
        await h.pick(46.75,25);
        assert.equal(h.requests.length,1);
        assert.equal(h.w.document.querySelector('.apm-period-picker').value,'all','All periods default');
        assert.match(h.w.document.querySelector('.apm-train').textContent,/Total records in the area: 40/);
        h.w.document.querySelector('.apm-primary').click();
        await until(()=>h.completed||h.runError,'real TRAIN completion');
        if(h.runError)throw h.runError;
        assert.equal(h.completed.mode,'train');
        assert.equal(h.completed.diagnostics.sitesUsed,40,'distinct names at identical positions survive the entire training pipeline');
        assert(h.ops.includes('train')&&h.ops.includes('score'),'real worker fitted and scored');
        assert(h.uatRequests > 0, 'TRAIN loads exclusion tiles on a cold cache');
        assert(h.completed.scoreStats.cells > 0 && h.completed.heatmap.rgba.some((v,i)=>i%4===3 && v>0), 'TRAIN produces visible heat');
        assert.equal(h.requests.filter(u=>u.includes('/rpc/apm_sites_within')).length,1);
        assert(h.requests.some(u=>u.includes('GetCoverage'))&&h.requests.some(u=>u.includes('EUHydro')));
        assert(h.requests.every(u=>['project.supabase.example','image.discomap.eea.europa.eu','overpass-api.de'].includes(new URL(u).host)), JSON.stringify(h.requests));
        console.log('PASS Romania TRAIN: real UI/provider/pipeline/worker completed; site-data calls = [Supabase apm_sites_within]; other requests = existing DEM/hydro only; no legacy heritage download.');
    } finally {h.dom.window.close();}
    const out=harness();
    try {
        await out.pick(51,10);
        await until(()=>/outside Romania/.test(out.w.document.querySelector('.apm-status').textContent),'outside load');
        const status=out.w.document.querySelector('.apm-status').textContent;
        assert(out.requests.some(u=>u.includes('imperium.ahlfeldt.se')),'DARE is asked');
        assert(out.requests.some(u=>u.includes('portal.ariadne-infrastructure.eu')),'ARIADNE is asked');
        assert.equal(out.requests.filter(u=>u.includes('supabase')).length,0,'no Romania database is touched');
        assert.match(status,/4 site\)?\(s\)? outside Romania/,'both catalogues merged into one list: '+status);
        assert.match(status,/DARE 3 \+ ARIADNE 2/,'each source is named with its own count: '+status);
        assert.match(status,/1 place\(s\) are attested by both/,'the overlap is stated: '+status);
        const file=out.w.document.querySelector('input[type=file]');assert(!file.parentElement.hidden);
        assert(!out.requests.some(u=>u.startsWith('https://project.supabase.example')),'no Romania RPC outside Romania');
        const csv='latitude,longitude,type,positionAccuracy\n'+Array.from({length:12},(_,i)=>`${51+i*.001},10,settlement,5`).join('\n');
        Object.defineProperty(file,'files',{value:[{name:'local.csv',text:async()=>csv}]});file.dispatchEvent(new out.w.Event('change'));
        await until(()=>out.w.document.querySelector('.apm-status').textContent.includes('CSV selected explicitly'),'CSV upload');
        assert(!out.w.document.querySelector('.apm-primary').disabled);
        const beforeRun=out.requests.length;
        out.w.document.querySelector('.apm-primary').click();
        await until(()=>out.completed||out.runError,'outside CSV TRAIN completion');
        if(out.runError)throw out.runError;
        assert.equal(out.params.siteSource.id,'csv');
        assert.equal(out.params.backgroundAllowed,null,'CSV background is not constrained to Romania');
        assert.equal(out.requests.filter(u=>u.includes('supabase')||u.includes('/rpc/')).length,0);
        assert.equal(out.requests.filter(u=>u.includes('imperium.ahlfeldt.se')).length,1,'the CSV replaces the catalogues, it does not re-query them');
        assert(out.requests.slice(beforeRun).every(u=>['image.discomap.eea.europa.eu','overpass-api.de'].includes(new URL(u).host)),'the run itself touches nothing but DEM and hydro');
        console.log('PASS outside Romania: DARE and ARIADNE queried and merged (one place attested by both appears once), no Romania database call, explicit CSV upload completes as before.');
    } finally {out.dom.window.close();}
    const many=harness('outsideMany');
    try {
        await many.pick(51,10);
        await until(()=>/outside Romania/.test(many.w.document.querySelector('.apm-status').textContent),'outside trade load');
        const status=many.w.document.querySelector('.apm-status').textContent;
        assert.match(status,/1[0-9] site/,'the merged catalogues exceed the minimum: '+status);
        assert(!many.w.document.querySelector('.apm-primary').disabled,'a runnable outside-Romania area can be trained');
        const beforeRun=many.requests.length;
        many.w.document.querySelector('.apm-primary').click();
        await until(()=>many.completed||many.runError,'outside trade TRAIN completion');
        if(many.runError)throw many.runError;
        assert.equal(many.params.siteSource.id,'dare+ariadne','the report names the catalogues that answered, not the Romanian repertory');
        assert.equal(many.params.backgroundAllowed,null,'backgrounds outside Romania are not restricted to Romanian territory');
        assert(many.completed.diagnostics.sitesUsed >= 10,'the outside sites actually reach the model: '+many.completed.diagnostics.sitesUsed);
        assert(many.completed.scoreStats.cells > 0,'the outside run really scored the terrain');
        const warns=many.completed.warnings||[];
        const outsideWarn=warns.find(w=>w.key==='warn.outsideBackground');
        assert(outsideWarn && /Background points are terrain samples/.test(outsideWarn.text),'the report states where the background came from');
        assert(warns.some(w=>w.key==='warn.exclusionUnknown'),'the missing Romanian UAT mask outside Romania is named, not silently ignored');
        assert(warns.some(w=>w.key==='warn.robustSkipped'),'too few sites for the robust fit is stated instead of quietly skipped');
        assert(many.requests.slice(beforeRun).every(u=>['image.discomap.eea.europa.eu','overpass-api.de'].includes(new URL(u).host)),'the run itself touches nothing but DEM and hydro');
        console.log('PASS outside Romania TRAIN: the builtin DARE/ARIADNE list trains against terrain backgrounds from the same box, with no Romanian-territory predicate.');
    } finally {many.dom.window.close();}
    const hoard=harness();
    try {
        await hoard.pick(46.75,25);
        const before=hoard.requests.length;
        const selector=hoard.w.document.querySelector('.apm-category-picker');
        selector.value='hoards';selector.dispatchEvent(new hoard.w.Event('change'));
        await until(()=>hoard.w.document.querySelector('.apm-status').textContent.includes('Fewer than 10 usable hoards'),'hoard load');
        assert.deepEqual(hoard.requests.slice(before),['https://project.supabase.example/rest/v1/rpc/apm_hoards_within']);
        assert(!hoard.w.document.querySelector('input[type=file]').parentElement.hidden);
        assert(hoard.w.document.querySelector('.apm-primary').disabled);
        assert.equal(hoard.w.document.querySelector('.apm-period-picker').value,'all');
        assert(!hoard.ops.includes('sampleTile'),'fewer than 10 usable hoards never start a terrain request');
        console.log('PASS hoard UI: isolated hoard RPC only, <10 blocks and offers CSV, All periods default, the record count prevents terrain requests.');
    } finally {hoard.dom.window.close();}
    const hoardGate=harness('hoardsMany');
    try {
        hoardGate.w.DetectLabHoardConfig.release.operatorOverride=false; // the closed-gate state
        await hoardGate.pick(46.75,25);
        const selector=hoardGate.w.document.querySelector('.apm-category-picker');
        selector.value='hoards';selector.dispatchEvent(new hoardGate.w.Event('change'));
        await until(()=>/hoards with the selected deposit period|tezaurele cu perioada/.test(hoardGate.w.document.querySelector('.apm-status').textContent),'hoard-ready load');
        const hint=hoardGate.w.document.querySelector('.apm-period-hint').textContent;
        assert(/hoards/.test(hint) && !/settlements/.test(hint),'the period note speaks about hoards: '+hint);
        const loadBtn=[].slice.call(hoardGate.w.document.querySelectorAll('.apm-btn.apm-small')).filter(b=>/hoard/i.test(b.textContent))[0];
        assert(loadBtn,'the reload button names what it loads: '+[].slice.call(hoardGate.w.document.querySelectorAll('.apm-btn')).map(b=>b.textContent).join(' | '));
        assert(!/repertory|settlement/i.test(loadBtn.textContent),'and it no longer claims to reload Romanian repertory sites');
        const status=hoardGate.w.document.querySelector('.apm-status').textContent;
        assert(!/settlements|așezări/i.test(status),'the green status names hoards, not settlements: '+status);
        const run=hoardGate.w.document.querySelector('.apm-primary');
        assert(!run.disabled,'with enough hoards the button is clickable, so the gate can explain itself');
        assert(/not activated/i.test(run.title),'the button carries the pending-review reason: '+run.title);
        const before=hoardGate.ops.length;
        run.click();
        await until(()=>/not activated/i.test(hoardGate.w.document.querySelector('.apm-status').textContent),'hoard release gate message');
        assert(hoardGate.ops.slice(before).every(op=>op!=='sampleTile'),'the closed gate starts no terrain request');
        assert(!hoardGate.completed,'and produces no result');
        const i18n=hoardGate.w.DetectLabApmI18n;
        for(const key of ['hoard.periodApplied','hoard.periodHelp','hoard.choosePeriod']){
            assert(/tezaur/.test(i18n.t(key,'ro')),key+' is written for hoards in Romanian: '+i18n.t(key,'ro'));
            assert(!/așezăr|asezar/i.test(i18n.t(key,'ro')),key+' does not borrow settlement wording in Romanian');
            assert(!/settlement/i.test(i18n.t(key,'en')),key+' does not borrow settlement wording in English');
        }
        console.log('PASS hoard gate: the period note and status talk about hoards, the release gate answers a click with its reason instead of a dead button, and both languages name tezaure.');
    } finally {hoardGate.dom.window.close();}
    // Operator override: the switch is the operator's, not evidence. It must let
    // TRAIN run, name itself in the panel, and travel with the result.
    const ovr=harness('hoardsMany');
    try {
        assert.equal(ovr.w.DetectLabHoardConfig.release.operatorOverride,true,'the operator switch ships ON at the operator request');
        ovr.w.DetectLabHoardConfig.resolutionM=1000;ovr.w.DetectLabHoardConfig.trainingRadiusKm=20; // synthetic window, same code path
        await ovr.pick(46.75,25);
        const selector=ovr.w.document.querySelector('.apm-category-picker');
        selector.value='hoards';selector.dispatchEvent(new ovr.w.Event('change'));
        await until(()=>/hoards with the selected deposit period/.test(ovr.w.document.querySelector('.apm-status').textContent),'override hoard load');
        const run=ovr.w.document.querySelector('.apm-primary');
        assert(!run.disabled,'operator override makes the button runnable');
        assert(/Operator override is ON/.test(run.title),'the button says why it is runnable: '+run.title);
        const pending=ovr.w.document.querySelector('.apm-note[role=status].apm-hoard-override');
        assert(pending && !pending.hidden,'the panel states the override while it is in force');
        assert(ovr.w.document.querySelector('.apm-train .apm-note')&&[...ovr.w.document.querySelectorAll('.apm-train .apm-note')].filter(n=>/not activated/.test(n.textContent)).every(n=>n.hidden),'the closed-gate note is gone');
        run.click();
        await until(()=>ovr.completed||ovr.runError,'override hoard run: status='+ovr.w.document.querySelector('.apm-status').textContent);
        assert(!ovr.runError,'operator override trains hoards: '+(ovr.runError&&ovr.runError.message));
        assert.equal(ovr.params.category,'hoards');
        const warns=(ovr.completed.warnings||[]).map(x=>x&&x.key);
        assert(warns.includes('warn.hoardOverride'),'the override travels with the result: '+warns.join(','));
        assert(/Operator override/.test(ovr.w.document.querySelector('.apm-warnings').textContent),'and it is listed in the result panel');
        console.log('PASS operator override: hoard TRAIN runs with the switch on, the panel and the result both say so.');
    } finally {ovr.dom.window.close();}
    const approx=harness('approximate');
    try {
        await approx.pick(46.75,25);
        const selector2=approx.w.document.querySelector('.apm-category-picker');
        selector2.value='hoards';selector2.dispatchEvent(new approx.w.Event('change'));
        await until(()=>/excluded/i.test(approx.w.document.querySelector('.apm-status').textContent),'approximate hoard load');
        const text=approx.w.document.querySelector('.apm-status').textContent;
        assert.match(text,/12 .*approximate/,'the panel names the approximate hoards it is hiding');
        assert.match(text,/include approximate/i,'and points at the switch that shows them');
        assert(approx.w.document.querySelector('.apm-primary').disabled,'training still blocked at 3 usable');
        console.log('PASS hoard approximate hint: a zero caused by the position filter is named, with the count and the switch, instead of a bare 0.');
    } finally {approx.dom.window.close();}
    const race=harness();
    try {
        await race.pick(46.75,25);
        const jobs=[];
        race.w.DetectLabApmPipeline.runTrain=(session,params)=>new Promise((resolve,reject)=>jobs.push({resolve,reject,params}));
        const run=race.w.document.querySelector('.apm-primary');
        run.click();assert.equal(jobs.length,1);
        race.clickText('Cancel');assert.equal(jobs[0].params.token.cancelled,true);
        run.click();assert.equal(jobs.length,2);
        jobs[1].params.onProgress('prog.train',65);
        const progress=race.w.document.querySelector('.apm-status').textContent;
        jobs[0].params.onProgress('prog.done',100);
        jobs[0].reject(Error('late error from cancelled run'));
        await delay(10);
        assert.equal(race.w.document.querySelector('.apm-status').textContent,progress,'stale error/progress cannot replace new status');
        assert(run.disabled,'stale cleanup cannot release the new busy gate');
        assert(race.w.document.querySelector('.apm-period-picker').disabled,'new period chooser stays locked while running');
        race.clickText('Cancel');assert.equal(jobs[1].params.token.cancelled,true,'new cancellation token survived old cleanup');
        jobs[1].resolve({});await delay(10);
        assert(!run.disabled);
        console.log('PASS cancel/restart race: old progress, errors and cleanup cannot overwrite the new run or its cancellation token.');
    } finally {race.dom.window.close();}
    const fail=harness('error');
    try {
        await fail.pick(46.75,25);
        assert.equal(fail.requests.length,1);
        assert.match(fail.w.document.querySelector('.apm-status').textContent,/failed.*not authorised.*CSV/);
        assert(!fail.w.document.querySelector('input[type=file]').parentElement.hidden);
        assert(fail.w.document.querySelector('.apm-primary').disabled);
        console.log('PASS RPC failure: explicit error + CSV upload, no fallback request.');
    } finally {fail.dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
