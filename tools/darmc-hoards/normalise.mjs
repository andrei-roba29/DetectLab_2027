/**
 * The one normalisation path: DARMC feature → public.archaeological_hoards row.
 *
 * Reuses js/apm-next/apm-hoards.js (the module the browser already ships), so an
 * imported row and a client-side row cannot drift apart. This file only adds the
 * table contract: the exact column list, the CHECK constraints, and a validator
 * that refuses to emit a row the database would reject.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hoards = require('../../js/apm-next/apm-hoards.js');
const config = require('../../js/apm-next/hoards.config.js');

/** Columns the importer writes. Mirrors backend/migrations/manual/017_apm_hoards.sql. */
export const COLUMNS = [
    'id', 'source', 'source_layer', 'source_id', 'name', 'lat', 'lon',
    'position_class', 'position_quality_raw', 'position_accuracy_m',
    'period_group', 'period_groups', 'periods', 'multiple_periods',
    'deposit_start_year', 'deposit_end_year', 'date_basis',
    'hoard_type', 'metal', 'country', 'bucket', 'duplicate_of', 'raw'
];

/** Columns whose value is JSON-encoded before binding. */
export const JSON_COLUMNS = new Set(['periods', 'position_quality_raw', 'raw']);

const ENUMS = {
    source: ['darmc', 'ran'],
    position_class: ['exact', 'approximate', 'unknown'],
    date_basis: ['deposit', 'tpq', 'find-year', 'name-keyword'],
    hoard_type: ['coin', 'non-coin', 'mixed', 'unknown'],
    bucket: ['hoard-only', 'mixed', 'uncertain']
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Deterministic id from (source, layer, source id) — the same record always gets the same uuid. */
export function stableId(row) {
    const hex = crypto.createHash('sha256').update(`${row.source}:${row.source_layer}:${row.source_id}`).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Normalise one captured feature.
 * `mapping.reviewed` is forced on by the caller for dry runs; nothing else changes.
 */
export function toRow(feature, layerId, mapping) {
    const result = hoards.normaliseDarmc(feature, layerId, mapping);
    if (result.dropped) return result;
    const row = result.row;
    row.id = stableId(row);
    return { row };
}

export function validateRow(row) {
    const errors = [];
    if (!UUID_RE.test(String(row.id))) errors.push('id is not a uuid');
    for (const [key, allowed] of Object.entries(ENUMS)) {
        if (!allowed.includes(row[key])) errors.push(`${key}="${row[key]}" is not one of ${allowed.join('/')}`);
    }
    if (!Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90) errors.push('lat out of range');
    if (!Number.isFinite(row.lon) || row.lon < -180 || row.lon > 180) errors.push('lon out of range');
    if (!Number.isInteger(row.source_layer)) errors.push('source_layer is not an integer');
    if (row.position_accuracy_m != null && !(row.position_accuracy_m > 0 && Number.isFinite(row.position_accuracy_m))) errors.push('position_accuracy_m invalid');
    if (row.deposit_start_year != null && row.deposit_end_year != null && row.deposit_start_year > row.deposit_end_year) errors.push('deposit dates reversed');
    if (row.deposit_start_year != null && !Number.isInteger(row.deposit_start_year)) errors.push('deposit_start_year not an integer');
    if (row.deposit_end_year != null && !Number.isInteger(row.deposit_end_year)) errors.push('deposit_end_year not an integer');
    if (row.date_basis === 'find-year' && (row.deposit_start_year != null || row.deposit_end_year != null)) errors.push('discovery year persisted as a deposit date');
    if (row.position_quality_raw == null || typeof row.position_quality_raw !== 'object') errors.push('position_quality_raw is not an object');
    if (row.raw == null || typeof row.raw !== 'object') errors.push('raw is not an object');
    if (!Array.isArray(row.periods)) errors.push('periods is not an array');
    if (!Array.isArray(row.period_groups)) errors.push('period_groups is not an array');
    return errors;
}

export { hoards, config };
