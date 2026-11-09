/**
 * Trimmed fixtures built FROM the operator's capture — not retyped records.
 *
 * Selection is deterministic and stress-first: every distinct position-quality
 * combination, blank/reversed dates, the coordinate extremes, non-ASCII names,
 * exact-coordinate duplicate groups, then evenly spaced fill.
 */
import { LAYERS } from './dump.mjs';

function isBlank(v) { return v == null || String(v).trim() === ''; }

function signature(feature, mapping) {
    const combo = {};
    for (const q of mapping?.qualityFields || []) combo[q] = feature.attributes?.[q] == null ? null : feature.attributes[q];
    return JSON.stringify(combo);
}

export function selectFeatures(features, mapping, perLayer = 12) {
    const picks = new Map();
    const add = (f, why) => {
        const key = JSON.stringify(f);
        if (picks.has(key)) { picks.get(key).why.add(why); return; }
        picks.set(key, { feature: f, why: new Set([why]) });
    };
    if (!features.length) return [];

    add(features[0], 'first-record');

    // One record per distinct quality combination, most common first.
    if (mapping) {
        const groups = new Map();
        for (const f of features) {
            const key = signature(f, mapping);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(f);
        }
        for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
            add(list[0], `quality-combination ${key}`);
        }
    }

    const year = (f, field) => {
        if (!field) return null;
        const v = f.attributes?.[field];
        if (v == null || String(v).trim() === '') return null;
        const n = Number(String(v).trim());
        return Number.isInteger(n) ? n : null;
    };
    const noDates = features.find(f => mapping && (year(f, mapping.dateStartField) == null || year(f, mapping.dateEndField) == null));
    if (noDates) add(noDates, 'blank-deposit-date');
    const reversed = features.find(f => mapping && (() => {
        const a = year(f, mapping.dateStartField), b = year(f, mapping.dateEndField);
        return a != null && b != null && a > b;
    })());
    if (reversed) add(reversed, 'reversed-deposit-dates');

    const nonAscii = features.find(f => mapping?.nameField && /[^\x00-\x7F]/.test(String(f.attributes?.[mapping.nameField] ?? '')));
    if (nonAscii) add(nonAscii, 'non-ascii-name');

    const minLat = features.reduce((m, f) => (Number(f.geometry?.y) < Number(m.geometry?.y) ? f : m), features[0]);
    const maxLat = features.reduce((m, f) => (Number(f.geometry?.y) > Number(m.geometry?.y) ? f : m), features[0]);
    add(minLat, 'southernmost'); add(maxLat, 'northernmost');

    const coords = new Map();
    for (const f of features) {
        const key = `${Number(f.geometry?.x).toFixed(5)},${Number(f.geometry?.y).toFixed(5)}`;
        const list = coords.get(key) || [];
        list.push(f); coords.set(key, list);
    }
    const duplicateGroup = [...coords.values()].find(l => l.length > 1);
    if (duplicateGroup) duplicateGroup.forEach((f, i) => add(f, `exact-coordinate-group#${i + 1}`));

    const step = Math.max(1, Math.floor(features.length / Math.max(1, perLayer)));
    for (let i = 0; i < features.length && picks.size < perLayer; i += step) add(features[i], 'even-spacing');
    for (let i = 0; i < features.length && picks.size < perLayer; i++) add(features[i], 'fill');

    return [...picks.values()].slice(0, perLayer);
}

/** Build a capture-shaped fixture file per layer from the real capture. */
export function trimCapture(dump, derived, options = {}) {
    const perLayer = options.perLayer || 12;
    const layers = {};
    const manifest = { builtFrom: dump.source, fetchedAt: dump.fetchedAt, outSR: dump.outSR, perLayer, layers: {} };
    for (const id of LAYERS) {
        const layer = dump.layers[id];
        if (!layer) continue;
        const mapping = derived.layers[id]?.mapping;
        const selected = selectFeatures(layer.features, mapping, perLayer);
        layers[id] = {
            name: layer.name,
            // The fixture's own count, so the loader's count check stays meaningful.
            expected: selected.length,
            sourceExpected: layer.expected,
            fields: layer.fields,
            features: selected.map(s => s.feature)
        };
        manifest.layers[id] = {
            sourceFeatures: layer.features.length,
            kept: selected.length,
            reasons: selected.flatMap(s => [...s.why])
        };
    }
    return { capture: { source: dump.source, fetchedAt: dump.fetchedAt, outSR: dump.outSR, layers }, manifest };
}
