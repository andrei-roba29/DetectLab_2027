/*!
 * THE upstream call. One function, two modes, chosen by config.transport.
 *
 * Contract (everything else in the provider is transport-agnostic):
 *   call(params, { signal }) → { status, ok, json, bytes, ms, via }
 *   params is the whitelisted query object built by ariadne-query.js.
 *
 * 'browser' : GET <baseUrl><searchPath>?<params>   — needs the host to allow this origin.
 * 'server'  : POST {functionsUrl}{serverPath} {params} — the function builds the URL
 *             from its own configuration and appends its own filter fragments.
 *
 * Calls are serialised and spaced by `minSpacingMs` (default 1500). The server
 * enforces its own spacing as well; the browser mode is the one that needs it here.
 */
(function (root, factory) {
    var api = factory(typeof module === 'object' && module.exports ? require('./ariadne-query.js') : root.DetectLabAriadneQuery);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneUpstream = api;
})(typeof self !== 'undefined' ? self : this, function (query) {
    'use strict';

    function fail(key, message, cause) {
        var e = new Error(message);
        e.key = key;
        if (cause) e.cause = cause;
        return e;
    }

    function create(config, deps) {
        deps = deps || {};
        var fetchImpl = deps.fetch || (typeof fetch === 'function' ? fetch : null);
        if (!fetchImpl) throw fail('ariadne.offline', 'fetch is unavailable in this environment');
        var mode = config.transport === 'browser' ? 'browser' : 'server';
        if (mode === 'browser' && !config.baseUrl) {
            throw fail('ariadne.notConfigured', 'transport is "browser" but config.baseUrl is empty');
        }
        var spacing = typeof config.minSpacingMs === 'number' ? config.minSpacingMs : 0;
        var lastCall = 0;
        var chain = Promise.resolve();

        function schedule(fn) {
            // One call at a time, at least `spacing` ms apart.
            var run = chain.then(function () {
                var wait = Math.max(0, lastCall + spacing - Date.now());
                return wait ? new Promise(function (r) { setTimeout(r, wait); }) : undefined;
            }).then(function () {
                lastCall = Date.now();
                return fn();
            });
            chain = run.catch(function () { });
            return run;
        }

        function timedFetch(url, init, opts) {
            opts = opts || {};
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || config.timeoutMs || 20000);
            if (opts.signal) {
                if (opts.signal.aborted) controller.abort();
                else opts.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
            }
            var started = Date.now();
            return fetchImpl(url, Object.assign({}, init, { signal: controller.signal }))
                .then(function (res) {
                    return res.text().then(function (text) {
                        var json = null, parseError = null;
                        try { json = text ? JSON.parse(text) : null; } catch (e) { parseError = e; }
                        return { status: res.status, ok: res.ok, json: json, bytes: text ? text.length : 0, ms: Date.now() - started, parseError: parseError, via: opts.via };
                    });
                })
                .catch(function (e) {
                    if (e && e.name === 'AbortError') throw fail('ariadne.network', 'ARIADNE request timed out after ' + (opts.timeoutMs || config.timeoutMs) + ' ms');
                    throw fail('ariadne.network', 'ARIADNE request failed: ' + (e && e.message ? e.message : String(e)), e);
                })
                .finally(function () { clearTimeout(timer); });
        }

        function check(result) {
            if (result.ok && !result.parseError) return result;
            if (result.parseError) throw fail('ariadne.http', 'ARIADNE returned a non-JSON body (' + result.status + ', ' + result.bytes + ' bytes)');
            var detail = result.json && (result.json.error || result.json.message);
            var text = 'ARIADNE returned HTTP ' + result.status + (detail ? ': ' + detail : '');
            if (result.status === 429) throw fail('ariadne.rateLimited', text);
            if (result.status === 401 || result.status === 403) throw fail('ariadne.premiumRequired', text);
            throw fail('ariadne.http', text);
        }

        function browserCall(params, opts) {
            var url = query.buildUrl(config.baseUrl, config.searchPath, params);
            return timedFetch(url, { method: 'GET', headers: { Accept: 'application/json' } }, Object.assign({ via: 'browser' }, opts)).then(check);
        }

        function serverCall(params, opts) {
            var base = config.functionsUrl || deps.functionsUrl || '';
            if (!base) throw fail('ariadne.notConfigured', 'transport is "server" but no functions URL is configured');
            var headers = { 'Content-Type': 'application/json' };
            if (deps.anonKey) headers.apikey = deps.anonKey;
            var token = typeof deps.getAccessToken === 'function' ? deps.getAccessToken() : null;
            if (token) headers.Authorization = 'Bearer ' + token;
            var url = String(base).replace(/\/+$/, '') + config.serverPath;
            return timedFetch(url, { method: 'POST', headers: headers, body: JSON.stringify({ params: params }) }, Object.assign({ via: 'server' }, opts)).then(check);
        }

        var impl = mode === 'browser' ? browserCall : serverCall;
        return {
            mode: mode,
            endpoint: mode === 'browser' ? query.buildUrl(config.baseUrl, config.searchPath, {}) : String(config.functionsUrl || deps.functionsUrl || '') + config.serverPath,
            call: function (params, opts) { return schedule(function () { return impl(params, opts); }); }
        };
    }

    return { create: create };
});
