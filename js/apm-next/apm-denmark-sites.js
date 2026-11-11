/*!
 * DetectLab — Next-Gen APM · Danish site source for TRAIN.
 *
 * Denmark has no national repertory wired into this app, but it does have one
 * authoritative, CC0 register: **Fund og Fortidsminder** (Slots- og
 * Kulturstyrelsen), published as a public WFS. This module turns that register
 * into the two TRAIN positive classes the panel offers:
 *
 *   settlements  `anlaegstype` = habitation evidence (cultural layer, pit,
 *                hearth, post hole) — the register has no "Bebyggelse" value in
 *                this field, so the settlement class is the register's own
 *                habitation vocabulary, matched by CQL wildcards and reported
 *                type-by-type so nothing is hidden.
 *   hoards       `anlaegstype` = `Depotfund` (deposited objects, not coins only)
 *                or `Møntfund` (coin finds). `Enkeltfund` (a single find) is NOT
 *                a hoard and is never included.
 *
 * Everything below was verified against the live service on 2026-11-11:
 *   · WFS 2.0.0 + `outputFormat=application/json` + `srsName=EPSG:4326`;
 *   · `bbox=W,S,E,N,EPSG:4326` (lon,lat order) returns features in lon/lat;
 *   · `count` caps the answer and `CQL_FILTER` is accepted, ILIKE included;
 *   · the fields are `anlaegstype`, `datering`, `frednr`, `stednr`, `url`.
 * Nationwide counts on that date: Kulturlag 3 004, *grube* 10 045, Ildsted 466,
 * *stolpehul* 366, Depotfund 1 117, Møntfund 2 193, Enkeltfund 44 210.
 *
 * Design rules kept from the rest of APM Next-Gen:
 *   · one training point per **locality** (`stednr`), not per feature: a
 *     settlement that produced 40 pits is one settlement;
 *   · a source that fails contributes nothing AND says so (`_meta.sources`);
 *   · dates come only from the register's own `datering` text, mapped through a
 *     reviewed, editable table — never invented per record;
 *   · the register is queried per training window with a hard feature cap; the
 *     full dataset stays the official dump's job.
 */
(function (root, factory) {
    var node = typeof module === 'object' && module.exports;
    var api = factory(node ? require('./apm-sites.js') : root.DetectLabApmSites);
    if (node) module.exports = api; else root.DetectLabApmDenmarkSites = api;
})(typeof self !== 'undefined' ? self : this, function (sites) {
    'use strict';

    var CONFIG = {
        wfs: 'https://www.kulturarv.dk/ffgeoserver/public/wfs',
        version: '2.0.0',
        srsName: 'EPSG:4326',
        /* Same box as js/archeo-dk-source.js and the map's Danish catalogue. */
        bounds: [[54.3, 7.5], [58.0, 16.0]],
        /* The register publishes a position per feature but no error estimate.
         * 50 m is the working value the app already uses for published points;
         * it is never presented as measured accuracy. */
        positionAccuracyM: 50,
        /* Habitation evidence. Wildcards, not an exhaustive value list: the
         * register's vocabulary is large and grows, and a listed typo would
         * silently return nothing. Each filter is counted and named. */
        settlementFilters: [
            { key: 'kulturlag', cql: "anlaegstype ILIKE '%kulturlag%'", label: 'Kulturlag' },
            { key: 'grube', cql: "anlaegstype ILIKE '%grube%'", label: 'Grube' },
            { key: 'ildsted', cql: "anlaegstype ILIKE '%ildsted%'", label: 'Ildsted' },
            { key: 'stolpehul', cql: "anlaegstype ILIKE '%stolpehul%'", label: 'Stolpehul' }
        ],
        /* Deposited valuables. `Enkeltfund` is a single find, deliberately absent. */
        hoardFilters: [
            { key: 'depotfund', cql: "anlaegstype ILIKE '%depotfund%'", label: 'Depotfund', hoardType: 'Depotfund' },
            { key: 'moentfund', cql: "anlaegstype ILIKE '%mønt%'", label: 'Møntfund', hoardType: 'Møntfund' }
        ],
        /* Both point layers carry the same schema; protected monuments are mostly
         * burial mounds but a cultural layer can be scheduled too. */
        pointLayers: [
            'public:fundogfortidsminder_punkt_fredet',
            'public:fundogfortidsminder_punkt_ikkefredet'
        ],
        maxFeaturesPerRequest: 2000,
        maxPerCategory: 4000,
        requestTimeoutMs: 25000,
        /* Conventional Danish period boundaries — broad envelopes for filtering,
         * not excavated dates. Matched against the register's own `datering`
         * text; anything unrecognised stays undated instead of being guessed. */
        danishPeriods: [
            // Most specific first: the first pattern that hits decides the era.
            { key: 'foerromersk', label: 'Førromersk jernalder', start: -500, end: 1, patterns: ['førromersk', 'foerromersk', 'forromersk'] },
            { key: 'romersk', label: 'Romersk jernalder', start: 1, end: 400, patterns: ['romersk'] },
            { key: 'germansk', label: 'Germansk jernalder', start: 400, end: 800, patterns: ['germansk'] },
            { key: 'jernalder', label: 'Jernalder', start: -500, end: 800, patterns: ['jernalder'] },
            { key: 'vikingetid', label: 'Vikingetid', start: 793, end: 1066, patterns: ['vikingetid', 'viking'] },
            { key: 'middelalder', label: 'Middelalder', start: 1066, end: 1536, patterns: ['middelalder'] },
            { key: 'bronzealder', label: 'Bronzealder', start: -1700, end: -500, patterns: ['bronzealder'] },
            { key: 'stenalder', label: 'Stenalder', start: -10000, end: -1700, patterns: ['stenalder'] },
            { key: 'nyere', label: 'Nyere tid', start: 1536, end: 2000, patterns: ['nyere tid', 'historisk tid'] },
            { key: 'oldtid', label: 'Oldtid (broad)', start: -10000, end: 1066, patterns: ['oldtid'] }
        ],
        undatedLabels: ['udateret', 'ukendt', ''],
        attribution: 'Fund og Fortidsminder © Slots- og Kulturstyrelsen (CC0 1.0)'
    };

    function normalise(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function insideDenmark(lat, lon) {
        var b = CONFIG.bounds;
        return Number(lat) >= b[0][0] && Number(lat) <= b[1][0] &&
            Number(lon) >= b[0][1] && Number(lon) <= b[1][1];
    }

    /* ── dating ─────────────────────────────────────────────────────────────
     * The register's `datering` is free text and names one era ("Jernalder",
     * "Romersk jernalder", "Oldtid"). The first pattern that hits decides, in the
     * table's specific-to-general order, so "Germansk jernalder" is a phase and not
     * also plain "Jernalder", and "Oldtid" is only the fallback. Anything
     * unrecognised stays undated instead of becoming a date. */
    function periodsFor(datering) {
        var text = normalise(datering);
        if (!text) return [];
        for (var i = 0; i < CONFIG.danishPeriods.length; i++) {
            var rule = CONFIG.danishPeriods[i];
            var hit = rule.patterns.some(function (p) { return text.indexOf(normalise(p)) !== -1; });
            if (hit) {
                return [{ key: rule.key, label: rule.label, start: rule.start, end: rule.end, uri: null }];
            }
        }
        return [];
    }

    /** The register's anlaegstype decides the hoard class, not the query that found it. */
    function hoardTypeFor(registerType) {
        var t = normalise(registerType);
        if (t.indexOf('mønt') !== -1 || t.indexOf('mont') !== -1) return 'Møntfund';
        if (t.indexOf('depot') !== -1) return 'Depotfund';
        return 'unknown';
    }

    function periodGroupsFor(periods) {
        return periods.map(function (p) { return p.key; });
    }

    /* ── WFS ─────────────────────────────────────────────────────────────── */

    function bboxFor(centre, radiusKm) {
        var radiusM = Math.max(1000, (radiusKm || 50) * 1000);
        var dLat = radiusM / 111320;
        var dLon = dLat / Math.max(0.05, Math.cos(centre.lat * Math.PI / 180));
        return [centre.lon - dLon, centre.lat - dLat, centre.lon + dLon, centre.lat + dLat];
    }

    function featureUrl(layer, bbox, cql, count) {
        // encodeURIComponent keeps 'ø' as UTF-8 percent escapes, which the
        // service accepted on 2026-11-11 (a Møntfund filter answered 2 193).
        return CONFIG.wfs + '?service=WFS&version=' + CONFIG.version + '&request=GetFeature' +
            '&typeNames=' + encodeURIComponent(layer) +
            '&outputFormat=application/json&srsName=' + CONFIG.srsName +
            '&bbox=' + bbox.map(function (v) { return v.toFixed(6); }).join(',') + ',' + CONFIG.srsName +
            '&count=' + Math.max(1, count) +
            '&CQL_FILTER=' + encodeURIComponent(cql);
    }

    function fetchJson(url, options) {
        options = options || {};
        var doFetch = options.fetch || (typeof fetch === 'function' ? fetch : null);
        if (!doFetch) return Promise.reject(new Error('fetch unavailable'));
        var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, options.timeoutMs || CONFIG.requestTimeoutMs);
        var init = { method: 'GET', headers: { Accept: 'application/json' } };
        if (ctrl) init.signal = ctrl.signal;
        if (options.signal) init.signal = options.signal;      // caller cancellation wins
        return doFetch(url, init).then(function (res) {
            clearTimeout(timer);
            if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '?'));
            return res.json();
        }, function (error) {
            clearTimeout(timer);
            throw error;
        });
    }

    /* ── records ─────────────────────────────────────────────────────────── */

    function featurePoint(feature) {
        var g = feature && feature.geometry;
        if (!g) return null;
        if (g.type === 'Point') return { lat: g.coordinates[1], lon: g.coordinates[0] };
        if (g.type === 'MultiPoint') return { lat: g.coordinates[0][1], lon: g.coordinates[0][0] };
        if (g.type === 'Polygon') {
            var ring = g.coordinates[0] || [];
            if (!ring.length) return null;
            var sx = 0, sy = 0;
            ring.forEach(function (p) { sx += p[0]; sy += p[1]; });
            return { lat: sy / ring.length, lon: sx / ring.length };
        }
        return null;
    }

    function localityKey(props, point) {
        var stednr = props && props.stednr != null ? String(props.stednr) : '';
        if (stednr) return 'lokalitet:' + stednr;
        return 'point:' + Number(point.lat).toFixed(5) + ',' + Number(point.lon).toFixed(5);
    }

    /* One record per locality. Several features of the same `stednr` are one
     * place: their types are listed, their count is kept, and the first position
     * is used (they are within metres of each other by construction). */
    function toRecords(features, category, filterLabel) {
        var byKey = Object.create(null);
        var order = [];
        var rejected = { geometry: 0, undated: 0, duplicate: 0 };
        features.forEach(function (feature) {
            var props = (feature && feature.properties) || {};
            var point = featurePoint(feature);
            if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) { rejected.geometry++; return; }
            var key = localityKey(props, point);
            var type = String(props.anlaegstype || filterLabel || '').trim();
            var periods = periodsFor(props.datering);
            var existing = byKey[key];
            if (existing) {
                rejected.duplicate++;
                existing.featureCount += 1;
                if (type && existing.featureTypes.indexOf(type) < 0) existing.featureTypes.push(type);
                existing.periods.forEach(function (p) {
                    if (!existing.periodGroups2.some(function (q) { return q.key === p.key; })) existing.periodGroups2.push(p);
                });
                if (!existing.url && props.url) existing.url = props.url;
                return;
            }
            var record = {
                id: 'dk:' + key,
                name: type ? (type + ' · lokalitet ' + (props.stednr || '')) : ('Lokalitet ' + (props.stednr || '')),
                lat: point.lat,
                lon: point.lon,
                type: category === 'hoards' ? 'hoard' : 'settlement',
                source: 'fund-og-fortidsminder',
                country: 'DK',
                positionAccuracy: CONFIG.positionAccuracyM,
                approximatePosition: false,
                positionAccepted: true,
                stednr: props.stednr == null ? null : String(props.stednr),
                frednr: props.frednr == null ? null : String(props.frednr),
                url: props.url || null,
                registerType: type || null,
                featureTypes: type ? [type] : [],
                featureCount: 1,
                periods: periods,
                periodGroups2: periods.slice(),
                periodLabel: periods.length ? periods[0].label : 'undated',
                periodStart: periods.length === 1 ? periods[0].start : null,
                periodEnd: periods.length === 1 ? periods[0].end : null,
                periodSource: periods.length ? 'register-datering' : 'unknown',
                dateBasis: 'register-datering',
                hoardType: category === 'hoards' ? hoardTypeFor(type || filterLabel) : null,
                dating: props.datering || null
            };
            record.periodGroups = periodGroupsFor(record.periodGroups2);
            byKey[key] = record;
            order.push(key);
        });
        var records = order.map(function (k) {
            var r = byKey[k];
            r.periodGroups = periodGroupsFor(r.periodGroups2);
            delete r.periodGroups2;
            return r;
        });
        records._rejected = rejected;
        return records;
    }

    /* ── providers ───────────────────────────────────────────────────────── */

    function createProvider(options) {
        options = options || {};
        var config = Object.assign({}, CONFIG, options.config || {});

        async function queryCategory(filters, category, centre, radiusKm, opts) {
            var bbox = bboxFor(centre, radiusKm);
            var stats = { ok: false, requests: 0, features: 0, records: 0, truncated: 0, failed: 0, byFilter: {} };
            var features = [];
            var errors = [];
            for (var i = 0; i < filters.length; i++) {
                var filter = filters[i];
                for (var l = 0; l < config.pointLayers.length; l++) {
                    if (opts.signal && opts.signal.aborted) break;
                    var layer = config.pointLayers[l];
                    var url = featureUrl(layer, bbox, filter.cql, config.maxFeaturesPerRequest);
                    stats.requests += 1;
                    try {
                        var json = await fetchJson(url, { fetch: options.fetch, signal: opts.signal, timeoutMs: config.requestTimeoutMs });
                        var list = (json && json.features) || [];
                        stats.features += list.length;
                        if (json && (json.exceededTransferLimit || json.truncated) ||
                            list.length >= config.maxFeaturesPerRequest) stats.truncated += 1;
                        stats.byFilter[filter.key] = (stats.byFilter[filter.key] || 0) + list.length;
                        list.forEach(function (f) { features.push({ feature: f, filter: filter }); });
                        stats.ok = true;
                    } catch (error) {
                        stats.failed += 1;
                        errors.push(filter.key + ': ' + String(error && error.message || error));
                    }
                }
            }
            // Overlapping wildcards repeat a feature (a 'grube' can be an
            // 'affaldsgrube' only once, but the same locality may match twice).
            var trimmed = features.slice(0, config.maxPerCategory);
            var droppedOverBudget = Math.max(0, features.length - trimmed.length);
            var records = toRecords(trimmed.map(function (x) { return x.feature; }), category,
                trimmed.length ? trimmed[0].filter.label : null);
            // toRecords already typed each record from its own anlaegstype; the
            // filter label is only a fallback for a feature without one.
            if (category === 'hoards') {
                records.forEach(function (r) { r.hoardType = hoardTypeFor(r.registerType); });
            }
            stats.records = records.length;
            stats.droppedOverBudget = droppedOverBudget;
            stats.rejected = records._rejected;
            stats.errors = errors;
            delete records._rejected;
            return { records: records, stats: stats };
        }

        function metaFor(category, stats, records, extra) {
            var meta = {
                category: category === 'hoards' ? 'hoards' : 'denmark-heritage',
                region: 'denmark',
                outsideRomania: false,
                provider: 'Fund og Fortidsminder',
                attribution: config.attribution,
                sources: { register: stats },
                returned: records.length,
                truncated: stats.truncated > 0,
                failed: stats.failed,
                incomplete: stats.failed > 0 && !stats.ok,
                periodSource: 'register-datering',
                offerCsv: false,
                insufficient: false
            };
            return Object.assign(meta, extra || {});
        }

        function periodCounts(records) {
            var counts = {};
            records.forEach(function (r) {
                (r.periodGroups || []).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
            });
            return counts;
        }

        return {
            id: 'denmark-heritage',
            label: 'Fund og Fortidsminder',
            source: 'fund-og-fortidsminder',
            config: config,
            getSites: async function (centre, radiusKm, opts) {
                opts = opts || {};
                if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) {
                    throw new Error('Invalid coordinates');
                }
                if (!insideDenmark(centre.lat, centre.lon)) {
                    var none = [];
                    none._meta = { outsideRomania: false, region: 'outside-denmark',
                        message: 'The Danish register answers only inside Denmark.' };
                    return none;
                }
                var out = await queryCategory(config.settlementFilters, 'settlements', centre, radiusKm, opts);
                var records = out.records;
                records._meta = metaFor('settlements', out.stats, records, {
                    featureCount: out.stats.features,
                    featureTypes: Object.assign({}, out.stats.byFilter),
                    returned: records.length
                });
                return records;
            },
            /* The hoard class uses the same register and the same window; the panel
             * asks for it when the TRAIN category is `hoards`. */
            getHoards: async function (centre, radiusKm, opts) {
                opts = opts || {};
                if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) {
                    throw new Error('Invalid coordinates');
                }
                if (!insideDenmark(centre.lat, centre.lon)) {
                    var none = [];
                    none._meta = { outsideRomania: false, region: 'outside-denmark',
                        message: 'The Danish register answers only inside Denmark.' };
                    return none;
                }
                var out = await queryCategory(config.hoardFilters, 'hoards', centre, radiusKm, opts);
                var records = out.records;
                var counts = periodCounts(records);
                records._meta = metaFor('hoards', out.stats, records, {
                    featureCount: out.stats.features,
                    featureTypes: Object.assign({}, out.stats.byFilter),
                    period_counts: counts,
                    // renderSiteCount() reads `usable` when `insufficient` is set; a
                    // missing number would print an empty count and block the run.
                    usable: records.length,
                    insufficient: records.length < 10
                });
                return records;
            }
        };
    }

    return {
        CONFIG: CONFIG,
        insideDenmark: insideDenmark,
        bboxFor: bboxFor,
        featureUrl: featureUrl,
        periodsFor: periodsFor,
        toRecords: toRecords,
        createProvider: createProvider
    };
});
