'use strict';
// Run with node test-pwa-google-auth.js. Browser/OS handoff still needs devices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/pwa-google-auth.js', 'utf8');
const auth = fs.readFileSync('js/auth.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const callback = fs.readFileSync('google-auth-callback.html', 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const HANDOFF_KEY = 'detectlab-google-handoff';

function store() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    dump: () => Object.fromEntries(values)
  };
}

function harness(opts = {}) {
  let listeners = {}, docListeners = {}, timer, watcher, opened = 0, oauth, exchanged, installed, successes = 0;
  const messages = [];
  const storage = opts.storage || store();
  const popup = { closed: false, location: { replace(url) { this.url = url; } },
    postMessage(data, origin) { this.ack = {data, origin}; }, close() { this.closed = true; } };
  const client = { auth: {
    async signInWithOAuth(args) { oauth = args; return opts.startError ? {error: {}} : {data: {url: 'https://supabase.example/authorize?code_challenge_method=s256&code_challenge=challenge'}}; },
    async exchangeCodeForSession(code) { exchanged = code; return opts.exchangeError ? {error: {}} : {data: {session: {access_token: 'a', refresh_token: 'r'}}}; }
  }};
  const window = { navigator: { standalone: !!opts.ios },
    matchMedia: q => ({matches: !!opts.android && q.includes('standalone')}),
    location: {origin: 'https://detectlab.ro'}, crypto: {subtle:{digest(){}}, getRandomValues(bytes) {bytes.fill(4);}},
    open() { opened++; return opts.blocked ? null : popup; },
    createGooglePopupClient() {return client;},
    localStorage: storage,
    supabaseClient: {auth: { async setSession(tokens) { installed = tokens; return opts.sessionError ? {error: {}} : {data: {session: tokens}}; }}},
    addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; } };
  const document = { hidden: false, getElementById: () => null,
    addEventListener(type, fn) { docListeners[type] = fn; }, removeEventListener(type) { delete docListeners[type]; } };
  const context = {window, document, URL, Uint8Array, Date,
    setTimeout(fn) {timer = fn; return 1;}, clearTimeout() {timer = null;},
    setInterval(fn) {watcher = fn; return 2;}, clearInterval() {watcher = null;}};
  vm.runInNewContext(source, context);
  return { window, document, popup, storage, messages,
    get opened(){return opened;}, get oauth(){return oauth;},
    get exchanged(){return exchanged;}, get installed(){return installed;}, get successes(){return successes;},
    start() {return window.DetectLabGooglePopup.start((msg, type) => messages.push({msg, type}), () => successes++);},
    deliver(event) {if (listeners.message) listeners.message(event);},
    storageEvent(event) {if (listeners.storage) listeners.storage(event);},
    wake() {if (listeners.focus) listeners.focus();},
    pageShow() {if (listeners.pageshow) listeners.pageshow();},
    visible() {document.hidden = false; if (docListeners.visibilitychange) docListeners.visibilitychange();},
    tickWatcher() {if (watcher) watcher();},
    expire() {if (timer) timer();} };
}
function callbackHarness(url, withOpener) {
  const elements = {status:{textContent:''}};
  const timers = [], sent = {count: 0}, storage = store();
  let listener, replaced;
  const opener = withOpener ? {postMessage(data, origin) {sent.data = data; sent.origin = origin; sent.count++;}} : null;
  const location = new URL(url);
  const window = {opener, addEventListener(type, fn) {listener = fn;}, close() {window.closedByPage = true;}};
  const context = {window, location, URLSearchParams, localStorage: storage,
    history:{replaceState(_a, _b, path){replaced=path;}},
    document:{getElementById(id){return elements[id];}},
    setTimeout(fn){timers.push(fn);},
    Date};
  vm.runInNewContext(callback.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return {elements, opener, window, storage, sent,
    get replaced(){return replaced;},
    flush(){while (timers.length) timers.shift()();},
    deliver(event){if (listener) listener(event);}};
}

async function run() {
  // ── The paste-a-code UI is gone from both documents ──
  assert.doesNotMatch(html, /googlePopupHelp|googlePopupCode|finishGooglePopupCode|One-time sign-in code/);
  assert.doesNotMatch(callback, /One-time sign-in code|id="code"|value = code|<textarea/);

  let h = harness({ios:true});
  assert.equal(h.window.DetectLabGooglePopup.isStandalone(), true);
  const start = h.start();
  assert.equal(h.opened, 1, 'popup opened before first await');
  await start;
  assert.equal(h.oauth.options.skipBrowserRedirect, true);
  assert.match(h.oauth.options.redirectTo, /^https:\/\/detectlab\.ro\/google-auth-callback\.html\?nonce=/);
  assert.equal(h.popup.location.url, 'https://supabase.example/authorize?code_challenge_method=s256&code_challenge=challenge');
  const nonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  const data = {type:'detectlab-google-callback', nonce, code:'one-time-code'};
  h.deliver({origin:'https://evil.example', source:h.popup, data});
  h.deliver({origin:'https://detectlab.ro', source:{}, data});
  h.deliver({origin:'https://detectlab.ro', source:h.popup, data:{...data, nonce:'wrong'}});
  assert.equal(h.exchanged, undefined, 'reject unrelated messages');
  h.deliver({origin:'https://detectlab.ro', source:h.popup, data});
  await tick();
  assert.equal(h.exchanged, 'one-time-code');
  assert.equal(h.installed.refresh_token, 'r');
  assert.equal(h.successes, 1);
  assert.equal(h.popup.closed, true);

  // ── Handoff record left by the callback window (opener severed) ──
  h = harness({android:true});
  assert.equal(h.window.DetectLabGooglePopup.isStandalone(), true);
  await h.start();
  let hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.storage.setItem(HANDOFF_KEY, JSON.stringify({nonce:'someone-else', code:'nope', at:Date.now()}));
  h.wake(); await tick();
  assert.equal(h.exchanged, undefined, 'foreign handoff ignored');
  h.storage.setItem(HANDOFF_KEY, JSON.stringify({nonce:hNonce, code:'stored-code', at:Date.now()}));
  h.storageEvent({key: HANDOFF_KEY}); await tick(); await tick();
  assert.equal(h.exchanged, 'stored-code');
  assert.equal(h.successes, 1);
  assert.equal(h.storage.getItem(HANDOFF_KEY), null, 'handoff record consumed');

  // Picked up when the installed app comes back to the front.
  h = harness({ios:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.storage.setItem(HANDOFF_KEY, JSON.stringify({nonce:hNonce, code:'focus-code', at:Date.now()}));
  h.visible(); await tick(); await tick();
  assert.equal(h.exchanged, 'focus-code'); assert.equal(h.successes, 1);
  h = harness({ios:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.storage.setItem(HANDOFF_KEY, JSON.stringify({nonce:hNonce, code:'poll-code', at:Date.now()}));
  h.tickWatcher(); await tick(); await tick();
  assert.equal(h.exchanged, 'poll-code');

  // Expired handoff record is not used.
  h = harness({ios:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.storage.setItem(HANDOFF_KEY, JSON.stringify({nonce:hNonce, code:'old-code', at:Date.now() - 11 * 60 * 1000}));
  h.wake(); await tick();
  assert.equal(h.exchanged, undefined);

  // A cancelled/failed consent ends the attempt without a code.
  h = harness({ios:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.storage.setItem(HANDOFF_KEY, JSON.stringify({nonce:hNonce, error:true, at:Date.now()}));
  h.wake(); await tick();
  assert.equal(h.exchanged, undefined); assert.match(h.messages.at(-1).msg, /cancelled or failed/);
  h = harness({ios:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.deliver({origin:'https://detectlab.ro', source:h.popup, data:{type:'detectlab-google-callback', nonce:hNonce, error:true}});
  assert.equal(h.exchanged, undefined); assert.match(h.messages.at(-1).msg, /cancelled or failed/);

  // ── Failures stay in the form, with nothing to paste ──
  h = harness({blocked:true, ios:true}); await h.start();
  assert.match(h.messages.at(-1).msg, /blocked/);
  h = harness({ios:true, startError:true}); await h.start();
  assert.equal(h.popup.closed, true); assert.match(h.messages.at(-1).msg, /Could not open/);
  h = harness({ios:true, exchangeError:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.deliver({origin:'https://detectlab.ro', source:h.popup, data:{type:'detectlab-google-callback', nonce:hNonce, code:'bad'}});
  await tick();
  assert.equal(h.successes, 0); assert.equal(h.installed, undefined); assert.match(h.messages.at(-1).msg, /could not be completed/);
  h = harness({ios:true, sessionError:true}); await h.start();
  hNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.deliver({origin:'https://detectlab.ro', source:h.popup, data:{type:'detectlab-google-callback', nonce:hNonce, code:'bad'}});
  await tick();
  assert.equal(h.successes, 0); assert.match(h.messages.at(-1).msg, /could not be completed/);

  // One attempt at a time; an abandoned one is replaced after the grace period.
  h = harness({ios:true}); await h.start(); await h.start();
  assert.equal(h.opened, 1); assert.match(h.messages.at(-1).msg, /already in progress/);
  h = harness({ios:true}); await h.start();
  h.window.DetectLabGooglePopup.cancel();
  assert.equal(h.popup.closed, true);
  h = harness({ios:true}); await h.start(); h.expire();
  assert.match(h.messages.at(-1).msg, /expired/);

  // ── Callback window ──
  let cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc&code=secret', false);
  assert.equal(cb.replaced, '/google-auth-callback.html');
  const stored = JSON.parse(cb.storage.getItem(HANDOFF_KEY));
  assert.equal(stored.nonce, 'abc'); assert.equal(stored.code, 'secret');
  cb.flush();
  assert.match(cb.elements.status.textContent, /Return to DetectLab/);
  assert.equal(cb.window.closedByPage, true, 'closing is attempted');
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc&code=secret', true);
  assert.equal(cb.sent.origin, 'https://detectlab.ro');
  assert.equal(cb.sent.data.type, 'detectlab-google-callback');
  cb.deliver({origin:'https://evil.example', source:cb.opener, data:{type:'detectlab-google-ack',nonce:'abc'}});
  cb.flush();
  assert.match(cb.elements.status.textContent, /Sign-in finished/);
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc&code=secret', true);
  cb.deliver({origin:'https://detectlab.ro', source:cb.opener, data:{type:'detectlab-google-ack',nonce:'abc'}});
  cb.flush();
  assert.match(cb.elements.status.textContent, /Signed in/);
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc#error=access_denied', false);
  assert.equal(JSON.parse(cb.storage.getItem(HANDOFF_KEY)).error, true);
  cb.flush();
  assert.match(cb.elements.status.textContent, /cancelled or failed/);
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html', false);
  cb.flush();
  assert.match(cb.elements.status.textContent, /No sign-in result/);
  assert.equal(cb.storage.getItem(HANDOFF_KEY), null);

  // ── Wiring ──
  assert.match(auth, /provider === 'google' && window\.DetectLabGooglePopup/);
  assert.match(auth, /auth\.signInWithOAuth\(\{/); // ordinary browser path remains
  assert.match(auth, /signInWithPassword\(/);
  assert.match(html, /js\/pwa-google-auth\.js\?v=/);
  assert.match(sw, /pathname === '\/google-auth-callback\.html'\) return/);
  assert.match(callback, /history\.replaceState\(null, '', location\.pathname\)/);
  assert.match(callback, /event\.origin !== location\.origin/);
  console.log('Google PWA OAuth regression tests passed');
}
run().catch(err => {console.error(err); process.exitCode = 1;});
