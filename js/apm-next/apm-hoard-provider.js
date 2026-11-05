/* Hoard positives: exactly one table RPC or an explicit replacement CSV. No alternate catalogue. */
(function(root,factory){
    var node=typeof module==='object'&&module.exports;
    var api=factory(root,node?require('./hoards.config.js'):root.DetectLabHoardConfig,node?require('./apm-hoards.js'):root.DetectLabApmHoards,node?require('./apm-sites.js'):root.DetectLabApmSites);
    if(node)module.exports=api;else root.DetectLabHoardProvider=api;
})(typeof window!=='undefined'?window:typeof self!=='undefined'?self:globalThis,function(root,config,hoards,sites){
    'use strict';
    function error(key,message){var e=new Error(message);e.key=key;return e;}
    function mapRow(r){return {id:r.id,name:r.name||'',lat:Number(r.lat),lon:Number(r.lon),type:'hoard',source:r.source,
        positionClass:r.position_class,positionAccuracy:r.position_accuracy_m,approximatePosition:r.position_class==='approximate',
        periodStart:r.deposit_start_year,periodEnd:r.deposit_end_year,periodLabel:r.period_group,
        periodGroups:r.period_groups||[],periods:(r.periods||[]).map(function(p){return {key:p.key,label:p.label,start:p.start,end:p.end};}),dateBasis:r.date_basis,hoardType:r.hoard_type};}
    function filter(records,center,period){
        var result=records.filter(function(r){return hoards.distanceM(center,r)<=config.trainingRadiusKm*1000&&
            (!period||(r.periodGroups||[]).indexOf(period.group)>=0);});
        return {sites:result,dropped:{}};
    }
    function groups(records){
        var meta=records._meta||{}, counts=meta.period_counts;
        if(!counts){counts={};records.forEach(function(r){(r.periodGroups||[]).forEach(function(k){counts[k]=(counts[k]||0)+1;});});}
        return config.periodGroups.concat(config.romanianPeriods).filter(function(g){return counts[g.key]>0;}).map(function(g){
            return {key:g.key,group:g.key,label:g.label,start:g.start,end:g.end,count:counts[g.key],selectable:true};
        });
    }
    function createProvider(options){
        options=options||{};
        async function rpc(name,args){
            var client=options.client||root.supabaseClient;
            if(!client||typeof client.rpc!=='function')throw error('hoard.rpcFailure','Supabase unavailable');
            var timer, req=client.rpc(name,args);
            try{
                var result=await Promise.race([req,new Promise(function(_,reject){timer=setTimeout(function(){reject(error('hoard.timeout','Hoard RPC timeout'));},options.timeoutMs||20000);})]);
                if(result.error)throw error('hoard.rpcFailure',result.error.message||'Hoard RPC failed');
                if(!result.data||!Array.isArray(result.data.rows))throw error('hoard.invalid','Invalid hoard response');
                return result.data;
            }finally{clearTimeout(timer);}
        }
        return {id:'hoards',
            getSites:async function(center,radiusKm,request){
                request=request||{};
                if(!Number.isFinite(center.lat)||!Number.isFinite(center.lon)||Math.abs(center.lat)>90||Math.abs(center.lon)>180)throw error('hoard.invalid','Invalid coordinates');
                var data=await rpc('apm_hoards_within',{p_lat:center.lat,p_lon:center.lon,p_radius_km:Math.min(config.trainingRadiusKm,radiusKm||config.trainingRadiusKm),p_filters:request.filters||{},p_mode:'sites'});
                var records=data.rows.map(mapRow).filter(function(r){return Number.isFinite(r.lat)&&Number.isFinite(r.lon);});
                // The server is authoritative, but malformed responses cannot bypass the minimum.
                var low=records.length<10;
                if(low)records=[];
                records._meta=Object.assign({},data,{rows:undefined,category:'hoards',offerCsv:low,insufficient:low,returned:records.length});
                return records;
            },
            getCounts:async function(center,filters){return rpc('apm_hoards_within',{p_lat:center.lat,p_lon:center.lon,p_radius_km:150,p_filters:filters||{},p_mode:'counts'});},
            getKnownSites:async function(center){return rpc('apm_hoard_known_sites',{p_lat:center.lat,p_lon:center.lon,p_radius_km:150});}
        };
    }
    function fromCsv(text,center,includeApproximate){
        var parsed=sites.parseSitesCsv(text,'csv');
        if(parsed.report.errors.length)throw new Error(parsed.report.errors.join(' '));
        var records=parsed.records.filter(function(r){return hoards.distanceM(center,r)<=150000&&r.positionAccuracy!=null&&r.positionAccuracy>=0&&
            (r.positionAccuracy<=100||includeApproximate);}).map(function(r){
            r.type='hoard';r.positionClass=r.positionAccuracy<=100?'exact':'approximate';r.approximatePosition=r.positionClass==='approximate';
            r.periodGroups=hoards.groupsFor(r.periodStart,r.periodEnd);r.dateBasis='deposit';return r;
        });
        records._meta={category:'hoards',csv:true,returned:records.length,unknown_period:records.filter(function(r){return !r.periodGroups.length;}).length};
        return records;
    }
    return {createProvider:createProvider,filter:filter,groups:groups,fromCsv:fromCsv};
});
