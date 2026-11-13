/*
 * functions/_lib/runtime-shims.js
 * ───────────────────────────────────────────────────────────────────────────
 * The ONLY runtime-compatibility layer between the existing Netlify/Express
 * server code and the Cloudflare Workers runtime.
 *
 * It exists so that the business logic does not have to be forked: seven of the
 * nine migrated handlers are imported verbatim from netlify/functions/ and
 * backend/src/lib/, and those files were written for Node. They use exactly two
 * things the Workers runtime does not guarantee:
 *
 *   1. `process.env.X`   — the migrated code reads its credentials from
 *                          process.env. Cloudflare Pages Functions hand
 *                          bindings to the handler as `context.env`, and this
 *                          project must (and does) read secrets from there.
 *                          bindEnv() points process.env at context.env, so the
 *                          shared libraries keep working unchanged and no
 *                          credential is ever duplicated into new code.
 *
 *   2. `Buffer`          — used as `Buffer.from(await r.arrayBuffer())`,
 *                          `Buffer.concat(chunks).toString('utf8')`,
 *                          `buf.toString('utf8', 0, 2000)` and
 *                          `Buffer.from(user + ':' + pass, 'utf8').toString('base64')`.
 *                          wrangler 4.161 / workerd 2026-11-10 already ship a
 *                          working Buffer without `nodejs_compat` (verified
 *                          live), so the ambient one is kept when it passes
 *                          SELF_CHECK below and a minimal native-Web-API
 *                          polyfill is installed only if it does not. This is a
 *                          guard against a future runtime that stubs Buffer out
 *                          with "not implemented", not a dependency on one.
 *
 * This module is imported for its side effects FIRST by every Cloudflare
 * function and by the generated modules, because ESM evaluates imports in
 * source order and netlify/lib/map3d-tile.mjs builds its blank-PNG constant
 * with Buffer.from(…, 'base64') at module-evaluation time.
 *
 * `nodejs_compat` is deliberately NOT enabled anywhere in this project: the
 * only Node APIs the migrated code needs are the two above, and both are
 * covered here with Web APIs. See CLOUDFLARE_MIGRATION.md §4.
 */

/* ── base64 / hex on top of atob, btoa and TextEncoder ───────────────────── */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value).replace(/[\s=]+$/g, '').replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function hexToBytes(value) {
    const text = String(value).replace(/^0x/i, '');
    const bytes = new Uint8Array(Math.floor(text.length / 2));
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.substr(i * 2, 2), 16);
    return bytes;
}

function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

/* ── the polyfill, used only when the ambient Buffer is not usable ────────── */

function decode(buffer, encoding, start, end) {
    const from = Math.max(0, start | 0);
    const to = end === undefined ? buffer.length : Math.min(buffer.length, Math.max(from, end | 0));
    const view = buffer.subarray(from, to);
    switch (String(encoding || 'utf8').toLowerCase().replace('-', '')) {
        case 'base64': return bytesToBase64(view);
        case 'hex': return bytesToHex(view);
        case 'latin1':
        case 'binary': {
            let out = '';
            for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i]);
            return out;
        }
        case 'utf8':
        case 'utf-8':
        default: return textDecoder.decode(view);
    }
}

class PolyfillBuffer extends Uint8Array {
    toString(encoding = 'utf8', start = 0, end = this.length) {
        return decode(this, encoding, start, end);
    }
    /* Only what the migrated DetectLab code actually calls. */
    static from(value, encoding = 'utf8') {
        if (typeof value === 'string') {
            switch (String(encoding).toLowerCase()) {
                case 'base64': return new PolyfillBuffer(base64ToBytes(value));
                case 'hex': return new PolyfillBuffer(hexToBytes(value));
                case 'latin1':
                case 'binary': {
                    const bytes = new Uint8Array(value.length);
                    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
                    return new PolyfillBuffer(bytes);
                }
                default: return new PolyfillBuffer(textEncoder.encode(value));
            }
        }
        if (value instanceof ArrayBuffer) return new PolyfillBuffer(value);          // a view, like Node
        if (ArrayBuffer.isView(value)) return PolyfillBuffer.from(                   // a copy, like Node
            new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
        if (Array.isArray(value)) return new PolyfillBuffer(Uint8Array.from(value));
        throw new TypeError('unsupported Buffer.from() input');
    }
    static concat(list, totalLength) {
        const parts = list.map((b) => new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength || b.length));
        const size = totalLength !== undefined ? totalLength : parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(size);
        let at = 0;
        for (const part of parts) {
            if (at >= size) break;
            out.set(part.subarray(0, size - at), at);
            at += part.length;
        }
        return new PolyfillBuffer(out.buffer);
    }
    static alloc(size, fill = 0) {
        const out = new Uint8Array(size);
        if (fill) out.fill(fill);
        return new PolyfillBuffer(out.buffer);
    }
    static isBuffer(value) { return value instanceof PolyfillBuffer; }
    static byteLength(value, encoding = 'utf8') {
        if (typeof value !== 'string') return value.length;
        return PolyfillBuffer.from(value, encoding).length;
    }
}

/* ── the self-check: exactly the operations the migrated code performs ────── */

function selfCheck(BufferImpl) {
    try {
        if (typeof BufferImpl !== 'function' || typeof BufferImpl.from !== 'function') return 'missing';
        if (typeof BufferImpl.concat !== 'function') return 'no-concat';

        /* Buffer.from(await response.arrayBuffer()) → usable as a Response body */
        const fromAb = BufferImpl.from(new Uint8Array([1, 2, 3]).buffer);
        if (fromAb.length !== 3 || fromAb[1] !== 2) return 'from-arraybuffer';

        /* Buffer.from(chunk) inside a stream reader (asig-heritage) */
        const fromBytes = BufferImpl.from(new Uint8Array([7, 8]));
        if (fromBytes.length !== 2 || fromBytes[0] !== 7) return 'from-bytes';

        /* Buffer.concat(chunks).toString('utf8') */
        const joined = BufferImpl.concat([
            BufferImpl.from(new Uint8Array([0x7b, 0x22])),   /* {" */
            BufferImpl.from(new Uint8Array([0x61, 0x7d]))    /* a} */
        ]).toString('utf8');
        if (joined !== '{"a}') return 'concat-tostring:' + joined;

        /* body.toString('utf8', 0, 2000) — OGC exception sniffing */
        const text = BufferImpl.from(new TextEncoder().encode('hello world'));
        if (text.toString('utf8', 0, 5) !== 'hello') return 'tostring-slice';

        /* Basic auth for Lantmäteriet */
        if (BufferImpl.from('user:pass', 'utf8').toString('base64') !== 'dXNlcjpwYXNz') return 'base64-encode';

        /* The 1×1 transparent PNG constant in netlify/lib/map3d-tile.mjs */
        const png = BufferImpl.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg==',
            'base64');
        if (png.length !== 70 || png[0] !== 0x89 || png[1] !== 0x50) return 'base64-decode';

        return null;
    } catch (err) {
        return String((err && err.message) || err).slice(0, 80);
    }
}

/* ── process.env ← context.env ───────────────────────────────────────────── */

/* Every variable the migrated handlers read. Used only as a fallback when the
 * runtime's own `process.env` cannot be rebound; the authoritative list lives
 * in CLOUDFLARE_MIGRATION.md §5. */
export const KNOWN_ENV_VARS = [
    'DATAFORSYNINGEN_TOKEN',
    'DATAFORDELER_USERNAME',
    'DATAFORDELER_USER',
    'DATAFORDELER_PASSWORD',
    'DANISH_PROXY_ALLOWED_ORIGINS',
    'LANTMATERIET_WMS_USER',
    'LANTMATERIET_WMS_PASSWORD',
    'LANTMATERIET_WMS_TOKEN',
    'LANTMATERIET_WMS_URL',
    'MML_API_KEY',
    'FINLAND_PROXY_ALLOWED_ORIGINS'
];

/**
 * A live view of `context.env`. Cloudflare's env object is a proxy whose keys
 * are not always enumerable, so the bindings are read through a trap instead of
 * being copied — a secret is never materialised into a plain object any earlier
 * than the shared library reads it.
 */
function envView(env) {
    return new Proxy(Object.create(null), {
        get(_target, prop) { return typeof prop === 'string' ? env[prop] : undefined; },
        has(_target, prop) { return typeof prop === 'string' && env[prop] !== undefined; },
        set(_target, prop, value) { return typeof prop === 'string' ? (env[prop] = value, true) : false; },
        ownKeys() { try { return Reflect.ownKeys(env); } catch { return []; } },
        getOwnPropertyDescriptor(_target, prop) {
            const value = typeof prop === 'string' ? env[prop] : undefined;
            return value === undefined ? undefined : { value, enumerable: true, configurable: true };
        }
    });
}

/**
 * Point `process.env` at the Pages Function bindings for this request.
 * Idempotent, and safe to call on every request: all requests in an isolate see
 * the same deployment bindings, so there is no per-request value to race on.
 */
export function bindEnv(env) {
    const proc = (globalThis.process && typeof globalThis.process === 'object')
        ? globalThis.process
        : (globalThis.process = {});
    if (!env) return proc;

    const view = envView(env);
    try {
        Object.defineProperty(proc, 'env', { value: view, writable: true, enumerable: true, configurable: true });
    } catch {
        try { proc.env = view; } catch { /* fall through to the per-key copy */ }
    }
    if (proc.env === view) return proc;

    /* The runtime refused to hand over process.env — copy the known variables
     * across individually so the shared libraries still find their credentials. */
    if (!proc.env || typeof proc.env !== 'object') {
        try { Object.defineProperty(proc, 'env', { value: {}, writable: true, configurable: true, enumerable: true }); } catch { /* nothing more to try */ }
    }
    for (const name of KNOWN_ENV_VARS) {
        const value = env[name];
        if (value !== undefined) { try { proc.env[name] = value; } catch { /* read-only: give up on this name */ } }
    }
    return proc;
}

/* ── installation ────────────────────────────────────────────────────────── */

/** Which Buffer implementation is in force — reported by the smoke route. */
export const bufferStatus = { source: 'unset', reason: '' };

/**
 * Environment-independent half of the shim. Safe (and required) to run at
 * module-evaluation time, before any handler has a `context`.
 */
export function ensureGlobals() {
    if (globalThis.process === undefined || globalThis.process === null) globalThis.process = {};
    if (!globalThis.process.env || typeof globalThis.process.env !== 'object') {
        try {
            Object.defineProperty(globalThis.process, 'env', { value: {}, writable: true, configurable: true, enumerable: true });
        } catch { /* the runtime provides its own */ }
    }

    const reason = selfCheck(globalThis.Buffer);
    if (reason === null) {
        bufferStatus.source = 'runtime';
        bufferStatus.reason = 'the Workers runtime provides a working Buffer';
    } else {
        globalThis.Buffer = PolyfillBuffer;
        bufferStatus.source = 'polyfill';
        bufferStatus.reason = 'the ambient Buffer failed the self-check: ' + reason;
    }
    return globalThis.Buffer;
}

/** The whole shim: globals + this request's bindings. Call it in onRequest. */
export function installRuntimeShims(env) {
    ensureGlobals();
    bindEnv(env);
    return { Buffer: globalThis.Buffer, process: globalThis.process, bufferStatus };
}

/* Side effect: this module is imported first by every Cloudflare function and
 * by the generated modules, so the globals exist before anything else is
 * evaluated. */
ensureGlobals();
