/**
 * Human review report: the proposed mapping and the counts behind it.
 * Everything in the output is a measurement from the capture, not an assumption.
 */

const fmt = n => (n == null ? '—' : String(n));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const code = v => (v == null || v === '' ? '∅' : `\`${String(v)}\``);

function whyNotDate(f) {
    if (/(?:^|_)(?:ID|NO|NUM|OBJECTID)(?:$|_)/i.test(f.field)) return 'identifier, not a year';
    if (/^(?:FINDATE|FINDDATE|FIND_DATE|Find_year|YEAR_DISC|DISCOVERY)/i.test(f.field)) return 'discovery year — forbidden as a deposit date';
    if (/^(?:COINS|COINS_MN|COINS_MX|hoardsize|preserved|ITEM_ON|Received_O)/i.test(f.field)) return 'count — forbidden as a deposit date';
    if (/(?:weight|WIDTH|HEIGHT|DEPTH)/i.test(f.field)) return 'measurement — forbidden as a deposit date';
    return 'no validated start/end partner';
}

function table(head, rows) {
    if (!rows.length) return '_none_\n';
    return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n') + '\n';
}

export function buildReport({ dump, derived, counts, duplicates, mappingStatus, options = {} }) {
    const out = [];
    out.push('# DARMC hoards — proposed mapping and import counts\n');
    out.push(`Generated ${new Date().toISOString()} by \`tools/darmc-hoards/import.mjs\`.\n`);
    out.push(`- Capture source: ${dump.source ? `\`${dump.source}\`` : '_not stated in the file_'}`);
    out.push(`- Captured at: ${dump.fetchedAt || '_not stated_'}`);
    out.push(`- Output SR: ${fmt(dump.outSR)}`);
    out.push(`- Content fingerprint: \`${counts.fingerprint}\``);
    out.push(`- Mapping status: **${mappingStatus}**`);
    out.push(`- Position policy used for these counts: **${options.positionPolicy || 'proposed'}**`);
    out.push('');
    out.push('These are counts of what *would* be written. Nothing was written. Every class below is a proposal for review.\n');

    out.push('## Totals\n');
    out.push(table(['Metric', 'Value'], [
        ['Layers in capture', fmt(counts.totals.layers)],
        ['Records read', fmt(counts.totals.fetched)],
        ['Rows kept', fmt(counts.totals.kept)],
        ['Rows dropped', fmt(counts.totals.dropped)],
        ['Duplicate candidates', fmt(counts.duplicates.marked)],
        ['Rows usable after duplicate marking', fmt(counts.totals.kept - counts.duplicates.marked)]
    ]));

    out.push('## Per layer\n');
    out.push(table(
        ['Layer', 'Name', 'Read', 'Kept', 'Dropped', 'exact', 'approximate', 'unknown', 'with dates', 'no dates', 'Period groups'],
        Object.entries(counts.layers).map(([id, c]) => [
            id, derived.layers[id]?.name ? `\`${derived.layers[id].name}\`` : '—',
            fmt(c.fetched), fmt(c.kept), fmt(c.dropped),
            fmt(c.positionClasses.exact), fmt(c.positionClasses.approximate), fmt(c.positionClasses.unknown),
            fmt(c.withDates), fmt(c.withoutDates),
            Object.entries(c.periodGroups).map(([k, v]) => `${k}:${v}`).join(', ') || '—'
        ])));

    const drops = Object.entries(counts.layers).flatMap(([id, c]) => Object.entries(c.dropReasons).map(([k, v]) => [`${id}`, k, fmt(v)]));
    if (drops.length) {
        out.push('### Drop reasons\n');
        out.push(table(['Layer', 'Reason', 'Count'], drops));
    }

    out.push('## Mapping per layer\n');
    for (const [id, d] of Object.entries(derived.layers)) {
        const e = d.evidence, m = d.mapping;
        out.push(`### Layer ${id}${d.name ? ` — ${d.name}` : ''}\n`);
        out.push(table(['Item', 'Derived', 'Evidence'], [
            ['Identifier', m.idField ? `\`${m.idField}\`` : '**none**', e.id.reason],
            ['Name', m.nameField ? `\`${m.nameField}\`` : '**none**', e.name.candidates?.map(c => `${c.field} ${pct(c.coverage, 1)}`).join(', ') || e.name.reason],
            ['Deposit start', m.dateStartField ? `\`${m.dateStartField}\`` : '**none**', e.date.candidates?.length ? `${e.date.candidates[0].orderedCount} of ${e.date.candidates[0].paired} paired rows have start ≤ end` : (e.date.rejected || []).map(r => r.field).join(', ') || e.date.reason || '—'],
            ['Deposit end', m.dateEndField ? `\`${m.dateEndField}\`` : '**none**', ''],
            ['Date basis', m.dateBasis ? `\`${m.dateBasis}\`` : '**none**', m.dateBasis === 'tpq' ? 'chosen field name carries TPQ' : 'ordered numeric pair, no TPQ field'],
            ['Hoard type', `\`${m.hoardType}\``, `${e.hoardType.basis}${e.hoardType.needsReview ? ' — **needs review**' : ''}`],
            ['Metal', m.metalField ? `\`${m.metalField}\`` : '—', m.metalField ? 'field present in the capture' : 'no metal field'],
            ['Country', m.countryField ? `\`${m.countryField}\`` : '—', m.countryField ? 'field present in the capture' : 'no country field (layer is worldwide)'],
            ['Position fields', m.qualityFields.length ? m.qualityFields.map(f => `\`${f}\``).join(', ') : '**none**', m.qualityFields.length ? `${e.positionCombos.length} distinct combinations` : 'no position-quality field; every row is unknown under the strict policy']
        ]));
        if (e.date.candidates?.length > 1) {
            out.push('Other validated date pairs (not chosen):\n');
            out.push(table(['Start', 'End', 'Paired rows', 'Ordered'], e.date.candidates.slice(1).map(c => [`\`${c.start}\``, `\`${c.end}\``, c.paired, `${c.orderedCount}/${c.paired}`])));
        }
        const rejectedYears = (e.unusedYearLikeFields || []).filter(f => f.forbidden || f.field !== m.dateStartField);
        if (rejectedYears.length) {
            out.push('Year-like fields deliberately not used as deposit dates:\n');
            out.push(table(['Field', 'Coverage', 'Year-like', 'Why'], rejectedYears.map(f => [`\`${f.field}\``, pct(f.coverage, 1), pct(f.yearRatio, 1), whyNotDate(f)])));
        }
        if (e.positionCombos.length) {
            out.push('Position classes:\n');
            out.push(table(['Observed values', 'Rows', 'Proposed', 'Strict', 'Rationale'],
                e.positionCombos.map(c => [
                    Object.keys(c.combo).length ? Object.entries(c.combo).map(([k, v]) => `${k}=${code(v)}`).join(', ') : '(no quality fields)',
                    fmt(c.count), `\`${c.proposed}\``, `\`${c.strict}\``, c.rationale
                ])));
        }
        if (d.warnings.length) out.push(`> ${d.warnings.join('\n> ')}\n`);
    }

    out.push('## Duplicate rules\n');
    out.push(table(['Metric', 'Value'], [
        ['Same-name pairs total', fmt(duplicates.sameNamePairCount)],
        ['Different layers', fmt(Object.values(duplicates.crossLayerPairs).reduce((a, b) => a + b, 0))],
        ['Identical coordinates within a layer', `${duplicates.exactCoordinateGroups} group(s), ${duplicates.exactCoordinateRecords} record(s)`],
        ['Identical coordinates across layers', `${duplicates.crossLayerCoordinateGroups.length} group(s), ${duplicates.crossLayerCoordinateGroups.reduce((n, g) => n + g.count, 0)} record(s)`],
        ['Pairs at 0 m', fmt(duplicates.thresholds.exact)],
        ['Pairs ≤ 100 m', fmt(duplicates.thresholds.within100m)],
        ['Pairs ≤ 1 km', fmt(duplicates.thresholds.within1km)],
        ['Pairs ≤ 5 km', fmt(duplicates.thresholds.within5km)],
        ['Distance percentiles p50 / p90 / p95 / p99', `${fmt(duplicates.distancePercentiles.p50)} / ${fmt(duplicates.distancePercentiles.p90)} / ${fmt(duplicates.distancePercentiles.p95)} / ${fmt(duplicates.distancePercentiles.p99)} m`],
        ['Proposed distance', `${duplicates.proposal.distanceM} m`],
        ['Proposed name similarity', duplicates.proposal.nameSimilarity],
        ['Basis', duplicates.proposal.basis]
    ]));
    if (duplicates.crossLayerCoordinateGroups.length) {
        out.push(`Cross-layer coordinate matches (first 10):\n`);
        out.push(table(['Point', 'Layers', 'Records'], duplicates.crossLayerCoordinateGroups.slice(0, 10).map(g => [g.coordinate, g.layers.join(' + '), g.count])));
    }
    if (Object.keys(duplicates.crossLayerPairs).length) {
        out.push(table(['Layer pair', 'Same-name pairs ≤ 5 km'], Object.entries(duplicates.crossLayerPairs).map(([k, v]) => [k, fmt(v)])));
    }
    if (duplicates.sameNamePairs.length) {
        out.push(`Same-name pairs closest first (up to 15 of ${duplicates.sameNamePairs.length} within 5 km):\n`);
        out.push(table(['A', 'B', 'Distance (m)', 'Name similarity', 'Name'],
            duplicates.sameNamePairs.slice(0, 15).map(p => [p.a, p.b, fmt(p.distance_m), p.similarity, `\`${p.name}\``])));
    }

    out.push('## Decisions required before `--apply`\n');
    const decisions = [];
    for (const [id, d] of Object.entries(derived.layers)) {
        if (!d.complete) decisions.push(`Layer ${id}: derivation incomplete (${d.warnings.join('; ')}). Supply a reviewed mapping by hand.`);
        if (!d.trainable) decisions.push(`Layer ${id}: no position-quality field. Under the strict policy all records are \`unknown\` and none can be used for training. Approve a layer default or leave it out.`);
        if (d.evidence.hoardType.needsReview) decisions.push(`Layer ${id}: \`hoard_type\` = \`${d.mapping.hoardType}\` is proposed from the layer description, not from a field.`);
        if (d.mapping.dateBasis === 'tpq') decisions.push(`Layer ${id}: date basis \`tpq\` — a TPQ is a *terminus post quem*, i.e. a lower bound for the burial, not a deposit interval.`);
    }
    decisions.push(`Duplicate threshold ${duplicates.proposal.distanceM} m / ${duplicates.proposal.nameSimilarity} similarity — accept or change.`);
    decisions.push('Position policy: `proposed` treats "no field says otherwise" as exact; `strict` treats it as unknown. Only one of them can be active.');
    decisions.push('Nothing is deleted on import: records that disappear upstream stay in the table (snapshot retirement policy still pending).');
    out.push(decisions.map(d => `- ${d}`).join('\n') + '\n');

    out.push('## Not verified\n');
    out.push([
        '- This report was produced offline from your capture; it makes no network calls and touches no database.',
        '- Row counts are capture counts. They are not a live service count unless the capture is complete for every layer.',
        '- Quality-code meanings are inferred from the values and marked per combination; DARMC publishes no codebook in the capture.',
        '- Licence/attribution for reusing DARMC data is still an open question and is not asserted anywhere in these files.'
    ].join('\n') + '\n');
    return out.join('\n');
}
