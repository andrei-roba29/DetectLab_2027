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

function harness(opts = {}) {
  let listener, timer, opened = 0, oauth, exchanged, installed, successes = 0;
  const messages = [];
  const els = { googlePopupHelp: { hidden: true }, googlePopupCode: { value: '' } };
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
    supabaseClient: {auth: { async setSession(tokens) { installed = tokens; return opts.sessionError ? {error: {}} : {data: {session: tokens}}; }}},
    addEventListener(type, fn) { listener = fn; }, removeEventListener() {listener = null;} };
  const context = {window, URL, document: {getElementById: id => els[id]}, Uint8Array, Date,
    setTimeout(fn) {timer = fn; return 1;}, clearTimeout() {timer = null;}};
  vm.runInNewContext(source, context);
  return { window, popup, els, messages, get opened(){return opened;}, get oauth(){return oauth;},
    get exchanged(){return exchanged;}, get installed(){return installed;}, get successes(){return successes;},
    start() {return window.DetectLabGooglePopup.start((msg, type) => messages.push({msg, type}), () => successes++);},
    deliver(event) {if (listener) listener(event);}, expire() {if (timer) timer();} };
}
function callbackHarness(url, withOpener) {
  const elements = {status:{textContent:''}, manual:{hidden:true}, code:{value:''}};
  let timer, listener, sent, replaced;
  const opener = withOpener ? {postMessage(data, origin) {sent={data, origin};}} : null;
  const location = new URL(url);
  const window = {opener, addEventListener(type, fn) {listener=fn;}};
  const context = {window, location, URLSearchParams,
    history:{replaceState(_a, _b, path){replaced=path;}},
    document:{getElementById(id){return elements[id];}}, setTimeout(fn){timer=fn;}};
  vm.runInNewContext(callback.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return {elements, opener, get sent(){return sent;}, get replaced(){return replaced;},
    fire(){timer();}, deliver(event){listener(event);}};
}
async function run() {
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
  assert.equal(h.els.googlePopupHelp.hidden, true);
  assert.equal(h.popup.closed, true);

  h = harness({android:true}); await h.start();
  assert.equal(h.window.DetectLabGooglePopup.isStandalone(), true);
  h.els.googlePopupCode.value = 'manual-code'; h.window.finishGooglePopupCode(); await tick();
  assert.equal(h.exchanged, 'manual-code'); assert.equal(h.successes, 1);
  h = harness(); assert.equal(h.window.DetectLabGooglePopup.isStandalone(), false);
  h = harness({blocked:true, ios:true}); await h.start();
  assert.match(h.messages.at(-1).msg, /blocked/); assert.equal(h.els.googlePopupHelp.hidden, true);
  h = harness({ios:true, startError:true}); await h.start();
  assert.equal(h.popup.closed, true); assert.match(h.messages.at(-1).msg, /Could not open/);
  h = harness({ios:true, exchangeError:true}); await h.start();
  h.els.googlePopupCode.value = 'bad'; h.window.finishGooglePopupCode(); await tick();
  assert.equal(h.successes, 0); assert.equal(h.installed, undefined); assert.match(h.messages.at(-1).msg, /could not be completed/);
  h = harness({ios:true, sessionError:true}); await h.start();
  h.els.googlePopupCode.value = 'bad'; h.window.finishGooglePopupCode(); await tick();
  assert.equal(h.successes, 0); assert.match(h.messages.at(-1).msg, /could not be completed/);
  h = harness({ios:true}); await h.start(); await h.start(); assert.equal(h.opened, 1);
  h.window.cancelGooglePopup(); assert.equal(h.popup.closed, true); assert.equal(h.els.googlePopupHelp.hidden, true);
  h = harness({ios:true}); await h.start(); h.expire(); assert.match(h.messages.at(-1).msg, /expired/);

  h = harness({ios:true}); await h.start();
  const errorNonce = new URL(h.oauth.options.redirectTo).searchParams.get('nonce');
  h.deliver({origin:'https://detectlab.ro', source:h.popup, data:{type:'detectlab-google-callback', nonce:errorNonce, error:true}});
  assert.equal(h.exchanged, undefined); assert.match(h.messages.at(-1).msg, /cancelled or failed/);

  let cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc&code=secret', false);
  assert.equal(cb.replaced, '/google-auth-callback.html'); cb.fire();
  assert.equal(cb.elements.manual.hidden, false); assert.equal(cb.elements.code.value, 'secret');
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc&code=secret', true);
  assert.equal(cb.sent.origin, 'https://detectlab.ro');
  cb.deliver({origin:'https://evil.example', source:cb.opener, data:{type:'detectlab-google-ack',nonce:'abc'}});
  cb.fire(); assert.equal(cb.elements.manual.hidden, false, 'foreign ack rejected');
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc&code=secret', true);
  cb.deliver({origin:'https://detectlab.ro', source:cb.opener, data:{type:'detectlab-google-ack',nonce:'abc'}});
  cb.fire(); assert.equal(cb.elements.manual.hidden, true, 'ack avoids showing code');
  cb = callbackHarness('https://detectlab.ro/google-auth-callback.html?nonce=abc#error=access_denied', false);
  cb.fire(); assert.equal(cb.elements.manual.hidden, true); assert.match(cb.elements.status.textContent, /cancelled or failed/);

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
