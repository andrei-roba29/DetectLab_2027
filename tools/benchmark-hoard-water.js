/* Read-only operator diagnostic. Load into an idle DetectLab page (DevTools).
 * await inspectHoardWater({lat:46.77,lon:23.59})                // count preflight only
 * await inspectHoardWater({lat:46.77,lon:23.59,run:true})       // bounded live water download
 * Repeat to measure the diagnostic's cache. This is NOT an end-to-end TRAIN benchmark.
 * Uses configured providers/layer discovery; does not invent layer IDs/endpoints.
 */
(function(root){
    'use strict';
    root.inspectHoardWater=async function(options){
        options=options||{};
        var P=root.DetectLabApmProviders,core=root.DetectLabApmCore,pipe=root.DetectLabApmPipeline;
        if(!P||!core||!pipe)throw new Error('Open DetectLab with the APM modules loaded first. Do not run alongside another analysis.');
        var center={lat:Number(options.lat),lon:Number(options.lon)};
        if(!Number.isFinite(center.lat)||!Number.isFinite(center.lon)||Math.abs(center.lat)>90||Math.abs(center.lon)>180)throw new Error('Invalid coordinates');
        var max=options.maxRequests||120,deadline=options.deadlineMs||90000;
        var token={cancelled:false},controller=new AbortController(),requests=[],start=performance.now(),timer;
        var panel=document.createElement('div');
        panel.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#102136;color:white;padding:16px;max-width:420px;font:14px sans-serif';
        var status=document.createElement('div'),progress=document.createElement('progress'),cancel=document.createElement('button');
        progress.max=max;cancel.textContent='Cancel / Anulează';
        cancel.onclick=function(){token.cancelled=true;controller.abort();};panel.append(status,progress,cancel);document.body.appendChild(panel);
        var nativeFetch=root.fetch.bind(root);
        async function measuredFetch(url,init){
            if(token.cancelled||requests.length>=max||performance.now()-start>deadline){token.cancelled=true;controller.abort();var e=new Error('Benchmark request/time budget exceeded');e.code='cancelled';throw e;}
            var r={url:String(url),started_ms:performance.now()-start};requests.push(r);progress.value=requests.length;
            status.textContent='Requests / Cereri: '+requests.length+' / '+max;
            var opts=Object.assign({},init||{});opts.signal=controller.signal;
            try{var res=await nativeFetch(url,opts);r.status=res.status;return res;}catch(e){r.error=String(e);throw e;}finally{r.response_ms=performance.now()-start-r.started_ms;}
        }
        P.setFetch(measuredFetch);
        try{
            var box=core.circleBBox(center.lat,center.lon,151000),plan=P.waterPlan(center.lat,center.lon),chosen=plan.find(function(p){return p.use&&p.provider.id==='eu-hydro';});
            if(!chosen)throw new Error('EU-Hydro is not available in this area; use existing fallback diagnostics instead.');
            var map=options.strahlerMap||P.defaultStrahlerMap(),layers=await chosen.provider.layers(),counts=[];
            for(var layer of layers){
                if(layer.role==='drainage')continue;
                var cls=layer.order==null?layer.cls:P.strahlerToClass(layer.order,map);if(!cls)continue;
                var url=new URL(P.buildEsriQuery(P.CONFIG.euHydro.base,layer.id,box,{}));
                url.searchParams.set('f','json');url.searchParams.set('returnCountOnly','true');url.searchParams.set('returnGeometry','false');
                ['outFields','resultRecordCount','resultOffset'].forEach(function(k){url.searchParams.delete(k);});
                var result=await (await measuredFetch(url.href)).json();
                if(result.error||!Number.isFinite(result.count))throw new Error('Count preflight unsupported or failed: '+JSON.stringify(result));
                counts.push({id:layer.id,name:layer.name,count:result.count});
            }
            var lower=counts.reduce(function(n,l){return n+Math.max(1,Math.ceil(l.count/P.CONFIG.euHydro.maxRecordsPerQuery));},0);
            var summary={kind:'water-only diagnostic, NOT full TRAIN',center:center,radius_km:150,counts:counts,
                minimum_water_queries:lower,note:'Lower bound, not a promise: recursive subdivision and boundary duplication add requests.',preflight_requests:requests.length};
            console.log('Hoard water preflight',summary);
            status.textContent='At least / Cel puțin '+lower+' water queries; preflight '+requests.length+'.';
            if(!options.run)return summary;
            // The operator sees the estimate BEFORE the expensive water request.
            if(!root.confirm('150 km water-only benchmark: at least '+lower+' queries, '+max+' request cap, '+Math.round(deadline/1000)+' seconds. Continue?'))return summary;
            start=performance.now();timer=setTimeout(function(){token.cancelled=true;controller.abort();},deadline);
            var key='hoard-water-diagnostic-v1|'+JSON.stringify({box:box,map:map});
            var cached=await P.cacheGet(key),data=cached&&(cached.value||cached),warnings=[];
            if(!data){var response=await pipe.fetchWaterChain(center,box,token,warnings,{strahlerMap:map,includeDrainage:false});data=response.water;await P.cacheSet(key,data,7*86400000);}
            summary.cached=!!cached;summary.water_ms=performance.now()-start;summary.requests=requests;summary.warnings=warnings;
            summary.line_count=data.lines.length;summary.polygon_count=data.polygons.length;
            console.log('Hoard water benchmark result',summary);return summary;
        }finally{if(timer)clearTimeout(timer);P.setFetch(nativeFetch);cancel.textContent='Close / Închide';cancel.onclick=function(){panel.remove();};}
    };
})(window);
