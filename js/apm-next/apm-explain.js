/* Polygon explanations: exact additive model terms over scored cell centres.
 * Worker-only in the app. No additional raster, network request or retained model.
 * Scan-line even/odd filling respects holes; cost is edges + intersected spans,
 * not a polygon-vertex test for every cell of the entire prediction raster.
 */
(function(root,factory){
    var api=factory(typeof module==='object'&&module.exports?require('./apm-core.js'):root.DetectLabApmCore);
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.DetectLabApmExplain=api;
})(typeof self!=='undefined'?self:this,function(core){
    'use strict';
    var VARIABLES=['altitude','slope','aspect','water','soil'];

    // Triplets [effective weight, suitability, weighted contribution]. Keep the
    // scoring functions unchanged; regression tests reconcile both decompositions
    // against the real scorer, including flat aspects and max-of-water curves.
    function cellParts(cell,mode,cfg,out,circular){
        out=out||new Float64Array(15);
        var curves=mode==='train'?cfg.model.curves:cfg.curves;
        var weights=mode==='train'?cfg.model.weights:cfg.weights;
        var den=mode==='train'?1:weights.relief+weights.water+weights.soil;
        var water=0;
        if(mode==='train'){
            if(weights.water)Object.keys(curves).forEach(function(k){
                if(k.indexOf('water_')!==0)return;
                var d=cell.waterDist[k.slice(6)];
                if(d!=null&&d===d)water=Math.max(water,core.interp(curves[k],d));
            });
        }else water=core.waterScore(cell.waterDist,curves.water,cfg.waterClasses);
        for(var i=0;i<VARIABLES.length;i++){
            var id=VARIABLES[i],weight=mode==='train'?(weights[id]||0):
                (den>0?(i<3?weights.relief*(i===2?.2:.4):weights[id])/den:0);
            var fit=0;
            if(weight){
                if(id==='water')fit=water;
                else if(id==='altitude')fit=core.interp(curves.altitude,cell.altPct);
                else if(id==='slope')fit=core.interp(curves.slope,cell.slope);
                else if(id==='soil')fit=core.interp(curves.soil,cell.soilPct);
                else if(mode==='train')fit=cell.slope>=(cfg.model.minSlopeDeg||.5)?(circular?core.interp(circular,((cell.aspect%360+360)%360)+360):core.interpCircular(curves.aspect,cell.aspect,360)):.5;
                else fit=cell.slope>=cfg.minSlopeDeg?core.interp(curves.aspectDeviation,core.angularDiff(cell.aspect,cfg.preferredAspectDeg)):.5;
            }
            out[3*i]=weight;out[3*i+1]=fit;out[3*i+2]=weight*fit;
        }
        return out;
    }

    // Visit each pixel centre inside a Polygon, excluding hole interiors. Edges
    // are bucketed once by first scan line and removed after their last row.
    // The half-open rule avoids double-counting vertices shared by two edges.
    function visitCells(rings,grid,visit){
        var starts=new Map(),first=grid.h,last=-1;
        rings.forEach(function(ring){
            for(var i=0,j=ring.length-1;i<ring.length;j=i++){
                var a=ring[j],b=ring[i];
                var ax=(a[0]-grid.west)/grid.dLon,ay=(grid.north-a[1])/grid.dLat;
                var bx=(b[0]-grid.west)/grid.dLon,by=(grid.north-b[1])/grid.dLat;
                if(ay===by)continue;
                var lo=Math.max(0,Math.ceil(Math.min(ay,by)-.5));
                var hi=Math.min(grid.h-1,Math.ceil(Math.max(ay,by)-.5)-1);
                if(lo>hi)continue;
                var slope=(bx-ax)/(by-ay),edge={end:hi,x:ax+(lo+.5-ay)*slope,step:slope};
                if(!starts.has(lo))starts.set(lo,[]);
                starts.get(lo).push(edge);first=Math.min(first,lo);last=Math.max(last,hi);
            }
        });
        var active=[];
        for(var row=first;row<=last;row++){
            active=active.filter(function(e){return e.end>=row;});
            if(starts.has(row)){active=active.concat(starts.get(row));starts.delete(row);}
            active.sort(function(a,b){return a.x-b.x;});
            for(var p=0;p+1<active.length;p+=2){
                var lo=Math.max(0,Math.ceil(active[p].x-.5));
                var hi=Math.min(grid.w-1,Math.ceil(active[p+1].x-.5)-1);
                for(var col=lo;col<=hi;col++)visit(row*grid.w+col);
            }
            active.forEach(function(e){e.x+=e.step;});
        }
    }

    function attach(fc,score,analysis,mode,cfg,threshold){
        var grid=analysis.grid,parts=new Float64Array(15);
        var cell={slope:0,aspect:0,altPct:0,soilPct:0,waterDist:{}};
        var classes=cfg.waterClasses||[],circular=null;
        if(mode==='train'&&cfg.model.weights.aspect){
            var points=cfg.model.curves.aspect.slice().sort(function(a,b){return a[0]-b[0];});
            circular=[];
            for(var shift=-360;shift<=360;shift+=360)points.forEach(function(p){circular.push([p[0]+shift,p[1]]);});
        }
        fc.features.forEach(function(feature){
            if(feature.properties.class!=='veryhigh'||feature.geometry.type!=='Polygon')return;
            var count=0,sum=0,min=Infinity,max=-Infinity,terms=new Float64Array(15);
            var altitude=0,slope=0,soil=0,sin=0,cos=0,directions=0,water={};
            classes.forEach(function(c){water[c]={sum:0,min:Infinity,max:0,count:0};});
            visitCells(feature.geometry.coordinates,grid,function(i){
                var s=score[i];
                if(!analysis.valid[i]||!Number.isFinite(s)||s<threshold||
                    (analysis.exclusionMask&&analysis.exclusionMask[i]))return;
                cell.slope=analysis.slope[i];cell.aspect=analysis.aspect[i];
                cell.altPct=analysis.altPct[i];cell.soilPct=analysis.soilPct[i];
                classes.forEach(function(c){
                    var d=analysis.waterDist[c]?analysis.waterDist[c][i]:Infinity;
                    cell.waterDist[c]=d;
                    if(Number.isFinite(d)){
                        var w=water[c];w.sum+=d;w.min=Math.min(w.min,d);w.max=Math.max(w.max,d);w.count++;
                    }
                });
                cellParts(cell,mode,cfg,parts,circular);
                for(var j=0;j<15;j++)terms[j]+=parts[j];
                altitude+=cell.altPct;slope+=cell.slope;soil+=cell.soilPct;
                var flat=mode==='train'?(cfg.model.minSlopeDeg||.5):cfg.minSlopeDeg;
                if(cell.slope>=flat){sin+=Math.sin(cell.aspect*Math.PI/180);cos+=Math.cos(cell.aspect*Math.PI/180);directions++;}
                count++;sum+=s;min=Math.min(min,s);max=Math.max(max,s);
            });
            var explanation={version:1,status:count?'available':'no_cells',mode:mode,
                aggregation:'highest-class-cell-centres',cells:count,threshold:threshold};
            if(count){
                explanation.score={mean:sum/count,min:min,max:max};
                explanation.variables=VARIABLES.map(function(id,i){
                    return {id:id,weight:terms[3*i]/count,suitability:terms[3*i+1]/count,contribution:terms[3*i+2]/count};
                }).sort(function(a,b){return b.contribution-a.contribution;});
                explanation.observations={altitudePercentile:altitude/count,slopeDeg:slope/count,soilPercentile:soil/count,
                    aspectDeg:directions&&Math.hypot(sin,cos)/directions>1e-6?((Math.atan2(sin,cos)*180/Math.PI+360)%360):null,
                    directionalCells:directions,neutralAspectCells:count-directions,
                    water:classes.filter(function(c){return water[c].count;}).map(function(c){
                        var w=water[c];return {class:c,meanM:w.sum/w.count,minM:w.min,maxM:w.max,cells:w.count};
                    })};
            }
            feature.properties.explanation=explanation;
        });
        return fc;
    }
    return {variables:VARIABLES,cellParts:cellParts,visitCells:visitCells,attach:attach};
});
