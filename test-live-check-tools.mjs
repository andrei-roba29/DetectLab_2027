/**
 * Static contract for the two live-check pages.
 * They are the only way to settle what the sandbox cannot reach, so they must
 * stay dependency-free, store nothing, and never pretend to reach a local service.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let checks = 0;
const ok = (label, cond, extra) => { checks++; assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); };

const pages = {
    'tools/live-check/hoards-150km.html': fs.readFileSync(path.join(here, 'tools/live-check/hoards-150km.html'), 'utf8'),
    'tools/live-check/ariadne-probe.html': fs.readFileSync(path.join(here, 'tools/live-check/ariadne-probe.html'), 'utf8')
};

for (const [file, html] of Object.entries(pages)) {
    ok(`${file} is a complete document`, /^<!DOCTYPE html>/i.test(html.trim()) && /<\/html>\s*$/.test(html.trim()));
    ok(`${file} loads no external script`, !/<script[^>]+src=/i.test(html));
    ok(`${file} loads no external stylesheet`, !/<link[^>]+rel=["']?stylesheet/i.test(html));
    ok(`${file} stores nothing`, !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(html));
    ok(`${file} never calls a local service`, !/localhost|127\.0\.0\.1|\[::1\]/.test(html));
    ok(`${file} has a copy button`, /Copy report/.test(html) && /clipboard/.test(html));
    ok(`${file} emits a JSON report`, /JSON\.stringify\(report/.test(html));
}

const hoards = pages['tools/live-check/hoards-150km.html'];
ok('the hoards page queries all seven DARMC layers', /\[8, 9, 10, 11, 12, 15, 16\]/.test(hoards));
ok('it measures counts and response sizes', /returnCountOnly/.test(hoards) && /bytes:/.test(hoards));
ok('it flags transfer-limit truncation', /exceededTransferLimit/.test(hoards));
ok('it labels calculated numbers as calculated', /Calculated, not measured/.test(hoards) && /calculated:/.test(hoards));
ok('it sends an envelope in EPSG:4326', /esriGeometryEnvelope/.test(hoards) && /outSR: '4326'/.test(hoards));

const ariadne = pages['tools/live-check/ariadne-probe.html'];
ok('the ariadne page probes both paths', /direct:/.test(ariadne) && /viaFunction:/.test(ariadne));
ok('it distinguishes CORS from HTTP failure', /corsLikely/.test(ariadne) && /no answer \(CORS or unreachable\)/.test(ariadne));
ok('it exposes the query body for correction', /id="body"/.test(ariadne));
ok('it states that the query body is unverified', /UNVERIFIED/.test(ariadne));
ok('it says a 502/504 is the server reachability answer', /could not reach the host/.test(ariadne));
ok('it does not embed a key', !/eyJhbGciOi/.test(ariadne));

const readme = fs.readFileSync(path.join(here, 'tools/live-check/README.md'), 'utf8');
ok('the readme says what the pages cannot prove', /cannot tell you/i.test(readme));
ok('the readme lists the report fields', /viaFunction\.outcome/.test(readme));

console.log(`PASS live-check tools (${checks} checks): both pages are dependency-free, store nothing, never touch a local service, emit a copyable JSON report; the hoards page measures counts, bytes, latency and truncation and labels arithmetic as calculated; the Ariadne probe distinguishes CORS from HTTP failure and exposes the unverified query body. Running them — and therefore all live behaviour — is still yours to do.`);
