'use strict';
// Offline real-model, geometry, worker and DOM regression checks. No live data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {JSDOM}=createRequire(path.join(__dirname,'tools/apm-test/package.json'))('jsdom');
const core=require('./js/apm-next/apm-core.js'),R=require('./js/apm-next/apm-raster.js');
const P=require('./js/apm-next/apm-polygonise.js'),E=require('./js/apm-next/apm-explain.js');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
function close(a,b,tol=1e-7){assert(Math.abs(a-b)<tol,`${a} != ${b}`);}
const manual={curves:core.cloneCurves(core.DEFAULT_CURVES),weights:{relief:2,water:3,soil:1},
    minSlopeDeg:.5,preferredAspectDeg:180,waterClasses:['small','medium','large']};
const train={model:{minSlopeDeg:.5,weights:{altitude:.2,slope:.25,aspect:.15,water:.3,soil:.1},curves:{
    altitude:[[0,.2],[.5,1],[1,.4]],slope:[[0,.6],[5,1],[30,0]],
    aspect:[[270,.3],[0,1],[90,.3],[180,0]],soil:[[0,.2],[1,1]],
    water_small:[[0,.4],[100,1],[1000,0]],water_large:[[0,0],[800,.9],[3000,0]]}},waterClasses:['small','large']};
const g={w:12,h:10,west:0,north:10,dLon:1,dLat:1};
const ring=xy=>xy.map(([x,y])=>[g.west+x*g.dLon,g.north-y*g.dLat]);
const rect=(x,y,w,h)=>ring([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]);
function polygon(rings){return {type:'Feature',properties:{class:'veryhigh',areaM2:5000},geometry:{type:'Polygon',coordinates:rings}};}
function contains(point,rings){
    let result=false;
    for(const r of rings)for(let i=0,j=r.length-1;i<r.length;j=i++){
        const a=r[i],b=r[j];
        if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
    }return result;
}
function analysis(grid=g){
    const n=grid.w*grid.h,A={grid,valid:new Uint8Array(n).fill(1),exclusionMask:new Uint8Array(n),
        slope:new Float32Array(n),aspect:new Float32Array(n),altPct:new Float32Array(n),soilPct:new Float32Array(n),
        waterDist:{small:new Float32Array(n),large:new Float32Array(n)}};
    for(let i=0;i<n;i++){A.slope[i]=i%4?5:0;A.aspect[i]=i%2?359:1;A.altPct[i]=(i%n)/n;A.soilPct[i]=1-A.altPct[i];
        A.waterDist.small[i]=i%3?100:Infinity;A.waterDist.large[i]=800;}
    return A;
}
function cell(A,i){return {slope:A.slope[i],aspect:A.aspect[i],altPct:A.altPct[i],soilPct:A.soilPct[i],
    waterDist:Object.fromEntries(Object.keys(A.waterDist).map(k=>[k,A.waterDist[k][i]]))};}
let sampleFeature;
test('exact MANUAL/TRAIN contributions reconcile with the unchanged scorers',()=>{
    let seed=123;const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    for(let i=0;i<1500;i++){
        const c={slope:i%5?rand()*30:0,aspect:rand()*1440-720,altPct:rand(),soilPct:rand(),
            waterDist:{small:i%7?rand()*2000:Infinity,medium:NaN,large:i%11?rand()*3000:undefined}};
        for(const [mode,cfg] of [['manual',manual],['train',train]]){
            const parts=E.cellParts(c,mode,cfg);let sum=0;
            for(let j=2;j<15;j+=3)sum+=parts[j];
            close(sum,mode==='train'?core.trainCellScore(c,cfg.model):core.manualCellScore(c,cfg),1e-12);
        }
    }
    const parts=E.cellParts({slope:0,aspect:180,altPct:.5,soilPct:.5,waterDist:{small:10,large:800}},'manual',manual);
    close(parts[0],2*.4/6);close(parts[3],2*.4/6);close(parts[6],2*.2/6);close(parts[9],3/6);close(parts[12],1/6);
    close(parts[7],.5); // neutral flat aspect
    const t=E.cellParts({slope:0,aspect:180,altPct:.5,soilPct:.5,waterDist:{small:0,large:800}},'train',train);
    close(t[10],.9); // best fitting water class, not the nearest class
    const excluded={model:{curves:{},weights:{altitude:0,slope:0,aspect:0,soil:0,water:0}}};
    assert([...E.cellParts({},'train',excluded)].every(x=>x===0));
});
test('scan-line attribution equals brute-force membership for concavity, holes and reversed rings',()=>{
    const shapes=[
        [rect(.2,.2,9.6,8.6),rect(2.2,2.2,2.6,2.6)],
        [ring([[.2,.2],[10.2,.2],[10.2,2.2],[4.2,2.2],[4.2,8.2],[.2,8.2],[.2,.2]])],
        [ring([[-2.3,-1.1],[14.7,1.2],[7.3,12.8],[-2.3,-1.1]]),rect(6.2,4.2,1.6,1.6)]
    ];
    for(const rings of shapes)for(const rs of [rings,rings.map(r=>r.slice().reverse())]){
        const got=[];E.visitCells(rs,g,i=>got.push(i));
        const expected=[];
        for(let y=0;y<g.h;y++)for(let x=0;x<g.w;x++)if(contains([x+.5,g.north-y-.5],rs))expected.push(y*g.w+x);
        assert.deepEqual(got,expected);assert.equal(new Set(got).size,got.length);
    }
});
test('per-polygon means use actual eligible cells, never centroid/global/protected/hole values',()=>{
    const A=analysis(),n=g.w*g.h,score=new Float32Array(n);
    for(let i=0;i<n;i++)score[i]=core.trainCellScore(cell(A,i),train.model);
    A.exclusionMask[15]=1;A.exclusionMask[16]=2;A.valid[17]=0;score[18]=NaN;score[19]=.1;
    const fc={type:'FeatureCollection',features:[polygon([rect(1,1,5,7),rect(2,3,2,2)]),polygon([rect(7,1,3,7)])]};
    const geometry=JSON.stringify(fc.features.map(f=>f.geometry));
    E.attach(fc,score,A,'train',train,.25);
    assert.equal(JSON.stringify(fc.features.map(f=>f.geometry)),geometry,'explanations never change geometry');
    for(const f of fc.features){
        const indices=[];
        for(let i=0;i<n;i++)if(contains([i%g.w+.5,g.north-Math.floor(i/g.w)-.5],f.geometry.coordinates)&&
            A.valid[i]&&!A.exclusionMask[i]&&Number.isFinite(score[i])&&score[i]>=.25)indices.push(i);
        const e=f.properties.explanation;assert.equal(e.status,'available');assert.equal(e.cells,indices.length);
        close(e.score.mean,indices.reduce((s,i)=>s+score[i],0)/indices.length);
        close(e.score.min,Math.min(...indices.map(i=>score[i])));close(e.score.max,Math.max(...indices.map(i=>score[i])));
        close(e.variables.reduce((s,v)=>s+v.contribution,0),e.score.mean);
        for(const v of e.variables){const k=E.variables.indexOf(v.id)*3;
            close(v.suitability,indices.reduce((s,i)=>s+E.cellParts(cell(A,i),'train',train)[k+1],0)/indices.length);
            close(v.contribution,indices.reduce((s,i)=>s+E.cellParts(cell(A,i),'train',train)[k+2],0)/indices.length);
        }
        assert(e.observations.aspectDeg<2||e.observations.aspectDeg>358,'circular mean must not report south for north-facing cells');
    }
    assert.notEqual(fc.features[0].properties.explanation.score.mean,fc.features[1].properties.explanation.score.mean);
    sampleFeature=fc.features[0];
    assert(!JSON.stringify(fc).includes('null'),'available summaries must not serialize NaN/Infinity');
    const tiny={type:'FeatureCollection',features:[polygon([rect(.01,.01,.1,.1)])]};
    E.attach(tiny,score,A,'train',train,.25);assert.equal(tiny.features[0].properties.explanation.status,'no_cells');
});
test('real worker emits explanations on MANUAL, TRAIN and rescoring without changing contour/exclusion semantics',()=>{
    let response;const ctx={console};ctx.self=ctx;ctx.postMessage=m=>response=m;
    ctx.importScripts=(...files)=>files.forEach(f=>vm.runInContext(read('js/apm-next/'+f.split('?')[0]),ctx));
    vm.createContext(ctx);vm.runInContext(read('js/apm-next/apm-worker.js'),ctx);
    const send=(op,p)=>{ctx.onmessage({data:{...p,op,id:1}});assert.equal(response.ok,true,response.error);return response;};
    const grid={w:40,h:40,west:23,north:47,dLon:.0003,dLat:.0002},n=1600;
    const elev=Float32Array.from({length:n},(_,i)=>200+(i%40)*2+Math.floor(i/40));
    const mask=new Uint8Array(n);for(let y=18;y<22;y++)for(let x=18;x<22;x++)mask[y*40+x]=1;
    send('setAnalysis',{grid,elev,circle:{lat:46.996,lon:23.006,radiusM:5000},smooth:false,exclusionMask:mask,
        waterMasks:{},altRef:[0,100,200,300,400],soilRef:[-1,0,1]});
    const curves=core.cloneCurves(core.DEFAULT_CURVES);
    curves.altitude=[[0,1],[1,1]];curves.slope=[[0,1],[90,1]];curves.aspectDeviation=[[0,1],[180,1]];
    const args={mode:'manual',curves,weights:{relief:1,water:0,soil:0},minSlopeDeg:0,preferredAspectDeg:180,
        waterClasses:[],thresholds:{medium:.3,high:.6,veryhigh:.85},minAreaM2:0,smoothIters:0};
    const result=send('score',args);assert(result.geojson.features.length);
    for(const f of result.geojson.features){const e=f.properties.explanation;assert.equal(e.status,'available');close(e.score.mean,1);assert(e.cells>0);}
    const sp=R.gridSpacingM(grid),t=R.terrain(elev,40,40,sp.dx,sp.dy,{}),scores=new Float32Array(n).fill(NaN);
    for(let i=0;i<n;i++)if(t.valid[i]&&!mask[i])scores[i]=1;
    const expected=P.polygonise(scores,grid,args.thresholds,{minAreaM2:0,smoothIters:0,highestOnly:true,exclusionMask:mask});
    assert.equal(JSON.stringify(result.geojson.features.map(f=>f.geometry)),JSON.stringify(expected.features.map(f=>f.geometry)));
    curves.altitude=[[0,.9],[1,.9]];const rescore=send('score',args);
    for(const f of rescore.geojson.features)close(f.properties.explanation.score.mean,.96);
    const model={weights:{altitude:.4,slope:.6,aspect:0,soil:0,water:0},curves:{altitude:[[0,.8],[1,.8]],slope:[[0,1],[90,1]]}};
    const trained=send('score',{...args,mode:'train',model,thresholds:{medium:.3,high:.5,veryhigh:.8}});
    assert(trained.geojson.features.length);for(const f of trained.geojson.features){
        assert.equal(f.properties.explanation.mode,'train');close(f.properties.explanation.score.mean,.92);
        close(f.properties.explanation.variables.reduce((s,v)=>s+v.contribution,0),.92);
    }
});
test('million-cell aggregation stays bounded and handles hundreds of holes',()=>{
    const grid={w:1024,h:1024,west:0,north:1024,dLon:1,dLat:1},A=analysis(grid),score=new Float32Array(1024*1024).fill(1);
    const rings=[[[0,0],[1024,0],[1024,1024],[0,1024],[0,0]]];
    for(let y=30;y<1000;y+=48)for(let x=30;x<1000;x+=48)rings.push([[x,y],[x+3,y],[x+3,y+3],[x,y+3],[x,y]]);
    const curves=core.cloneCurves(core.DEFAULT_CURVES);
    curves.altitude=[[0,1],[1,1]];curves.slope=[[0,1],[90,1]];curves.aspectDeviation=[[0,1],[180,1]];curves.soil=[[0,1],[1,1]];
    Object.keys(curves.water).forEach(k=>curves.water[k]=[[0,1],[10000,1]]);
    A.slope.fill(5);A.aspect.fill(180);
    const cfg={...manual,curves},fc={features:[polygon(rings)]};const start=performance.now();
    E.attach(fc,score,A,'manual',cfg,.85);
    const ms=Math.round(performance.now()-start),e=fc.features[0].properties.explanation;
    assert.equal(e.cells,1024*1024-(rings.length-1)*9);
    assert(ms<30000,'bounded offline aggregation budget');assert(JSON.stringify(e).length<3500,'summary is compact, no per-cell payload');
    console.log(`  ${e.cells} cells, ${rings.length-1} holes, ${ms} ms; no additional per-variable raster`);
});
test('popup DOM is bilingual, escaped, compact, and honest about missing/disabled variables',()=>{
    const dom=new JSDOM('<html lang="en"><body></body></html>',{url:'https://fixture.invalid',runScripts:'outside-only'});
    const w=dom.window;
    try{
        for(const f of ['apm-core','apm-sites','apm-i18n','apm-ui'])w.eval(read('js/apm-next/'+f+'.js'));
        w.localStorage.setItem('detectlab_lang','en');
        const res={mode:'train',provenance:{sites:{selectedPeriod:{label:'<img src=x onerror=alert(1)> Roman'}}}};
        let popup=w.DetectLabApmUi.hotspotPopup(sampleFeature,res),text=popup.textContent;
        assert(text.includes('Why this area scored highly'));assert(text.includes('Roman'));assert.equal(popup.querySelectorAll('img,script').length,0);
        assert(text.includes('not a calibrated probability'));assert(text.includes('score points'));assert.equal(popup.querySelectorAll('li').length,5);
        assert(!/explain\.|undefined|NaN|Infinity/.test(text));
        const old=polygon([rect(1,1,2,2)]);assert(w.DetectLabApmUi.hotspotPopup(old,{}).textContent.includes('No scored-cell summary'));
        const disabled=JSON.parse(JSON.stringify(sampleFeature));disabled.properties.explanation.variables[0].weight=0;
        assert(w.DetectLabApmUi.hotspotPopup(disabled,res).textContent.includes('Not used in this score'));
        w.localStorage.setItem('detectlab_lang','ro');popup=w.DetectLabApmUi.hotspotPopup(sampleFeature,res);
        assert(popup.textContent.includes('De ce această zonă'));assert(popup.textContent.includes('probabilitate calibrată'));
        for(const lang of ['en','ro'])for(const k of Object.keys(w.DetectLabApmI18n.STRINGS.en).filter(k=>k.startsWith('explain.'))){
            assert(w.DetectLabApmI18n.STRINGS[lang][k],`${lang}:${k}`);
        }
    }finally{dom.window.close();}
});
test('interior hit targets and lazy popup bindings retain outlines/holes; PWA wiring matches',()=>{
    const ui=read('js/apm-next/apm-ui.js'),html=read('index.html'),sw=read('sw.js');
    assert(ui.includes("fill: true, fillColor: '#d9f5ff', fillOpacity: 0.001, fillRule: 'evenodd'"));
    assert(ui.includes('l.bindPopup(function(){return hotspotPopup(f,res);},'));
    assert(ui.includes('minWidth:200,maxWidth:320,maxHeight:320'));
    for(const asset of ['js/apm-next/apm-ui.js','js/apm-next/apm-i18n.js','css/next-gen-apm.css'])assert(html.includes(asset+'?v=20261109-apm-hoard-wording'));
    for(const asset of ['apm-ui','apm-i18n','apm-worker','apm-loading-preview'])assert(sw.includes('js/apm-next/'+asset+'.js?v=20261109-apm-hoard-wording'));
    assert(sw.includes('js/apm-next/apm-explain.js?v=20261105-apm-hotspot-explain'));
    assert(/const CACHE_NAME = 'detectlab-v\d+-[a-z0-9-]+';/.test(sw));
});
console.log(`${passed} polygon-explanation checks passed.`);
