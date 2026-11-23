'use strict';
// Offline regression tests: accelerate deadlines, never contact DEM services.
const assert = require('assert');
const providers = require('./js/apm-next/apm-providers.js');
const pipeline = require('./js/apm-next/apm-pipeline.js');
const realTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => realTimeout(fn, ms >= 10000 ? 20 : ms, ...args);
const originalPlan = providers.demPlan;
const never = () => new Promise(() => {});
const good = { id: 'terrarium', label: 'Terrarium', nominalResM: 30, fetchBlock: () => Promise.resolve(new Float32Array([100, 101])) };
async function main() {
    for (const bodyStalls of [false, true]) {
        let signal;
        providers.setFetch((url, init) => {
            signal = init.signal;
            return bodyStalls ? Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/xml' }, text: never }) : never();
        });
        const dem = providers.createEuDemProvider({ id: 'stalled', version: '1.1', endpoint: 'https://example.com/' + bodyStalls });
        await assert.rejects(dem.discover(), e => e.reason.key === 'reason.timeout');
        assert(signal.aborted);
        console.log('ok: timeout and abort stalled ' + (bodyStalls ? 'body' : 'fetch'));
    }
    providers.demPlan = () => [{ use: true, provider: { ...good, id: 'stalled', fetchBlock: never } }, { use: true, provider: good }];
    const warnings = [];
    const result = await pipeline.pickDemProvider({ lat: 47, lon: 27 }, {}, warnings);
    assert.equal(result.provider.id, 'terrarium');
    assert.equal(result.decision.attempts[0].reason.key, 'reason.timeout');
    assert(warnings.length);
    console.log('ok: stalled probe falls back with diagnostic warning');
    providers.demPlan = () => [{ use: true, provider: { ...good, fetchBlock: never } }];
    await assert.rejects(pipeline.pickDemProvider({ lat: 47, lon: 27 }, {}, []), e => e.key === 'err.noDem' || e.message.includes('No elevation source'));
    console.log('ok: all stalled sources produce error, not endless progress');
    const token = { cancelled: true };
    await assert.rejects(pipeline.pickDemProvider({ lat: 47, lon: 27 }, token, []), pipeline.isCancelled);
    console.log('ok: cancelled run does not try fallback');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
    global.setTimeout = realTimeout;
    providers.demPlan = originalPlan;
});
