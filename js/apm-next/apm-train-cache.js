/* Optional cache of public environmental inputs only, never sites or models.
 * IndexedDB: 32 MiB / 128 entries, FIFO, 10-minute TTL. Restricted/private PWA
 * fallback: 4 MiB / 16 entries in RAM. No raster-valued eviction scans.
 * Cache failures/timeouts must not stop TRAIN. Buffers are owned copies so
 * postMessage transfers never detach the cache's retained input.
 */
(function(root,factory){
    var api=factory(typeof indexedDB!=='undefined'?indexedDB:null);
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.DetectLabTrainCache=api;
})(typeof self!=='undefined'?self:this,function(defaultIdb){
    'use strict';
    function create(options){
        options=options||{};
        var idb=Object.prototype.hasOwnProperty.call(options,'indexedDB')?options.indexedDB:defaultIdb;
        var diskLimit=options.diskBytes||32*1024*1024, memoryLimit=options.memoryBytes||4*1024*1024;
        var ttl=options.ttlMs||10*60*1000, timeout=options.timeoutMs||1500;
        var memory=new Map(), memoryBytes=0, opened;
        function copy(value){return Object.prototype.toString.call(value)==='[object ArrayBuffer]'?value.slice(0):value;}
        function forget(key){if(memory.has(key)){memoryBytes-=memory.get(key).bytes;memory.delete(key);}}
        function remember(key,value,bytes,expires){
            forget(key);
            if(bytes>memoryLimit)return;
            memory.set(key,{value:copy(value),bytes:bytes,expires:expires});memoryBytes+=bytes;
            while(memoryBytes>memoryLimit||memory.size>16)forget(memory.keys().next().value);
        }
        function open(){
            if(!idb)return Promise.resolve(null);
            if(opened)return opened;
            opened=new Promise(function(resolve){
                var settled=false,timer=setTimeout(function(){done(null);},timeout);
                function done(db){if(settled){if(db)db.close();return;}settled=true;clearTimeout(timer);resolve(db);}
                try{
                    var req=idb.open(options.name||'detectlab-apm-train-inputs-v1',1);
                    req.onupgradeneeded=function(){req.result.createObjectStore('data');req.result.createObjectStore('meta');};
                    req.onsuccess=function(){
                        req.result.onversionchange=function(){req.result.close();opened=Promise.resolve(null);};
                        done(req.result);
                    };
                    req.onerror=req.onblocked=function(){done(null);};
                }catch(e){done(null);}
            });return opened;
        }
        // Safari can stall an IDB transaction after a PWA background/foreground
        // transition. Abort and fall back, instead of hanging the analysis.
        function transaction(db,mode,fallback,work){
            return new Promise(function(resolve){
                var tx,settled=false,timer=setTimeout(function(){
                    opened=Promise.resolve(null);done(fallback);
                    try{if(tx)tx.abort();db.close();}catch(e){}
                },timeout);
                function done(value){if(settled)return;settled=true;clearTimeout(timer);resolve(value);}
                try{
                    tx=db.transaction(['data','meta'],mode);
                    var result=work(tx);
                    tx.oncomplete=function(){done(result());};
                    tx.onerror=tx.onabort=function(){done(fallback);};
                }catch(e){done(fallback);try{if(tx)tx.abort();}catch(ignore){}}
            });
        }
        return {
            get:async function(key){
                var now=Date.now(),rec=memory.get(key);
                if(rec){if(rec.expires>now){memory.delete(key);memory.set(key,rec);return copy(rec.value);}forget(key);}
                var db=await open();if(!db)return undefined;
                return transaction(db,'readonly',undefined,function(tx){
                    var meta=tx.objectStore('meta').get(key),result;
                    meta.onsuccess=function(){if(meta.result&&meta.result.expires>Date.now()){
                        var r=tx.objectStore('data').get(key);r.onsuccess=function(){result=r.result;};
                    }};
                    return function(){return result;};
                });
            },
            put:async function(key,value,bytes){
                if(!Number.isFinite(bytes)||bytes<0||bytes>diskLimit)return false;
                var expires=Date.now()+ttl,db=await open();
                if(!db){remember(key,value,bytes,expires);return true;}
                var saved=await transaction(db,'readwrite',false,function(tx){
                    var data=tx.objectStore('data'),meta=tx.objectStore('meta');
                    data.put(value,key);meta.put({key:key,bytes:bytes,expires:expires,created:Date.now()},key);
                    var r=meta.getAll();
                    r.onsuccess=function(){
                        var entries=r.result.sort(function(a,b){return a.created-b.created;}),total=0,kept=[];
                        entries.forEach(function(e){if(e.expires<=Date.now()){data.delete(e.key);meta.delete(e.key);}else{total+=e.bytes;kept.push(e);}});
                        while(total>diskLimit||kept.length>128){var old=kept.shift();total-=old.bytes;data.delete(old.key);meta.delete(old.key);}
                    };
                    return function(){return true;};
                });
                if(saved)forget(key);else remember(key,value,bytes,expires);
                return saved;
            },
            memoryStats:function(){return {bytes:memoryBytes,entries:memory.size,limit:memoryLimit};}
        };
    }
    return {create:create};
});
