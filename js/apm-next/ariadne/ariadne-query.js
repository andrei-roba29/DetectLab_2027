/*!
 * The request: a GET on /api/search with URL parameters.
 *
 * Verified order and names:
 *   forceReload=true & mapq=true & q= & bbox=<N>,<W>,<S>,<E> & loadingStatus=2
 *   & sort=distance & order=asc
 * then the captured filter fragments, appended at the end.
 *
 * Two kinds of fragment, both captured in the portal and neither guessed:
 *   · a fixed one, e.g. the "What = Site/monument" slice;
 *   · a period template containing {P}, e.g. "&when={P}", where the portal's own
 *     period label is substituted (and URL-encoded) for each request of a sweep.
 *
 * The browser sends only whitelisted values. The server rebuilds the URL from its
 * own configured base address and appends its own filter fragments, so a client
 * can never point the proxy at another host or smuggle extra parameters.
 */
(function (root, factory) {
    var api = factory(typeof module === 'object' && module.exports ? require('./ariadne-tiles.js') : root.DetectLabAriadneTiles);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DetectLabAriadneQuery = api;
})(typeof self !== 'undefined' ? self : this, function (tiles) {
    'use strict';

    /** The only parameters a client may send. Everything else is server-side. */
    var WHITELIST = ['forceReload', 'mapq', 'q', 'loadingStatus', 'sort', 'order', 'bbox'];
    var ORDER = ['forceReload', 'mapq', 'q', 'bbox', 'loadingStatus', 'sort', 'order'];

    function normaliseFragment(fragment) {
        return String(fragment || '').trim().replace(/^[?&]+/, '');
    }

    // A capture may arrive raw ("Site/monument") or already escaped ("Site%2Fmonument").
    // Either way the value is decoded once here, because toQueryString escapes it once.
    function decodeValue(value) {
        try { return decodeURIComponent(String(value)); } catch (e) { return String(value); }
    }

    /** The period fragment is a template when it carries the {P} placeholder. */
    function isPeriodTemplate(fragment) {
        return normaliseFragment(fragment).indexOf('{P}') >= 0;
    }

    // The label is inserted raw: buildParams turns the fragment into a parameter and
    // toQueryString encodes it exactly once. Encoding here as well would double-encode
    // the spaces in labels such as "epoca bronzului".
    function substitutePeriod(fragment, label) {
        return normaliseFragment(fragment).split('{P}').join(String(label));
    }

    /** True only when every filter the positive role needs has been captured. */
    function filtersConfigured(config, required) {
        var keys = required || ['siteType', 'period'];
        var filters = (config && config.filters) || {};
        return keys.every(function (k) { return normaliseFragment(filters[k]).length > 0; });
    }

    /**
     * Build the query parameters for a bbox.
     * @returns {object} parameters in the verified order, filters last
     */
    function buildParams(config, opts) {
        opts = opts || {};
        var body = config.baseParams || {};
        var params = {};
        for (var i = 0; i < ORDER.length; i++) {
            var key = ORDER[i];
            if (key === 'bbox') {
                if (!opts.box) throw new Error('buildParams requires a box');
                params.bbox = tiles.bboxString(opts.box);
            } else if (body[key] != null) {
                params[key] = String(body[key]);
            }
        }
        var source = opts.filters || config.filters || {};
        var order = opts.filterOrder || ['siteType', 'period'];
        for (var j = 0; j < order.length; j++) {
            var fragment = normaliseFragment(source[order[j]]);
            if (!fragment) continue;
            // A period template is only usable with a label; without one the request
            // stays a baseline (all periods) rather than asking for the literal "{P}".
            if (fragment.indexOf('{P}') >= 0) {
                if (!opts.period) continue;
                fragment = substitutePeriod(fragment, opts.period);
            }
            // A fragment is a raw slice of query string, captured in the portal.
            var eq = fragment.indexOf('=');
            if (eq > 0) params[decodeValue(fragment.slice(0, eq))] = decodeValue(fragment.slice(eq + 1));
            else params[decodeValue(fragment)] = '';
        }
        return params;
    }

    function toQueryString(params) {
        return Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
    }

    function buildUrl(baseUrl, searchPath, params) {
        return String(baseUrl || '').replace(/\/+$/, '') + (searchPath || '/api/search') + '?' + toQueryString(params);
    }

    /** Server side: keep the whitelist, drop everything else without repairing it. */
    function whitelist(params) {
        var out = {}, rejected = [];
        Object.keys(params || {}).forEach(function (k) {
            if (WHITELIST.indexOf(k) >= 0) out[k] = String(params[k]);
            else rejected.push(k);
        });
        return { params: out, rejected: rejected };
    }

    return { buildParams: buildParams, toQueryString: toQueryString, buildUrl: buildUrl, whitelist: whitelist, filtersConfigured: filtersConfigured,
        normaliseFragment: normaliseFragment, isPeriodTemplate: isPeriodTemplate, substitutePeriod: substitutePeriod, decodeValue: decodeValue,
        WHITELIST: WHITELIST, ORDER: ORDER };
});
