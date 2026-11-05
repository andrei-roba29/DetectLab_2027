/* Hoard-only sampling scale contract. Existing settlement grids are intentionally untouched. */
(function(root,factory){
    var node=typeof module==='object'&&module.exports;
    var api=factory(node?require('./apm-raster.js'):root.DetectLabApmRaster,node?require('./apm-core.js'):root.DetectLabApmCore);
    if(node)module.exports=api;else root.DetectLabHoardScale=api;
})(typeof self!=='undefined'?self:this,function(raster,core){
    'use strict';
    // A single angular lattice anchored at the training centre. Subgrids retain the
    // exact spacing; no extent-dependent rounding may silently alter resolution.
    function grid(bbox,centre,resolutionM){
        if(!Number.isFinite(resolutionM)||resolutionM<=0)throw new Error('Invalid hoard resolution');
        var mpd=core.metresPerDegree(centre.lat),dx=resolutionM/mpd.lon,dy=resolutionM/mpd.lat;
        var left=Math.floor((bbox.west-centre.lon)/dx),right=Math.ceil((bbox.east-centre.lon)/dx);
        var bottom=Math.floor((bbox.south-centre.lat)/dy),top=Math.ceil((bbox.north-centre.lat)/dy);
        return {west:centre.lon+left*dx,north:centre.lat+top*dy,w:right-left,h:top-bottom,dLon:dx,dLat:dy,analysisResolutionM:resolutionM,analysisLatitude:centre.lat};
    }
    function assertSame(training,prediction){
        if(training.analysisResolutionM!==prediction.analysisResolutionM||Math.abs(training.dLon-prediction.dLon)>1e-12||Math.abs(training.dLat-prediction.dLat)>1e-12||training.analysisLatitude!==prediction.analysisLatitude)throw new Error('TRAIN/prediction resolution mismatch');
        return true;
    }
    function spacing(g){var m=core.metresPerDegree(g.analysisLatitude);return {dx:g.dLon*m.lon,dy:g.dLat*m.lat};}
    function pointRadius(point,minimum){return Math.max(minimum||60,Number(point.positionAccuracy)||0);}
    return {grid:grid,assertSame:assertSame,spacing:spacing,pointRadius:pointRadius};
});
