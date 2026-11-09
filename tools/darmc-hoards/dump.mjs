/**
 * Loader + validator for the operator's DARMC browser capture.
 *
 * Expected shape (one file, all seven layers):
 *   { source, fetchedAt, outSR: 4326,
 *     layers: { "<layerId>": { name, expected, fields:[{name,type,alias}],
 *                              features:[{ attributes, geometry:{x,y} }] } } }
 *
 * Nothing here fetches anything. The file is the source of truth.
 * The loader never repairs data: it reports, and refuses a structurally
 * unusable layer rather than silently importing a partial picture.
 */
import crypto from 'node:crypto';

export const LAYERS = [8, 9, 10, 11, 12, 15, 16];

export class DumpError extends Error {
    constructor(code, message) { super(message); this.code = code; this.name = 'DumpError'; }
}

function isObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

/** Parse a JSON string (or accept an already-parsed object). */
export function parseDump(input) {
    if (typeof input === 'string') {
        try { input = JSON.parse(input); }
        catch (e) { throw new DumpError('not-json', `Capture is not valid JSON: ${e.message}`); }
    }
    return normaliseDump(input);
}

export function normaliseDump(raw) {
    if (!isObject(raw)) throw new DumpError('not-a-dump', 'Capture must be a JSON object');
    if (!isObject(raw.layers)) throw new DumpError('not-a-dump', 'Capture has no "layers" object');
    const out = {
        source: typeof raw.source === 'string' ? raw.source : null,
        fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null,
        outSR: raw.outSR == null ? null : Number(raw.outSR),
        layers: {},
        warnings: []
    };
    if (out.outSR !== 4326) {
        out.warnings.push(`outSR is ${raw.outSR == null ? 'absent' : raw.outSR}, not 4326; coordinates are treated as WGS84 anyway.`);
    }
    const present = Object.keys(raw.layers);
    for (const id of LAYERS) {
        const entry = raw.layers[id] ?? raw.layers[String(id)];
        if (!entry) { out.warnings.push(`Layer ${id} missing from the capture.`); continue; }
        out.layers[id] = normaliseLayer(id, entry, out.warnings);
    }
    for (const key of present) {
        if (!LAYERS.includes(Number(key))) out.warnings.push(`Layer ${key} in the capture is not one of the seven known layers; ignored.`);
    }
    if (!Object.keys(out.layers).length) throw new DumpError('no-layers', 'Capture contains none of layers 8,9,10,11,12,15,16');
    return out;
}

function normaliseLayer(id, entry, warnings) {
    if (!isObject(entry)) throw new DumpError('bad-layer', `Layer ${id} is not an object`);
    const features = Array.isArray(entry.features) ? entry.features : [];
    const fields = Array.isArray(entry.fields) ? entry.fields.filter(isObject).map(f => ({
        name: String(f.name ?? ''), type: f.type ?? null, alias: f.alias ?? null
    })).filter(f => f.name) : [];
    if (!features.length) throw new DumpError('empty-layer', `Layer ${id} has no features`);
    let badGeometry = 0, missingAttributes = 0;
    for (const f of features) {
        if (!isObject(f)) { missingAttributes++; continue; }
        if (!isObject(f.attributes)) missingAttributes++;
        const g = isObject(f.geometry) ? f.geometry : null;
        if (!g || !Number.isFinite(Number(g.x)) || !Number.isFinite(Number(g.y))) badGeometry++;
    }
    if (missingAttributes) warnings.push(`Layer ${id}: ${missingAttributes} feature(s) without an attributes object.`);
    if (badGeometry) warnings.push(`Layer ${id}: ${badGeometry} feature(s) without a finite x/y point geometry.`);
    if (typeof entry.expected === 'number' && entry.expected !== features.length) {
        warnings.push(`Layer ${id}: published count ${entry.expected} but ${features.length} features in the capture.`);
    }
    if (!fields.length) warnings.push(`Layer ${id}: no field list in the capture; field meanings come from the values only.`);
    return {
        id: Number(id),
        name: typeof entry.name === 'string' ? entry.name : null,
        expected: typeof entry.expected === 'number' ? entry.expected : null,
        fields, features,
        counts: { features: features.length, badGeometry, missingAttributes }
    };
}

/** Stable fingerprint of the capture (content only, not capture time). */
export function fingerprint(dump) {
    const payload = LAYERS.filter(id => dump.layers[id]).map(id => {
        const l = dump.layers[id];
        return [id, l.features.map(f => [f.attributes || {}, f.geometry || {}])];
    });
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Field metadata by name, safe when the capture omits fields[]. */
export function fieldMap(layer) {
    const map = new Map();
    for (const f of layer.fields) map.set(f.name, f);
    return map;
}

/** Every attribute key actually present, in first-seen order. */
export function attributeKeys(layer) {
    const seen = new Set();
    for (const f of layer.features) for (const k of Object.keys(f.attributes || {})) seen.add(k);
    return [...seen];
}
