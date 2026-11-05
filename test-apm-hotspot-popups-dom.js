'use strict';
// Real Leaflet SVG/event/popup wiring in jsdom. No tile service or browser renderer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('node:module').createRequire(path.join(__dirname,'tools/apm-test/package.json'))('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dom=new JSDOM('<!doctype html><html lang="en"><body><div id="map" style="width:640px;height:480px"></div></body></html>',
   {url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 try{
  w.SVGSVGElement.prototype.createSVGRect=()=>({}); // jsdom has SVG nodes, but no geometry renderer
  w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w._dlIsPremium=()=>true;
  w.localStorage.setItem('detectlab_lang','en');
  const style=w.document.createElement('style');style.textContent=read('css/next-gen-apm.css');w.document.head.appendChild(style);
  w.eval(read('js/leaflet.js'));
  const container=w.document.getElementById('map');
  Object.defineProperties(container,{clientWidth:{value:640},clientHeight:{value:480},offsetWidth:{value:640},offsetHeight:{value:480}});
  container.getBoundingClientRect=()=>({left:0,top:0,right:640,bottom:480,width:640,height:480});
  w.map=w.L.map(container,{zoomControl:false,attributionControl:false,zoomAnimation:false}).setView([46.996,23.006],16);
  for(const f of ['apm-core','apm-raster','apm-heatmap','apm-sites','apm-providers','romania-periods.config','hoards.config',
   'apm-hoards','apm-hoard-provider','apm-hoard-scale','apm-romania-sites','apm-i18n','apm-train-cache','apm-pipeline','apm-ui'])w.eval(read('js/apm-next/'+f+'.js'));
  const summary={version:1,status:'available',mode:'manual',cells:20,threshold:.85,score:{mean:.92,min:.86,max:.98},
   variables:[{id:'altitude',weight:.4,suitability:1,contribution:.4},{id:'slope',weight:.4,suitability:1,contribution:.4},
    {id:'aspect',weight:.2,suitability:.6,contribution:.12},{id:'water',weight:0,suitability:0,contribution:0},{id:'soil',weight:0,suitability:0,contribution:0}],
   observations:{altitudePercentile:.5,slopeDeg:5,aspectDeg:180,soilPercentile:.5,neutralAspectCells:0,water:[]}};
  const make=(x,id)=>({type:'Feature',properties:{class:'veryhigh',areaM2:5000,id,explanation:summary},geometry:{type:'Polygon',coordinates:[
   [[x,46.993],[x+.004,46.993],[x+.004,46.999],[x,46.999],[x,46.993]],
   [[x+.001,46.995],[x+.003,46.995],[x+.003,46.997],[x+.001,46.997],[x+.001,46.995]]
  ]}});
  const features=[make(23.001,'left'),make(23.007,'right')];
  w.DetectLabApmPipeline.runManual=async()=>({mode:'manual',geojson:{type:'FeatureCollection',features},
   thresholds:{medium:.4,high:.6,veryhigh:.85},areaKm2:{medium:0,high:0,veryhigh:.01},scoreStats:{cells:40},provenance:{},warnings:[]});
  w.DetectLabApmUi.init();w.DetectLabApmUi.setEnabled(true);
  const pick=[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pick point on map');
  assert(pick);pick.click();w.map.fire('click',{latlng:w.L.latLng(46.996,23.006)});
  const run=w.document.querySelector('.apm-primary');assert(!run.disabled);run.click();
  await delay(20);
  const paths=[];w.map.eachLayer(l=>{if(l.feature&&l.feature.properties&&l.feature.properties.class==='veryhigh')paths.push(l);});
  assert.equal(paths.length,2,'every highest-class polygon is a separate interactive Leaflet path');
  for(const layer of paths){
   const x=layer.feature.geometry.coordinates[0][0][0];
   assert.equal(layer.options.interactive,true);assert.equal(layer.options.fill,true);assert.equal(layer.options.fillRule,'evenodd');
   assert.equal(layer.options.fillOpacity,.001);assert.equal(typeof layer.getPopup().getContent(),'function','popup is lazy');
   assert(layer._containsPoint(w.map.latLngToLayerPoint([46.994,x+.0005])),'polygon interior, not just outline, is hit-testable');
   assert(!layer._containsPoint(w.map.latLngToLayerPoint([46.996,x+.002])),'hole is not an interior hit target');
   const element=layer.getElement();assert(element.classList.contains('leaflet-interactive'));
   const pixel=w.map.latLngToContainerPoint([46.994,x+.0005]);
   element.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:pixel.x,clientY:pixel.y}));
   assert(layer.isPopupOpen(),'actual Leaflet DOM click opens the popup');
   const popup=w.document.querySelector('.apm-explanation-popup');assert(popup);
   assert(popup.textContent.includes('Why this area scored highly'));assert(popup.textContent.includes('Suitability 92.0/100'));
   assert.equal(popup.querySelectorAll('.apm-explain-variables li').length,5);
   w.map.closePopup();
  }
  w.localStorage.setItem('detectlab_lang','ro');paths[0].openPopup();
  assert(w.document.querySelector('.apm-explanation-popup').textContent.includes('De ce această zonă'),'language read lazily on open');
  pick.click();assert(w.dlApmPicking);assert(!paths[0].isPopupOpen(),'picking closes the explanatory popup');
  assert.equal(w.getComputedStyle(paths[0].getElement()).pointerEvents,'none','existing fill cannot block point picking');
  const point=w.map.latLngToContainerPoint([46.994,23.0015]);
  container.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y}));
  await delay(10);assert.equal(w.DetectLabApmUi.state().picking,false);
  assert(Math.abs(w.DetectLabApmUi.state().centre.lat-46.994)<.0001);
  assert.notEqual(w.getComputedStyle(paths[0].getElement()).pointerEvents,'none','normal popup hit target restored after picking');
  console.log('PASS real Leaflet: all polygon interiors open lazy explanation popups; holes do not hit; bilingual content; bounded popup options.');
 }finally{if(w.map&&w.map.remove)w.map.remove();dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
