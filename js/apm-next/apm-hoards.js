/* Pure hoard classification/normalisation. Source schemas are reviewed configuration, never guessed. */
(function(root, factory) {
    var api = factory(typeof module === 'object' && module.exports ? require('./hoards.config.js') : root.DetectLabHoardConfig);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabApmHoards = api;
})(typeof self !== 'undefined' ? self : this, function(config) {
    'use strict';
    function normalise(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    function descriptivePart(name) {
        var text = normalise(name).replace(/\bla\s+tene\b/g, 'latene');
        // A dash followed by La <place> is a place delimiter too (Voivodeni - La comoara).
        var at = text.search(/\s+(?:de la|din|la)\s+/);
        return { text: at < 0 ? text : text.slice(0, at).replace(/\s*-\s*$/, ''), place: at < 0 ? '' : text.slice(at) };
    }
    function hasTerm(s) { return /(?:^|[^a-z])(?:tezaur[a-z]*|depozit[a-z]*|comoar[a-z]*)(?=$|[^a-z])/.test(s); }
    function classifyRomanian(name) {
        var part = descriptivePart(name), term = hasTerm(part.text);
        var settlement = /(?:^|[^a-z])(?:siliste[a-z]*|asezar[a-z]*|fortificati[a-z]*|cetate[a-z]*|turnul[a-z]*|castru[a-z]*|villa[a-z]*)(?=$|[^a-z])/.test(part.text);
        var base = term ? (settlement ? 'mixed' : 'hoard-only') : 'not-a-find';
        var uncertain = term && (/\?/.test(String(name)) || /\bposibil[a-z]*\b/.test(normalise(name)));
        return { bucket: uncertain ? 'uncertain' : base, baseBucket: base, term: term, settlement: settlement, descriptive: part.text };
    }
    function periodsRomanian(name, rules) {
        var text = descriptivePart(name).text, out = [];
        (rules || config.romanianPeriods).forEach(function(rule) {
            var matched = false;
            rule.patterns.forEach(function(pattern) {
                var re = new RegExp('(^|[^a-z0-9])(' + pattern + ')(?=$|[^a-z0-9])', 'g');
                text = text.replace(re, function(_, before) { matched = true; return before + ' '; });
            });
            if (matched) out.push({ key: rule.key, label: rule.label, start: rule.start, end: rule.end, source: rule.source });
        });
        return out;
    }
    function position(raw, mapping) {
        return Object.prototype.hasOwnProperty.call(mapping || {}, raw) ? mapping[raw] : 'unknown';
    }
    function year(value, convention) {
        if (value == null || String(value).trim() === '') return null;
        var s = String(value).trim(), bc = /\s*(bc|bce)$/i.test(s);
        if (bc) { var n = Number(s.replace(/\s*(bc|bce)$/i, '')); return Number.isInteger(n) && n > 0 ? 1 - n : null; }
        if (!/^-?\d+$/.test(s)) return null;
        var y = Number(s);
        if (!Number.isSafeInteger(y)) return null;
        return convention === 'historical' && y < 0 ? y + 1 : y;
    }
    function groupsFor(start, end) {
        if (start == null || end == null) return [];
        return config.periodGroups.filter(function(g) { return start <= g.end && end >= g.start; }).map(function(g) { return g.key; });
    }
    function normaliseDarmc(feature, layer, mapping) {
        if (!mapping || mapping.reviewed !== true) return { dropped: 'unreviewed-layer-schema' };
        var a = feature.attributes || feature.properties || {}, g = feature.geometry || {};
        var lon = Number(g.x == null ? (g.coordinates || [])[0] : g.x), lat = Number(g.y == null ? (g.coordinates || [])[1] : g.y);
        if ((g.type && g.type !== 'Point') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { dropped: 'invalid-point-geometry' };
        if (a[mapping.idField] == null || String(a[mapping.idField]).trim() === '') return { dropped: 'missing-source-id' };
        // Find/discovery years and coin counts are explicitly forbidden date inputs.
        var forbidden = /^(?:FINDDATE|FINDDATE_Q|Find_year|YEAR_DISC|COINS(?:_.*)?|hoardsize|preserved)$/i;
        if (![mapping.dateStartField,mapping.dateEndField].every(function(f) { return f && !forbidden.test(f) && Object.prototype.hasOwnProperty.call(a,f); })) return { dropped: 'unverified-or-forbidden-date-fields' };
        if (['deposit','tpq'].indexOf(mapping.dateBasis) < 0) return { dropped: 'invalid-date-basis' };
        var start = year(a[mapping.dateStartField],mapping.yearConvention), end = year(a[mapping.dateEndField],mapping.yearConvention);
        if (start != null && end != null && start > end) return { dropped: 'reversed-deposit-dates' };
        var q = {}; (mapping.qualityFields || []).forEach(function(f) { q[f] = a[f] == null ? null : a[f]; });
        var rawKey = JSON.stringify(q), cls = position(rawKey,mapping.positionMapping);
        if ((mapping.centroidValues || []).indexOf(a.CENTROID) >= 0) cls = 'approximate';
        if (['exact','approximate','unknown'].indexOf(cls) < 0) return { dropped: 'invalid-position-mapping' };
        return { row: { source:'darmc', source_layer:Number(layer), source_id:String(a[mapping.idField]), name:String(a[mapping.nameField] || ''), lat:lat,lon:lon,
            position_class:cls, position_quality_raw:q, position_accuracy_m:config.accuracyM[cls], period_group:groupsFor(start,end)[0] || 'unknown', period_groups:groupsFor(start,end), periods:[], multiple_periods:false,
            deposit_start_year:start,deposit_end_year:end,date_basis:mapping.dateBasis, hoard_type:mapping.hoardType || 'unknown',
            metal:a[mapping.metalField] == null ? null : String(a[mapping.metalField]),country:a[mapping.countryField] == null ? null : String(a[mapping.countryField]),
            bucket:'hoard-only',duplicate_of:null,raw:feature } };
    }
    function deriveRomanian(input) {
        var a = input.attributes || {}, name = a.NUMESIT || input.name || '', c = classifyRomanian(name);
        if (c.bucket === 'not-a-find') return { dropped:'not-a-find', classification:c };
        var periods = periodsRomanian(name), g = input.geometry || {}, lon = Number(input.lon == null ? g.x : input.lon),lat = Number(input.lat == null ? g.y : input.lat);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return { dropped:'invalid-point-geometry' };
        var flag = String(a.COORD || input.coord_flag || '').trim().toUpperCase(), cls = position(flag,config.ranPosition);
        return { row: { source:'ran',source_layer:Number(input.layer_id),source_id:String(input.object_id), name:name,lat:lat,lon:lon,position_class:cls,
            position_quality_raw:{COORD:flag},position_accuracy_m:config.accuracyM[cls], period_group:periods.length === 1 ? periods[0].key : periods.length ? 'multiple' : 'unknown',
            period_groups:periods.map(function(p){return p.key;}), periods:periods,multiple_periods:periods.length>1,
            // No guessed interval across disjoint name-derived periods. The list is authoritative.
            deposit_start_year:periods.length === 1 ? periods[0].start : null,deposit_end_year:periods.length === 1 ? periods[0].end : null,
            date_basis:'name-keyword',hoard_type:'unknown',metal:null,country:'RO',bucket:c.bucket,duplicate_of:null,raw:input } };
    }
    function distanceM(a,b) {
        var d=Math.PI/180, p=(b.lat-a.lat)*d,q=(b.lon-a.lon)*d;
        return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(p/2)**2+Math.cos(a.lat*d)*Math.cos(b.lat*d)*Math.sin(q/2)**2)));
    }
    function similarity(a,b) {
        var x=new Set(normalise(a).split(/[^a-z0-9]+/).filter(Boolean)),y=new Set(normalise(b).split(/[^a-z0-9]+/).filter(Boolean));
        if(!x.size||!y.size)return 0;
        var both=0;x.forEach(function(t){if(y.has(t))both++;});return both/(x.size+y.size-both);
    }
    function markDuplicates(rows, options) {
        options=Object.assign({},config.duplicate,options||{});
        var kept=[], pairs=[];
        // Stable preferred record, independent of input order. Preserve all source rows.
        rows.slice().sort(function(a,b){var rank={exact:0,approximate:1,unknown:2};return (rank[a.position_class] == null ? 2 : rank[a.position_class]) - (rank[b.position_class] == null ? 2 : rank[b.position_class]) || Number(a.source_layer || 0)-Number(b.source_layer || 0) || String(a.id).localeCompare(String(b.id));}).forEach(function(r){
            r.duplicate_of=null;
            var match=kept.find(function(q){return r.deposit_start_year!=null&&r.deposit_end_year!=null&&q.deposit_start_year!=null&&q.deposit_end_year!=null&&
                r.deposit_start_year<=q.deposit_end_year&&r.deposit_end_year>=q.deposit_start_year&&distanceM(r,q)<=options.distanceM&&similarity(r.name,q.name)>=options.nameSimilarity;});
            if(match){r.duplicate_of=match.id;pairs.push({id:r.id,duplicate_of:match.id,distance_m:distanceM(r,match)});}else kept.push(r);
        });return pairs;
    }
    function ready() { return Object.keys(config.release).every(function(k){return config.release[k] === true;}); }
    return { normalise:normalise,descriptivePart:descriptivePart,classifyRomanian:classifyRomanian,periodsRomanian:periodsRomanian,position:position,year:year,
        groupsFor:groupsFor,normaliseDarmc:normaliseDarmc,deriveRomanian:deriveRomanian,distanceM:distanceM,similarity:similarity,markDuplicates:markDuplicates,ready:ready };
});
