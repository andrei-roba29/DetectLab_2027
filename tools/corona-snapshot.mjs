/*
 * tools/corona-snapshot.mjs
 * ───────────────────────────────────────────────────────────────────────────
 * The one question the CORONA snapshot machinery has to answer correctly:
 * "is this file worth publishing?"
 *
 * Extracted from tools/cloudflare-build.mjs so it can be imported and tested on
 * its own — importing that script would run a whole three-step build. It is a
 * Cloudflare-only file: nothing in netlify/, netlify.toml or the frontend reads
 * it, and the Netlify pipeline keeps running
 * `node tools/build-corona-europe-catalog.mjs || true` exactly as before.
 *
 * Why "worth publishing" is not just JSON.parse():
 *   buildCatalogPayload() (netlify/lib/corona-catalog.mjs) returns
 *   `{ source, generated, bbox, passes, frames, blocks }`, and slimCatalog()
 *   drops every product whose extent does not intersect the bbox. So an upstream
 *   that answers 200 with an empty object, a reshaped payload or a page of HTML
 *   would yield a file that PARSES and carries `blocks: []`. Publishing that
 *   would blank the CORONA layer for every visitor while the build reported
 *   success. A snapshot is therefore only ever replaced by, or served as, a
 *   catalogue with real entries.
 */
import fs from 'node:fs';

/**
 * @param {string} file  absolute path to a catalogue JSON file
 * @returns {{ok: boolean, reason: string, bytes: number, passes: number, frames: number, blocks: number}}
 *          `ok` is true only for a file that parses AND has at least one block.
 *          `reason` explains a rejection in one clause, for the build log.
 */
export function readCatalogue(file) {
    const none = { ok: false, reason: '', bytes: 0, passes: 0, frames: 0, blocks: 0 };
    if (!fs.existsSync(file)) return { ...none, reason: 'absent' };

    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (err) { return { ...none, reason: 'unreadable: ' + String(err.message || err) }; }

    let payload;
    try { payload = JSON.parse(raw); }
    catch (err) { return { ...none, bytes: raw.length, reason: 'not valid JSON: ' + String(err.message || err) }; }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ...none, bytes: raw.length, reason: 'valid JSON but not an object' };
    }
    if (!Array.isArray(payload.blocks)) {
        return { ...none, bytes: raw.length, reason: 'valid JSON but has no blocks[] array' };
    }

    const passes = Number(payload.passes) || 0;
    const frames = Number(payload.frames) || 0;
    if (payload.blocks.length === 0) {
        return { ...none, bytes: raw.length, passes, frames, blocks: 0, reason: 'parses but contains 0 blocks' };
    }
    return { ok: true, reason: '', bytes: raw.length, passes, frames, blocks: payload.blocks.length };
}

/**
 * Publish `from` at `to`, but only when `from` is a catalogue with real entries.
 * `to` is never truncated, removed or replaced by something worse: on rejection
 * it is left byte-for-byte as it was.
 *
 * @returns {{published: boolean, reason: string, source: object, target: object}}
 */
export function publishCatalogue(from, to) {
    const source = readCatalogue(from);
    const target = readCatalogue(to);
    if (!source.ok) return { published: false, reason: source.reason, source, target };
    fs.copyFileSync(from, to);
    return { published: true, reason: '', source, target: readCatalogue(to) };
}
