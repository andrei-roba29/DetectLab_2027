#!/usr/bin/env node
/**
 * DARMC hoards → public.archaeological_hoards. Offline, DRY RUN by default.
 *
 *   node tools/darmc-hoards/import.mjs --dump data/hoards/darmc_hoards_layers.json \
 *        --report data/hoards/darmc-review.md --mapping data/hoards/darmc-mapping.json
 *
 *   node tools/darmc-hoards/import.mjs --dump ... --fixtures test/fixtures/darmc
 *   node tools/darmc-hoards/import.mjs --dump ... --emit-sql /tmp/hoards.sql
 *   node tools/darmc-hoards/import.mjs --dump ... --mapping-in reviewed.json --apply
 *
 * Reads only the capture file. Writes only public.archaeological_hoards, only
 * with --apply, only with a fully reviewed mapping, and only with DATABASE_URL
 * set locally. Never prints or accepts credentials in chat.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDump, fingerprint, LAYERS } from './dump.mjs';
import { deriveAll, analyseDuplicateEvidence } from './derive.mjs';
import { toRow, validateRow, COLUMNS, JSON_COLUMNS, stableId, hoards } from './normalise.mjs';
import { buildReport } from './report.mjs';
import { trimCapture } from './fixtures.mjs';

const args = process.argv.slice(2);
const arg = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const flag = k => args.includes(k);

const HELP = `DARMC hoards import — dry run by default.

  --dump <file>          the browser capture (required)
  --mapping <file>       write the proposed mapping here (JSON)
  --mapping-in <file>    use this mapping instead of deriving one
  --report <file>        write the review report (Markdown)
  --json <file>          write the machine-readable counts here
  --fixtures <dir>       write trimmed per-layer fixtures from the capture
  --per-layer <n>        fixture records per layer (default 12)
  --emit-sql <file>      write the row data as an idempotent SQL file
  --position strict      classify "no position evidence" as unknown (default: proposed)
  --position-default L=C layer with no position-quality field: give every record class C
                         (e.g. --position-default 12=exact); without it they are unknown
  --limit <n>            cap records read per layer (for a quick look)
  --snapshot <label>     snapshot id written with each row (needs 018_apm_hoards_import.sql)
  --apply                write to the database (needs a reviewed mapping + DATABASE_URL)
  --help

Nothing is fetched. Nothing is deleted.`;

function readJsonArg(file) {
    return fs.readFile(file, 'utf8').then(t => JSON.parse(t));
}

function tally(rows, key) {
    const out = {};
    for (const r of rows) out[r[key]] = (out[r[key]] || 0) + 1;
    return out;
}

function applyPositionDefaults(derived, spec) {
    if (!spec) return derived;
    for (const part of String(spec).split(',')) {
        const [id, cls] = part.split('=');
        const layer = derived.layers[Number(id)];
        if (!layer) throw new Error(`--position-default: no layer ${id} in the capture`);
        if (!['exact', 'approximate'].includes(cls)) throw new Error('--position-default: class must be exact or approximate');
        if (layer.mapping.qualityFields.length) throw new Error(`--position-default: layer ${id} has position-quality fields; the default would be ignored`);
        layer.mapping.positionMapping = { '{}': cls };
        layer.mapping.positionDefault = cls;
    }
    return derived;
}

function applyPositionPolicy(derived, policy) {
    if (policy !== 'strict') return derived;
    for (const d of Object.values(derived.layers)) {
        d.mapping.positionMapping = { ...d.evidence.strictMapping };
        d.mapping.positionPolicy = 'strict';
    }
    return derived;
}

async function main() {
    if (flag('--help') || !args.length) { console.log(HELP); return; }
    const dumpPath = arg('--dump');
    if (!dumpPath) throw new Error('--dump <file> is required (the capture is the only source)');
    const policy = (arg('--position') || 'proposed').toLowerCase();
    if (!['proposed', 'strict'].includes(policy)) throw new Error('--position must be proposed or strict');
    const limit = arg('--limit') ? Number(arg('--limit')) : null;

    const raw = JSON.parse(await fs.readFile(dumpPath, 'utf8'));
    const dump = parseDump(raw);
    if (limit) {
        for (const layer of Object.values(dump.layers)) layer.features = layer.features.slice(0, limit);
    }
    const fp = fingerprint(dump);

    let derived = deriveAll(dump);
    let mappingStatus = 'PROPOSED (derived, unreviewed)';
    if (arg('--mapping-in')) {
        const saved = await readJsonArg(arg('--mapping-in'));
        for (const id of LAYERS) {
            const m = saved.layers?.[id];
            if (!m) throw new Error(`--mapping-in has no mapping for layer ${id}`);
            if (!derived.layers[id]) continue;
            derived.layers[id].mapping = m;
            derived.layers[id].complete = Boolean(m.idField && m.dateStartField && m.dateEndField && m.dateBasis);
            derived.layers[id].trainable = Boolean(m.qualityFields?.length || m.positionDefault);
        }
        const allReviewed = LAYERS.filter(id => derived.layers[id]).every(id => derived.layers[id].mapping.reviewed === true);
        mappingStatus = allReviewed ? 'REVIEWED (from --mapping-in)' : 'PARTIALLY REVIEWED (from --mapping-in)';
    }
    applyPositionPolicy(derived, policy);
    applyPositionDefaults(derived, arg('--position-default'));

    if (arg('--mapping')) {
        const proposal = {
            generatedAt: new Date().toISOString(),
            captureFingerprint: fp,
            positionPolicy: policy,
            notice: 'Derived from the capture by tools/darmc-hoards/derive.mjs. Every layer is reviewed:false until a human checks it. Flip to true only after review.',
            duplicate: undefined,
            layers: {}
        };
        for (const [id, d] of Object.entries(derived.layers)) proposal.layers[id] = d.mapping;
        await fs.mkdir(path.dirname(path.resolve(arg('--mapping'))), { recursive: true });
        await fs.writeFile(arg('--mapping'), JSON.stringify(proposal, null, 2) + '\n');
    }

    // ── normalise ────────────────────────────────────────────────────────────
    const rows = [];
    const counts = { fingerprint: fp, layers: {}, totals: { layers: 0, fetched: 0, kept: 0, dropped: 0 }, duplicates: { marked: 0, pairs: [] } };
    const invalid = [];
    for (const id of LAYERS) {
        const layer = dump.layers[id];
        if (!layer) continue;
        const d = derived.layers[id];
        const stats = { fetched: layer.features.length, kept: 0, dropped: 0, dropReasons: {}, positionClasses: { exact: 0, approximate: 0, unknown: 0 }, periodGroups: {}, withDates: 0, withoutDates: 0 };
        // Dry runs must see the rows an accepted mapping would produce; the guard is
        // lifted only in memory and the status is printed with the counts.
        const mapping = { ...d.mapping, reviewed: true };
        for (const feature of layer.features) {
            const result = toRow(feature, id, mapping);
            if (result.dropped) { stats.dropped++; stats.dropReasons[result.dropped] = (stats.dropReasons[result.dropped] || 0) + 1; continue; }
            const errors = validateRow(result.row);
            if (errors.length) { stats.dropped++; stats.dropReasons['schema:' + errors[0]] = (stats.dropReasons['schema:' + errors[0]] || 0) + 1; invalid.push({ layer: id, id: result.row.source_id, errors }); continue; }
            rows.push(result.row);
            stats.kept++;
            stats.positionClasses[result.row.position_class] = (stats.positionClasses[result.row.position_class] || 0) + 1;
            for (const g of result.row.period_groups) stats.periodGroups[g] = (stats.periodGroups[g] || 0) + 1;
            if (result.row.deposit_start_year != null && result.row.deposit_end_year != null) stats.withDates++; else stats.withoutDates++;
        }
        counts.layers[id] = stats;
        counts.totals.layers++;
        for (const k of ['fetched', 'kept', 'dropped']) counts.totals[k] += stats[k];
    }

    // ── duplicates ───────────────────────────────────────────────────────────
    const duplicateEvidence = analyseDuplicateEvidence(rows);
    const thresholds = { distanceM: duplicateEvidence.proposal.distanceM, nameSimilarity: duplicateEvidence.proposal.nameSimilarity };
    const pairs = hoards.markDuplicates(rows, thresholds);
    const ids = new Set(rows.map(r => r.id));
    for (const p of pairs) if (!ids.has(p.duplicate_of)) p.duplicate_of = null;
    counts.duplicates = { marked: pairs.length, thresholds, pairs: pairs.slice(0, 25) };
    counts.positions = tally(rows, 'position_class');
    counts.periodGroups = tally(rows, 'period_group');
    counts.dateBasis = tally(rows, 'date_basis');
    counts.duplicateMarking = Object.fromEntries(Object.entries(duplicateEvidence.withinLayerPairs).map(([k, v]) => [k, v]));

    // ── outputs ──────────────────────────────────────────────────────────────
    if (arg('--report')) {
        await fs.mkdir(path.dirname(path.resolve(arg('--report'))), { recursive: true });
        await fs.writeFile(arg('--report'), buildReport({ dump, derived, counts, duplicates: duplicateEvidence, mappingStatus, options: { positionPolicy: policy } }));
    }
    if (arg('--fixtures')) {
        const dir = arg('--fixtures');
        await fs.mkdir(dir, { recursive: true });
        const { capture, manifest } = trimCapture(dump, derived, { perLayer: arg('--per-layer') ? Number(arg('--per-layer')) : 12 });
        await fs.writeFile(path.join(dir, 'darmc-layers.fixture.json'), JSON.stringify(capture, null, 2) + '\n');
        await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, captureFingerprint: fp }, null, 2) + '\n');
    }
    if (arg('--emit-sql')) await fs.writeFile(arg('--emit-sql'), emitSql(rows, fp));
    if (arg('--json')) await fs.writeFile(arg('--json'), JSON.stringify({ ...counts, invalid: invalid.slice(0, 20), mappingStatus }, null, 2) + '\n');

    // ── database write (explicit, reviewed, local credentials only) ──────────
    let applied = false;
    if (flag('--apply')) {
        const reviewed = Object.values(derived.layers).every(d => d.mapping.reviewed === true);
        if (!reviewed) throw new Error('Refusing --apply: the mapping is not reviewed. Pass --mapping-in with every layer reviewed:true.');
        if (!process.env.DATABASE_URL) throw new Error('Refusing --apply: DATABASE_URL is not set (set it locally; never paste it in chat).');
        const { createRequire } = await import('node:module');
        const require = createRequire(new URL('../../backend/package.json', import.meta.url));
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL });
        const snapshot = arg('--snapshot') || null;
        if (snapshot) for (const row of rows) row.snapshot_id = snapshot;
        await db.connect();
        try {
            await db.query('BEGIN');
            try {
                await db.query('SET CONSTRAINTS ALL DEFERRED');
                for (const row of rows) await upsert(db, row);
                await db.query('COMMIT');
            } catch (e) { await db.query('ROLLBACK'); throw e; }
            applied = true;
            // Audit row is best-effort: without 018 the import is still complete and traceable
            // through the returned counts, it is just not recorded in the database.
            await db.query(
                `INSERT INTO public.hoard_import_runs (source, capture_fingerprint, snapshot_id, row_counts, mapping, mode, finished_at)
                 VALUES ($1,$2,$3,$4,$5,'apply',now())`,
                [dump.source || 'unknown', fp, snapshot, JSON.stringify(summaryCounts()), JSON.stringify(Object.fromEntries(Object.entries(derived.layers).map(([id, d]) => [id, d.mapping])))]
            ).catch(e => console.error(`note: hoard_import_runs not written (${e.message}); apply 018 to enable the audit trail`));
        } finally { await db.end(); }
    }

    const summaryCounts = () => ({
        fetched: counts.totals.fetched, kept: counts.totals.kept, dropped: counts.totals.dropped,
        duplicates: counts.duplicates.marked,
        positionClasses: counts.positions, periodGroups: counts.periodGroups, dateBasis: counts.dateBasis,
        byLayer: Object.fromEntries(Object.entries(counts.layers).map(([id, c]) => [id, { fetched: c.fetched, kept: c.kept, dropped: c.dropped }]))
    });
    const summary = {
        mode: applied ? 'APPLY' : 'DRY-RUN',
        source: dumpPath,
        captureFingerprint: fp,
        mappingStatus,
        positionPolicy: policy,
        counts: {
            fetched: counts.totals.fetched, kept: counts.totals.kept, dropped: counts.totals.dropped,
            duplicates: counts.duplicates.marked,
            positionClasses: counts.positions, periodGroups: counts.periodGroups, dateBasis: counts.dateBasis,
            byLayer: Object.fromEntries(Object.entries(counts.layers).map(([id, c]) => [id, { fetched: c.fetched, kept: c.kept, dropped: c.dropped, exact: c.positionClasses.exact, approximate: c.positionClasses.approximate, unknown: c.positionClasses.unknown }]))
        },
        duplicateThresholds: thresholds,
        warnings: derived.warnings,
        wrote: applied ? 'public.archaeological_hoards' : 'nothing (dry run)'
    };
    console.log(JSON.stringify(summary, null, 2));
    if (invalid.length) console.error(`\n${invalid.length} row(s) failed the table contract; first three:\n` + JSON.stringify(invalid.slice(0, 3), null, 2));
}

async function upsert(db, row) {
    const keys = COLUMNS.filter(c => c !== 'duplicate_of' || row.duplicate_of != null);
    const values = keys.map(k => (JSON_COLUMNS.has(k) ? JSON.stringify(row[k]) : row[k]));
    const update = keys.filter(k => k !== 'id').map(k => `${k}=EXCLUDED.${k}`).join(',');
    await db.query(
        `INSERT INTO public.archaeological_hoards (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (id) DO UPDATE SET ${update},synced_at=now()`,
        values
    );
}

function sqlLiteral(value, isJson) {
    if (value == null) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) {
        if (!value.length) return "'{}'::text[]";
        return `ARRAY[${value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]::text[]`;
    }
    const text = isJson ? JSON.stringify(value) : String(value);
    return isJson ? `'${text.replace(/'/g, "''")}'::jsonb` : `'${text.replace(/'/g, "''")}'`;
}

/** Idempotent data SQL: same upsert as --apply, no DDL, no deletes. */
export function emitSql(rows, fp) {
    const update = COLUMNS.filter(c => c !== 'id').map(c => `${c}=EXCLUDED.${c}`).join(',');
    const out = [
        `-- Generated by tools/darmc-hoards/import.mjs from capture ${fp}. Do not hand-edit.`,
        '-- Data only: no DDL, no deletes, and no touch on the settlement catalogue.',
        '-- Requires 017_apm_hoards.sql (table) and 018_apm_hoards_import.sql (audit).',
        'BEGIN;',
        'SET CONSTRAINTS ALL DEFERRED;'
    ];
    for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        out.push(`INSERT INTO public.archaeological_hoards (${COLUMNS.join(',')}) VALUES\n` +
            batch.map(r => `(${COLUMNS.map(c => sqlLiteral(r[c], JSON_COLUMNS.has(c))).join(',')})`).join(',\n') +
            `\nON CONFLICT (id) DO UPDATE SET ${update},synced_at=now();`);
    }
    out.push('COMMIT;', '');
    return out.join('\n');
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
    main().catch(e => { console.error(`error: ${e.message}`); process.exitCode = 1; });
}
