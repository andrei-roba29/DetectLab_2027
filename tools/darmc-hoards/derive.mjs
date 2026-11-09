/**
 * Schema + mapping derivation from the operator's real DARMC capture.
 *
 * Everything here is derived from the VALUES in the file, never from a list of
 * field names typed from memory. Each derived decision carries the evidence
 * that produced it (counts, ratios, rejected alternatives) so it can be
 * reviewed before a single row is written.
 *
 * Output is a mapping object per layer that plugs straight into
 * js/apm-next/apm-hoards.js → normaliseDarmc(), i.e. one normalisation path.
 *
 * The mapping is PROPOSED, never accepted: `reviewed` stays false until a human
 * flips it in the emitted mapping file.
 */
import { LAYERS, attributeKeys, fieldMap } from './dump.mjs';

export const YEAR_MIN = -5000;
export const YEAR_MAX = 2100;

/** Discovery years, coin counts and physical measurements can never be deposit dates. */
export const FORBIDDEN_DATE = /^(?:FINDATE|FINDDATE|FINDDATE_Q|FIND_DATE|Find_year|YEAR_DISC|DISCOVERY|DISCOVERY_YEAR|COINS|COINS_MN|COINS_MX|COINS_MIN|COINS_MAX|hoardsize|preserved|weight_kg|weight_g|non_coin|Received_O|ITEM_ON|OBJECTID|FID|Shape__Area|Shape__Length)$/i;

const START_TOKEN = /(?:^|_)(?:START|START_D|ST|EARLIEST|EARLY|FROM|BEGIN|MIN|E)(?:$|_)/i;
const END_TOKEN = /(?:^|_)(?:END|END_D|EN|LATEST|LATE|TO|FINISH|MAX|L)(?:$|_)/i;
const DATEISH = /(?:DATE|PD|TPQ|YEAR|TAQ|PERIOD|CENTURY)/i;
const DISCOVERYISH = /(?:FIND|DISC|RECEIVED)/i;

const APPROX_CODE = /^(?:c|ca|ca\.|c\.|c\?|\?|~|approx|approx\.|approximately|circa|circ\.|doubtful|f|nu|probabil|possible)$/i;
const EXACT_CODE = /^(?:da|exact|precise|precis|x|y|yes|1|true|verified|v|gps)$/i;
const POSITION_FIELD = /(?:POS|ACC|Q_LAT|Q_LON|COORD|LOCAT|GEOM|PRECIS|FINDSPOT_Q)/i;
const CENTROID_FIELD = /^CENTROID$/i;

function isBlank(v) { return v == null || String(v).trim() === ''; }

/** Strict single-year parser. Ranges and "c.337?" are deliberately NOT numbers. */
export function toYear(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) && Number.isInteger(value) ? value : null;
    const s = String(value).trim();
    if (!s) return null;
    const bc = /^(\d{1,4})\s*(?:bc|bce)$/i.exec(s);
    if (bc) return -Number(bc[1]) + 1;
    const ad = /^(\d{1,4})\s*(?:ad|ce)$/i.exec(s);
    if (ad) return Number(ad[1]);
    if (!/^-?\d{1,4}$/.test(s)) return null;
    return Number(s);
}

export function fieldStats(layer, field) {
    const values = [];
    let nonNull = 0, empty = 0, years = 0;
    // Exact distinct count: uniqueness of the identifier must not depend on a cap.
    const seen = new Set();
    const sample = [];
    for (const f of layer.features) {
        const v = f.attributes ? f.attributes[field] : undefined;
        if (isBlank(v)) { empty++; continue; }
        nonNull++;
        const key = typeof v === 'number' ? String(v) : String(v).trim();
        const isNew = !seen.has(key);
        seen.add(key);
        if (isNew && sample.length < 40) sample.push(key);
        const y = toYear(v);
        if (y != null && y >= YEAR_MIN && y <= YEAR_MAX) { years++; values.push(y); }
    }
    values.sort((a, b) => a - b);
    return {
        field, nonNull, empty, total: layer.features.length,
        coverage: layer.features.length ? nonNull / layer.features.length : 0,
        distinct: seen.size, distinctValues: sample,
        yearLike: years, yearRatio: nonNull ? years / nonNull : 0,
        min: values.length ? values[0] : null,
        max: values.length ? values[values.length - 1] : null,
        median: values.length ? values[Math.floor(values.length / 2)] : null
    };
}

function pickIdField(layer, keys, stats) {
    const unique = keys.filter(k => {
        const s = stats.get(k);
        return s && s.nonNull === layer.features.length && s.distinct === layer.features.length;
    });
    if (!unique.length) return { idField: null, candidates: [], reason: 'no attribute is unique and complete' };
    const preferred = unique.find(k => /^(OBJECTID|FID|GLOBALID)$/i.test(k));
    const ordered = preferred ? [preferred, ...unique.filter(k => k !== preferred)] : unique;
    return { idField: ordered[0], candidates: ordered, reason: preferred ? 'service object id, unique and complete' : 'unique and complete attribute' };
}

function pickNameField(keys, stats, idField) {
    const scored = keys
        .filter(k => k !== idField && !/_Q$|_ID$|^OBJECTID$|VERIFIED|^Q_/i.test(k))
        // A year, an identifier or a coordinate is not a name.
        .filter(k => stats.get(k) && stats.get(k).yearRatio < 0.5 && !/(?:^|_)(?:LAT|LON|LATITUDE|LONGITUDE|DEC_LAT|DEC_LONG|X|Y)(?:$|_)/i.test(k))
        .map(k => {
            const s = stats.get(k);
            const token = /(?:^|_)(?:NAME|PLACE|SITE|FINDSPOT|KNOWN|TITLE|LOCALITY|TOPONYM)/i.test(k) ? 0.15 : 0;
            const plain = /\d/.test(k) ? 0.05 : 0;
            return { field: k, coverage: s ? s.coverage : 0, score: (s ? s.coverage : 0) + token - plain, s };
        })
        .filter(c => c.coverage >= 0.4 && c.s && c.s.distinct > 1)
        .sort((a, b) => b.score - a.score || a.field.localeCompare(b.field));
    if (!scored.length) return { nameField: null, candidates: [], reason: 'no text attribute is populated for at least 40% of records' };
    return { nameField: scored[0].field, candidates: scored.slice(0, 5).map(c => ({ field: c.field, coverage: Number(c.coverage.toFixed(3)) })), reason: 'best coverage among name-like text attributes' };
}

/** Pairs a start-ish field with an end-ish field and validates them against the data. */
export function pickDatePair(layer, keys, stats) {
    const usable = keys.filter(k => {
        if (FORBIDDEN_DATE.test(k)) return false;
        const s = stats.get(k);
        return s && s.yearRatio >= 0.5 && s.coverage >= 0.25;
    });
    const starts = usable.filter(k => START_TOKEN.test(k) && !END_TOKEN.test(k));
    const ends = usable.filter(k => END_TOKEN.test(k) && !START_TOKEN.test(k));
    const prefixes = k => k.replace(/(?:^|_)(?:START|START_D|ST|EARLIEST|EARLY|FROM|BEGIN|MIN|E|END|END_D|EN|LATEST|LATE|TO|FINISH|MAX|L)(?=$|_)/i, '*');
    const candidates = [];
    for (const s of starts) {
        for (const e of ends) {
            if (s === e) continue;
            let paired = 0, ordered = 0;
            for (const f of layer.features) {
                const a = toYear(f.attributes?.[s]), b = toYear(f.attributes?.[e]);
                if (a == null || b == null) continue;
                paired++;
                if (a <= b) ordered++;
            }
            // At least two ordered pairs, and at least 10% of the layer, must agree.
            if (paired < Math.max(2, Math.ceil(layer.features.length * 0.1))) continue;
            const orderRatio = ordered / paired;
            if (orderRatio < 0.9) continue;
            const sameStem = prefixes(s) === prefixes(e);
            candidates.push({
                dateStartField: s, dateEndField: e, paired, orderedCount: ordered, orderRatio: Number(orderRatio.toFixed(3)), sameStem,
                score: orderRatio + (sameStem ? 0.5 : 0) + Math.min(paired / layer.features.length, 1)
            });
        }
    }
    candidates.sort((a, b) => b.score - a.score || a.dateStartField.localeCompare(b.dateStartField));
    if (!candidates.length) {
        // No ordered numeric pair. Report the rejected alternatives rather than guessing.
        return { dateStartField: null, dateEndField: null, candidates: [], rejected: usable.map(k => ({ field: k, yearRatio: Number(stats.get(k).yearRatio.toFixed(3)) })) };
    }
    const best = candidates[0];
    const tpq = /(?:TPQ)/i.test(best.dateEndField) || /(?:TPQ)/i.test(best.dateStartField);
    return {
        dateStartField: best.dateStartField,
        dateEndField: best.dateEndField,
        dateBasis: tpq ? 'tpq' : 'deposit',
        candidates: candidates.slice(0, 5).map(c => ({ start: c.dateStartField, end: c.dateEndField, paired: c.paired, orderedCount: c.orderedCount, ordered: c.orderRatio })),
        rejected: usable.filter(k => k !== best.dateStartField && k !== best.dateEndField).map(k => ({ field: k, yearRatio: Number(stats.get(k).yearRatio.toFixed(3)), note: DISCOVERYISH.test(k) ? 'discovery/received year' : /COUNT|COINS|SIZE|WEIGHT|ITEM/i.test(k) ? 'count/measurement' : 'no valid partner pair' }))
    };
}

/** Low-cardinality attributes that can carry a position signal. */
export function pickQualityFields(keys, stats, exclude) {
    const picked = [];
    for (const k of keys) {
        if (exclude.has(k) || FORBIDDEN_DATE.test(k)) continue;
        const s = stats.get(k);
        if (!s || s.distinct === 0) continue;
        // A year column is a date, never a position class.
        if (s.yearRatio >= 0.5) continue;
        // A *_Q suffix qualifies a DATE (circa/uncertain year), never a position.
        if (/(?:DATE|START|END|TPQ|TAQ|PD|YEAR)_?Q$/i.test(k)) continue;
        const qualityName = POSITION_FIELD.test(k) || CENTROID_FIELD.test(k) || /Q$/i.test(k) || /VERIFIED/i.test(k);
        if (!qualityName) continue;
        if (s.distinct > 12) continue;
        if (s.coverage < 0.005 && s.nonNull === 0) continue;
        picked.push(k);
    }
    // Stable order: the mapping key is JSON.stringify of the values in this order.
    return picked.sort((a, b) => (CENTROID_FIELD.test(a) ? 1 : 0) - (CENTROID_FIELD.test(b) ? 1 : 0) || a.localeCompare(b));
}

/**
 * Classify one observed value combination.
 * `proposed` reads "no field marks this position as uncertain ⇒ exact".
 * `strict` reads "nothing explicitly says exact ⇒ unknown".
 * Both are reported; the operator chooses.
 */
export function classifyCombo(combo) {
    const signals = [];
    let approx = false, exact = false;
    for (const [field, value] of Object.entries(combo)) {
        if (isBlank(value)) continue;
        const text = String(value).trim();
        if (CENTROID_FIELD.test(field)) { approx = true; signals.push(`${field}="${text}" is a centroid/region label`); continue; }
        // Only a position-bearing field can carry a position signal. VERIFIED="F" says the
        // record was checked, not that the coordinates are fuzzy.
        if (!POSITION_FIELD.test(field)) { signals.push(`${field}="${text}" is not a position signal`); continue; }
        if (APPROX_CODE.test(text)) { approx = true; signals.push(`${field}="${text}" reads as approximate/circa`); continue; }
        if (EXACT_CODE.test(text)) { exact = true; signals.push(`${field}="${text}" reads as explicit/exact`); continue; }
        signals.push(`${field}="${text}" is unrecognised; treated as no evidence`);
    }
    const proposed = approx ? 'approximate' : exact ? 'exact' : 'exact';
    const strict = approx ? 'approximate' : exact ? 'exact' : 'unknown';
    const rationale = approx
        ? 'at least one published quality field marks the position as approximate'
        : exact ? 'a published quality field marks the position explicitly'
            : 'no published field characterises the position; proposed class assumes published coordinates, strict class refuses';
    return { proposed, strict, rationale, signals };
}

export function deriveLayer(dump, id, options = {}) {
    const layer = dump.layers[id];
    if (!layer) return null;
    const keys = attributeKeys(layer);
    const stats = new Map(keys.map(k => [k, fieldStats(layer, k)]));
    const idPick = pickIdField(layer, keys, stats);
    const namePick = pickNameField(keys, stats, idPick.idField);
    const datePick = pickDatePair(layer, keys, stats);
    const qualityFields = pickQualityFields(keys, stats, new Set([idPick.idField, namePick.nameField, datePick.dateStartField, datePick.dateEndField].filter(Boolean)));

    // Every observed combination of the chosen quality fields, with counts.
    const combos = new Map();
    for (const f of qualityFields.length ? layer.features : []) {
        const combo = {};
        for (const q of qualityFields) combo[q] = f.attributes?.[q] == null ? null : f.attributes[q];
        const key = JSON.stringify(combo);
        const entry = combos.get(key) || { key, combo, count: 0 };
        entry.count++;
        combos.set(key, entry);
    }
    const positionMapping = {};
    // A layer that publishes no position-quality field gets ONE explicit, reviewable
    // layer-level default: 'approximate'. It is a decision, not a measurement, and it
    // is applied identically under both policies.
    const noPositionEvidence = qualityFields.length === 0;
    if (noPositionEvidence) {
        positionMapping['{}'] = 'approximate';
    }
    const positionCombos = [...combos.values()].map(c => {
        const cls = classifyCombo(c.combo);
        positionMapping[c.key] = cls.proposed;
        return { ...c, ...cls, strictKey: cls.strict };
    }).sort((a, b) => b.count - a.count);
    const strictMapping = Object.fromEntries(positionCombos.map(c => [c.key, c.strict]));
    if (noPositionEvidence) strictMapping['{}'] = 'approximate';
    // Kept so a supplied mapping can be re-read under either policy without
    // re-deriving anything (and without the summary claiming a policy it did not apply).
    const proposedMapping = { ...positionMapping };

    const tpqField = keys.find(k => /TPQ/i.test(k) && stats.get(k).yearRatio >= 0.5) || null;
    const type = deriveHoardType(layer, keys, stats);
    const metalField = keys.find(k => /^metal$/i.test(k)) || null;
    const countryField = keys.find(k => /^(?:COUNTRY|CTRY|NATION)$/i.test(k)) || null;

    const mapping = {
        idField: idPick.idField,
        nameField: namePick.nameField,
        dateStartField: datePick.dateStartField,
        dateEndField: datePick.dateEndField,
        dateBasis: datePick.dateBasis || null,
        yearConvention: 'ce',
        qualityFields,
        positionMapping,
        hoardType: type.hoardType,
        metalField,
        countryField,
        tpqFallbackField: tpqField && tpqField !== datePick.dateStartField && tpqField !== datePick.dateEndField ? tpqField : null,
        reviewed: false
    };
    // Importable: has an identity and a validated date pair.
    // Trainable: also has position evidence. The two are deliberately separate.
    const complete = Boolean(mapping.idField && mapping.dateStartField && mapping.dateEndField && mapping.dateBasis);
    const trainable = positionCombos.length > 0 || noPositionEvidence;
    return {
        layer: id,
        name: layer.name,
        mapping,
        complete,
        trainable,
        evidence: {
            features: layer.features.length,
            publishedCount: layer.expected,
            fields: layer.fields.length,
            attributeKeys: keys.length,
            id: idPick,
            name: namePick,
            date: datePick,
            qualityFields,
            positionCombos,
            strictMapping,
            proposedMapping,
            hoardType: type,
            tpqField,
            unusedYearLikeFields: keys.filter(k => stats.get(k).yearRatio >= 0.5 && k !== idPick.idField
                    && stats.get(k).distinct !== layer.features.length
                    && ![datePick.dateStartField, datePick.dateEndField].includes(k))
                .map(k => ({ field: k, yearRatio: Number(stats.get(k).yearRatio.toFixed(3)), coverage: Number(stats.get(k).coverage.toFixed(3)), forbidden: FORBIDDEN_DATE.test(k) }))
        },
        warnings: [
            !idPick.idField && 'no unique identifier',
            !namePick.nameField && 'no usable name field',
            !datePick.dateStartField && 'no validated ordered year pair',
            noPositionEvidence && 'no position-quality field: every row is classified approximate by an explicit layer-level default, not by evidence',
            type.needsReview && `hoard_type ${type.hoardType} proposed from field semantics`,
            tpqField && (tpqField === datePick.dateStartField || tpqField === datePick.dateEndField
                ? ('the chosen date pair includes the TPQ field ' + tpqField + '; its basis needs a decision')
                : ('rows with empty deposit dates fall back to ' + tpqField + ' and are labelled tpq (lower bound, not an interval)'))
        ].filter(Boolean)
    };
}

function deriveHoardType(layer, keys, stats) {
    const nonCoin = keys.find(k => /^non_coin$/i.test(k));
    if (nonCoin) {
        let coin = 0, other = 0;
        for (const f of layer.features) {
            const v = f.attributes?.[nonCoin];
            const s = isBlank(v) ? '' : String(v).trim().toLowerCase();
            if (['', 'keine', 'none', 'no', '0', 'nein', 'nu'].includes(s)) coin++; else other++;
        }
        return { hoardType: other > coin ? 'non-coin' : 'coin', needsReview: false, basis: `${nonCoin}: ${coin} "none" vs ${other} other` };
    }
    const coinCount = keys.find(k => /^(?:COINS|COINS_MN|COINS_MX)$/i.test(k));
    if (coinCount && stats.get(coinCount).nonNull > 0) {
        return { hoardType: 'coin', needsReview: false, basis: `${coinCount} carries coin counts` };
    }
    if (/precious|deposit|gold|silver/i.test(layer.name || '')) {
        return { hoardType: 'mixed', needsReview: true, basis: `layer name "${layer.name}" describes precious-metal deposits; not coin-only` };
    }
    return { hoardType: 'unknown', needsReview: true, basis: 'no coin/non-coin field in the capture' };
}

function normName(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function haversine(a, b) {
    const d = Math.PI / 180;
    const p = (b.lat - a.lat) * d, q = (b.lon - a.lon) * d;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(Math.sin(p / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(q / 2) ** 2)));
}

function jaccard(a, b) {
    const x = new Set(normName(a).split(' ').filter(Boolean));
    const y = new Set(normName(b).split(' ').filter(Boolean));
    if (!x.size || !y.size) return 0;
    let both = 0;
    for (const t of x) if (y.has(t)) both++;
    return both / (x.size + y.size - both);
}

/**
 * Duplicate evidence, measured on the real records:
 *  - identical coordinates inside a layer,
 *  - the same find published in two layers (same catalogue id or ~same point + name),
 *  - the distance/similarity distribution of same-name pairs, from which the
 *    thresholds are proposed instead of assumed.
 */
export function analyseDuplicateEvidence(rows, options = {}) {
    const byCoord = new Map(), byName = new Map(), byLayerId = new Map();
    let exactCoordinateGroups = 0, exactCoordinateRecords = 0;
    for (const r of rows) {
        // The coordinate key includes the layer: the same find published twice in
        // one layer is a different problem from the same find in layers 15 and 16.
        const ck = `${r.source_layer}|${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
        const list = byCoord.get(ck) || [];
        list.push(r); byCoord.set(ck, list);
        const nk = normName(r.name);
        if (nk) { const nl = byName.get(nk) || []; nl.push(r); byName.set(nk, nl); }
        const lk = `${r.source_layer}:${normName(r.name)}:${r.lat.toFixed(3)}:${r.lon.toFixed(3)}`;
        const ll = byLayerId.get(lk) || [];
        ll.push(r); byLayerId.set(lk, ll);
    }
    const coordinateGroups = [];
    for (const [key, list] of byCoord) {
        if (list.length < 2) continue;
        exactCoordinateGroups++;
        exactCoordinateRecords += list.length;
        coordinateGroups.push({ coordinate: key.split('|')[1], layer: list[0].source_layer, count: list.length, ids: list.map(r => `${r.source_layer}/${r.source_id}`) });
    }
    // Same coordinates in two different layers (e.g. the two renderings of one catalogue).
    const byPoint = new Map();
    for (const r of rows) {
        const pk = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
        const list = byPoint.get(pk) || [];
        list.push(r); byPoint.set(pk, list);
    }
    const crossLayerCoordinateGroups = [];
    for (const [point, list] of byPoint) {
        const layers = [...new Set(list.map(r => r.source_layer))].sort();
        if (layers.length < 2) continue;
        crossLayerCoordinateGroups.push({ coordinate: point, layers, count: list.length, ids: list.map(r => `${r.source_layer}/${r.source_id}`) });
    }
    const sameNamePairs = [];
    for (const [name, list] of byName) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (a.source_layer === b.source_layer && a.source_id === b.source_id) continue;
            sameNamePairs.push({
                a: `${a.source_layer}/${a.source_id}`, b: `${b.source_layer}/${b.source_id}`,
                layerA: a.source_layer, layerB: b.source_layer,
                distance_m: Math.round(haversine(a, b)), similarity: Number(jaccard(a.name, b.name).toFixed(3)), name
            });
        }
    }
    sameNamePairs.sort((x, y) => x.distance_m - y.distance_m);
    const distances = sameNamePairs.map(p => p.distance_m);
    const pct = p => (distances.length ? distances[Math.min(distances.length - 1, Math.floor(distances.length * p))] : null);
    const crossLayer = {};
    for (const p of sameNamePairs) {
        if (p.layerA === p.layerB) continue;
        const key = `${Math.min(p.layerA, p.layerB)}<->${Math.max(p.layerA, p.layerB)}`;
        crossLayer[key] = (crossLayer[key] || 0) + 1;
    }
    const pairCounts = id => sameNamePairs.filter(p => p.layerA === p.layerB && p.layerA === id).length;
    const withinLayer = Object.fromEntries(LAYERS.map(id => [id, pairCounts(id)]));
    const p99 = pct(0.99);
    const proposedDistance = p99 == null ? (options.defaultDistanceM ?? 1000)
        : Math.min(5000, Math.max(250, Math.ceil((p99 * 1.2) / 50) * 50));
    const proposedSimilarity = sameNamePairs.length
        ? Math.max(0.5, Math.min(...sameNamePairs.filter(p => p.distance_m <= proposedDistance).map(p => p.similarity), 0.95))
        : (options.defaultSimilarity ?? 0.7);
    return {
        exactCoordinateGroups, exactCoordinateRecords, coordinateGroups: coordinateGroups.sort((a, b) => b.count - a.count).slice(0, 50),
        crossLayerCoordinateGroups,
        sameNamePairs: sameNamePairs.filter(p => p.distance_m <= 5000),
        sameNamePairCount: sameNamePairs.length,
        distancePercentiles: { p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), p99 },
        thresholds: {
            exact: sameNamePairs.filter(p => p.distance_m === 0).length,
            within100m: sameNamePairs.filter(p => p.distance_m <= 100).length,
            within1km: sameNamePairs.filter(p => p.distance_m <= 1000).length,
            within5km: sameNamePairs.filter(p => p.distance_m <= 5000).length
        },
        crossLayerPairs: crossLayer,
        withinLayerPairs: withinLayer,
        proposal: { distanceM: proposedDistance, nameSimilarity: Number(proposedSimilarity.toFixed(2)), basis: 'p99 of same-name pair distances ×1.2, rounded to 50 m, clamped to 250–5000 m' }
    };
}

export function deriveAll(dump, options = {}) {
    const layers = {};
    const warnings = [...dump.warnings];
    for (const id of LAYERS) {
        if (!options.only || options.only.includes(id)) {
            const result = deriveLayer(dump, id, options);
            if (result) { layers[id] = result; warnings.push(...result.warnings.map(w => `Layer ${id}: ${w}`)); }
        }
    }
    return { layers, warnings };
}
