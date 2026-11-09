/**
 * DARMC capture → mapping derivation → normalisation → duplicate rules → fixtures.
 * Everything here runs on the file in test/fixtures/darmc/ (a synthetic capture in
 * the operator's real shape). No network, no database.
 *
 *   node test-apm-hoards-darmc.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDump, fingerprint, LAYERS } from './tools/darmc-hoards/dump.mjs';
import { deriveAll, classifyCombo, toYear, analyseDuplicateEvidence } from './tools/darmc-hoards/derive.mjs';
import { toRow, validateRow, stableId, COLUMNS } from './tools/darmc-hoards/normalise.mjs';
import { trimCapture, selectFeatures } from './tools/darmc-hoards/fixtures.mjs';
import { emitSql } from './tools/darmc-hoards/import.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(here, 'test/fixtures/darmc/darmc-layers.sample.json');
const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const dump = parseDump(raw);
const derived = deriveAll(dump);
let checks = 0;
const ok = (label, cond, extra) => { checks++; assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); };

// ── 1. loader ────────────────────────────────────────────────────────────────
assert.throws(() => parseDump('{'), /not valid JSON/);
assert.throws(() => parseDump({ layers: {} }), /none of layers/);
assert.throws(() => parseDump({ layers: { 8: { features: [] } } }), /no features/);
{
    const d = parseDump({ outSR: 3857, layers: { 8: { features: [{ attributes: {}, geometry: { x: 1, y: 2 } }] } } });
    ok('non-4326 capture warns instead of silently reinterpreting', d.warnings.some(w => /outSR is 3857/.test(w)));
    ok('missing layers are reported, not invented', d.warnings.filter(w => /missing from the capture/.test(w)).length === 6);
}
ok('fingerprint is stable across parses', fingerprint(dump) === fingerprint(parseDump(raw)));

// ── 2. derivation ────────────────────────────────────────────────────────────
const expectFields = {
    8: ['DATE_E', 'DATE_L'], 9: ['DATE_E', 'DATE_L'], 10: ['DATE_E', 'DATE_L'], 11: ['DATE_E', 'DATE_L'],
    12: ['start_date', 'end_date'], 15: ['HOB_PD_ST', 'HOB_PD_EN'], 16: ['START_D', 'END_D']
};
for (const [id, [start, end]] of Object.entries(expectFields)) {
    const l = derived.layers[id];
    ok(`layer ${id} start field`, l.mapping.dateStartField === start, l.mapping.dateStartField);
    ok(`layer ${id} end field`, l.mapping.dateEndField === end, l.mapping.dateEndField);
    ok(`layer ${id} id field`, l.mapping.idField === 'OBJECTID', l.mapping.idField);
    ok(`layer ${id} is complete`, l.complete === true, l.warnings.join('; '));
}
for (const id of LAYERS) {
    const m = derived.layers[id].mapping;
    for (const forbidden of ['FINDATE', 'Find_year', 'YEAR_DISC', 'COINS_MN', 'hoardsize', 'preserved', 'Received_O', 'ITEM_ON']) {
        ok(`layer ${id} never uses ${forbidden} as a deposit date`, m.dateStartField !== forbidden && m.dateEndField !== forbidden);
    }
    ok(`layer ${id} mapping is unreviewed`, m.reviewed === false);
}
ok('layer 12 is the only layer with no position-quality field', derived.layers[12].mapping.qualityFields.length === 0 &&
    LAYERS.filter(id => id !== 12).every(id => derived.layers[id].mapping.qualityFields.length > 0));
ok('a year column never becomes a position field', !Object.values(derived.layers).some(l => l.mapping.qualityFields.includes('D_TPQ') || l.mapping.qualityFields.includes('DATE_E')));
ok('layer 15 flags its TPQ field for review', derived.layers[15].evidence.tpqField === 'D_TPQ');

// Unique identifiers must be found in layers larger than any sampling cap.
{
    const features = [];
    for (let i = 0; i < 300; i++) features.push({ attributes: { OBJECTID: i + 1, NAME_COUP: 'Hoard ' + (i % 7), DATE_E: 800 + (i % 50), DATE_L: 810 + (i % 50) }, geometry: { x: 10 + i / 100, y: 45 + i / 100 } });
    const big = parseDump({ outSR: 4326, layers: { 8: { name: 'big', expected: 300, fields: [], features } } });
    const d = deriveAll(big);
    ok('a 300-record layer still has a unique identifier', d.layers[8].mapping.idField === 'OBJECTID', String(d.layers[8].mapping.idField));
    const errs = features.map(f => validateRow(toRow(f, 8, { ...d.layers[8].mapping, reviewed: true }).row)).filter(e => e.length);
    ok('and every one of its 300 rows is contract-valid', errs.length === 0, `${errs.length} invalid`);
}

// position classification is value-driven
ok('circa code is approximate', classifyCombo({ Q_LAT_LON: 'c' }).proposed === 'approximate');
ok('question mark is approximate', classifyCombo({ Q_LAT_LON: '?' }).proposed === 'approximate');
ok('a centroid label makes the position approximate', classifyCombo({ CENTROID: 'Pannonia' }).proposed === 'approximate');
ok('blank code alone is not approximate', classifyCombo({ Q_LAT_LON: ' ' }).proposed === 'exact');
ok('blank code alone is unknown under the strict reading', classifyCombo({ Q_LAT_LON: ' ' }).strict === 'unknown');
ok('VERIFIED="F" is not a position signal', classifyCombo({ FINDSPOT_Q: null, VERIFIED: 'F' }).proposed === 'exact');
{
    const pm = derived.layers[8].mapping.positionMapping;
    ok('layer 8 keys combinations of both quality fields', pm['{"FINDSPOT_Q":null,"VERIFIED":"X"}'] === 'exact');
    ok('layer 8 marks FINDSPOT_Q="?" approximate', pm['{"FINDSPOT_Q":"?","VERIFIED":"X"}'] === 'approximate');
    ok('layer 8 counts every combination that occurs', derived.layers[8].evidence.positionCombos.reduce((n, c) => n + c.count, 0) === dump.layers[8].features.length);
}
ok('strict policy refuses a row with no position evidence', Object.values(derived.layers[8].evidence.strictMapping).includes('unknown'));

// years: strict, single values only
ok('a numeric year parses', toYear(755) === 755 && toYear('755') === 755);
ok('a range does not parse as a year', toYear('755-769') === null);
ok('a circa value does not parse as a year', toYear('c.337?') === null);
ok('BC converts to astronomical years', toYear('44 BC') === -43);

// ── 3. normalisation and the table contract ─────────────────────────────────
const rows = [];
const dropped = {};
for (const id of LAYERS) {
    const mapping = { ...derived.layers[id].mapping, reviewed: true };
    for (const f of dump.layers[id].features) {
        const r = toRow(f, id, mapping);
        if (r.dropped) { dropped[r.dropped] = (dropped[r.dropped] || 0) + 1; continue; }
        const errors = validateRow(r.row);
        assert.equal(errors.length, 0, `layer ${id} row fails the table contract: ${errors.join(', ')}`);
        rows.push(r.row);
    }
}
ok('every sample feature becomes a contract-valid row', rows.length === 31, `${rows.length} rows`);
ok('ids are deterministic uuids', rows[0].id === stableId(rows[0]) && /^[0-9a-f-]{36}$/.test(rows[0].id));
ok('two capture records with the same attributes still get different ids', rows[0].id !== rows[1].id);
ok('a layer with no position field yields unknown rows', rows.filter(r => r.source_layer === 12).every(r => r.position_class === 'unknown'));
ok('no row carries a discovery year as a deposit date', rows.every(r => !(r.date_basis === 'deposit' && [1972, 1955, 1990, 1863].includes(r.deposit_start_year))));

{
    const broken = structuredClone(dump.layers[15].features[0]);
    broken.attributes.HOB_PD_ST = 600; broken.attributes.HOB_PD_EN = 500;
    const r = toRow(broken, 15, { ...derived.layers[15].mapping, reviewed: true });
    ok('reversed deposit dates are rejected', r.dropped === 'reversed-deposit-dates', r.dropped);
}
{
    const broken = structuredClone(dump.layers[15].features[0]);
    broken.geometry = { x: 999, y: 999 };
    ok('an out-of-range point is rejected', toRow(broken, 15, { ...derived.layers[15].mapping, reviewed: true }).dropped === 'invalid-point-geometry');
}
ok('an unreviewed mapping produces no rows', toRow(dump.layers[8].features[0], 8, derived.layers[8].mapping).dropped === 'unreviewed-layer-schema');

// ── 4. duplicates ────────────────────────────────────────────────────────────
const evidence = analyseDuplicateEvidence(rows);
ok('the two Rouen records are an exact-coordinate group', evidence.coordinateGroups.some(g => g.count === 2 && g.ids.every(i => i.startsWith('8/'))));
ok('15 and 16 are matched as the same finds', evidence.crossLayerCoordinateGroups.length === 3, JSON.stringify(evidence.crossLayerCoordinateGroups.map(g => g.layers)));
ok('cross-layer pairs are counted', evidence.crossLayerPairs['15<->16'] === 3);
ok('duplicate thresholds are proposed from the data, not hard-coded to a default', Number.isFinite(evidence.proposal.distanceM) && evidence.proposal.distanceM >= 250);
ok('name similarity proposal is in range', evidence.proposal.nameSimilarity >= 0.5 && evidence.proposal.nameSimilarity <= 1);

const { hoards } = await import('./tools/darmc-hoards/normalise.mjs');
const pairs = hoards.markDuplicates(rows, evidence.proposal);
ok('duplicate marking marks rather than deletes', pairs.length >= 5 && rows.length === 31);
ok('every duplicate points at a real kept row', pairs.every(p => rows.some(r => r.id === p.duplicate_of)));
ok('the cross-layer pair 15/2 ↔ 16/2 is marked once', pairs.filter(p => [p.id, p.duplicate_of].some(i => rows.some(r => r.id === i && r.source_layer === 16))).length === 3);

// ── 5. fixtures ──────────────────────────────────────────────────────────────
{
    const { capture, manifest } = trimCapture(dump, derived, { perLayer: 5 });
    for (const id of LAYERS) {
        ok(`fixture ${id} keeps at most 5 records`, capture.layers[id].features.length <= 5);
        ok(`fixture ${id} is self-consistent`, capture.layers[id].expected === capture.layers[id].features.length);
        ok(`fixture ${id} keeps its field list`, capture.layers[id].fields.length === dump.layers[id].fields.length);
    }
    const combos = selectFeatures(dump.layers[8].features, derived.layers[8].mapping, 99);
    const distinct = new Set(combos.map(c => JSON.stringify([c.feature.attributes.FINDSPOT_Q, c.feature.attributes.VERIFIED])));
    ok('the trimmer covers every quality combination it can', distinct.size === 5, `${distinct.size} combinations`);
    ok('the trimmer records why each record was kept', manifest.layers[8].reasons.length >= 5);
    ok('the trimmed capture parses back into a dump', parseDump(capture).layers[8].features.length === capture.layers[8].features.length);
}

// ── 6. emitted SQL ───────────────────────────────────────────────────────────
{
    const sql = emitSql(rows, fingerprint(dump));
    ok('emitted SQL is data-only', !/\b(DROP|TRUNCATE|ALTER|GRANT|CREATE)\b/.test(sql));
    ok('emitted SQL deletes nothing', !/\bDELETE\b/.test(sql));
    ok('emitted SQL never touches the settlement table', !/archaeological_sites_a/.test(sql));
    ok('emitted SQL upserts on id', /ON CONFLICT \(id\) DO UPDATE/.test(sql));
    ok('emitted SQL defers the self-reference', /SET CONSTRAINTS ALL DEFERRED/.test(sql));
    ok('emitted SQL carries every column the importer writes', COLUMNS.every(c => sql.includes(c)));
    ok('emitted SQL escapes quotes in text', emitSql([{ ...rows[0], name: "O'Hara" }], 'x').includes("'O''Hara'"));
}

// ── 7. CLI behaviour ─────────────────────────────────────────────────────────
{
    const out = execFileSync(process.execPath, ['tools/darmc-hoards/import.mjs', '--dump', SAMPLE], { encoding: 'utf8' });
    const summary = JSON.parse(out);
    ok('CLI defaults to a dry run', summary.mode === 'DRY-RUN' && summary.wrote === 'nothing (dry run)');
    ok('CLI counts every feature', summary.counts.fetched === 31 && summary.counts.kept === 31);
    ok('CLI reports the unreviewed mapping status', /PROPOSED/.test(summary.mappingStatus));

    const strict = JSON.parse(execFileSync(process.execPath, ['tools/darmc-hoards/import.mjs', '--dump', SAMPLE, '--position', 'strict'], { encoding: 'utf8' }));
    ok('the strict policy reclassifies the unsupported rows', strict.counts.positionClasses.unknown > summary.counts.positionClasses.unknown);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'darmc-'));
    const report = path.join(tmp, 'review.md');
    execFileSync(process.execPath, ['tools/darmc-hoards/import.mjs', '--dump', SAMPLE, '--report', report], { encoding: 'utf8' });
    const md = fs.readFileSync(report, 'utf8');
    ok('the report shows the proposed mapping and the counts', /## Mapping per layer/.test(md) && /## Duplicate rules/.test(md) && /## Decisions required/.test(md));
    ok('the report separates verified from unverified', /## Not verified/.test(md));

    assert.throws(() => execFileSync(process.execPath, ['tools/darmc-hoards/import.mjs', '--dump', SAMPLE, '--apply'], { encoding: 'utf8', stdio: 'pipe' }),
        e => /not reviewed/.test(String(e.stderr)));
    ok('--apply refuses an unreviewed mapping before touching a database', true);

    const mappingFile = path.join(tmp, 'mapping.json');
    execFileSync(process.execPath, ['tools/darmc-hoards/import.mjs', '--dump', SAMPLE, '--mapping', mappingFile], { encoding: 'utf8' });
    const saved = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
    ok('the mapping file records the capture it came from', /^[0-9a-f]{64}$/.test(saved.captureFingerprint));
    ok('the mapping file is unreviewed by default', Object.values(saved.layers).every(l => l.reviewed === false));
}

console.log(`PASS DARMC capture pipeline (${checks} checks): loader validation and warnings; value-driven date/name/id derivation; forbidden discovery-year and count fields never used; per-combination position proposals with proposed vs strict readings; deterministic uuids; table-contract validation; reversed-date and bad-geometry drops; unreviewed mappings drop closed; duplicate evidence across layers 15/16 and within layers; fixture trimming with quality-combination coverage; data-only SQL with no deletes; CLI dry-run by default and refusal to apply an unreviewed mapping. Synthetic capture only — no live service, no database.`);
