/*!
 * THE upstream call. One function, two modes, chosen by config.transport.
 *
 * Contract (everything above this line is transport-agnostic):
 *   call({ path, method, body }, { signal }) → { status, ok, json, bytes, ms, via }
 *   on failure → throws Error with .key = 'ariadne.offline' | 'ariadne.network' | 'ariadne.http'
 *
 * 'server'  : POST {path, method, body} to the Supabase edge function, which holds the
 *             upstream URL and does the request. No browser CORS requirement.
 * 'browser' : the same request straight to the ARIADNE host. Requires that host to
 *             allow this origin.
 *
 * If the switch is wrong for the deployment, exactly one line of behaviour changes and
 * the rest of the provider (tiling, paging, parsing, caching, records) is untouched.
 */
(function (root, factory) {
    var api = factory(typeof module === 'object' && module.exports ? null : root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneUpstream = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
    'use strict';

    function fail(key, message, cause) {
        var e = new Error(message);
        e.key = key;
        if (cause) e.cause = cause;
        return e;
    }

    function joinUrl(base, path) {
        if (!base) return '';
        return String(base).replace(/\/+$/, '') + (path || '');
    }

    function create(config, deps) {
        deps = deps || {};
        var fetchImpl = deps.fetch || (typeof fetch === 'function' ? fetch : null);
        if (!fetchImpl) throw fail('ariadne.offline', 'fetch is unavailable in this environment');
        var mode = config.transport === 'browser' ? 'browser' : 'server';

        if (mode === 'browser' && !config.baseUrl) {
            throw fail('ariadne.notConfigured', 'transport is "browser" but config.baseUrl is empty; the ARIADNE search endpoint must be set explicitly');
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
                        var ms = Date.now() - started;
                        var json = null, parseError = null;
                        try { json = text ? JSON.parse(text) : null; } catch (e) { parseError = e; }
                        return {
                            status: res.status,
                            ok: res.ok,
                            json: json,
                            bytes: text ? text.length : 0,
                            ms: ms,
                            parseError: parseError,
                            via: opts.via
                        };
                    });
                })
                .catch(function (e) {
                    if (e && e.name === 'AbortError') throw fail('ariadne.network', 'ARIADNE request timed out after ' + (opts.timeoutMs || config.timeoutMs) + ' ms');
                    throw fail('ariadne.network', 'ARIADNE request failed: ' + (e && e.message ? e.message : String(e)), e);
                })
                .finally(function () { clearTimeout(timer); });
        }

        function serverCall(request, opts) {
            var base = config.functionsUrl || deps.functionsUrl || '';
            if (!base) throw fail('ariadne.notConfigured', 'transport is "server" but no functions URL is configured');
            var headers = { 'Content-Type': 'application/json' };
            if (deps.anonKey) headers.apikey = deps.anonKey;
            var token = typeof deps.getAccessToken === 'function' ? deps.getAccessToken() : null;
            if (token) headers.Authorization = 'Bearer ' + token;
            return timedFetch(joinUrl(base, config.serverPath), {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ path: request.path, method: request.method || 'POST', body: request.body || null })
            }, Object.assign({ via: 'server' }, opts)).then(check);
        }

        function browserCall(request, opts) {
            var headers = { 'Content-Type': 'application/json' };
            if (deps.apiKey && !/ariadne/i.test(String(config.baseUrl))) headers['X-Api-Key'] = deps.apiKey;
            return timedFetch(joinUrl(config.baseUrl, request.path), {
                method: request.method || 'POST',
                headers: headers,
                body: request.body == null ? undefined : JSON.stringify(request.body)
            }, Object.assign({ via: 'browser' }, opts)).then(check);
        }

        function check(result) {
            if (!result.parseError && result.ok) return result;
            if (result.parseError) throw fail('ariadne.http', 'ARIADNE returned a non-JSON body (' + result.status + ', ' + result.bytes + ' bytes)');
            var detail = result.json && (result.json.error || result.json.message);
            throw fail('ariadne.http', 'ARIADNE returned HTTP ' + result.status + (detail ? ': ' + detail : ''));
        }

        return {
            mode: mode,
            endpoint: mode === 'server' ? joinUrl(config.functionsUrl || deps.functionsUrl || '', config.serverPath) : joinUrl(config.baseUrl, ''),
            call: mode === 'server' ? serverCall : browserCall
        };
    }

    return { create: create };
});
