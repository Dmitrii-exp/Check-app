import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, timingSafeEqual } from 'node:crypto';

const source = fs.readFileSync(new URL('../functions/robokassa-result/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '');
const calls = [];
let handler;
let rpcError = null;
vm.runInNewContext(source, {
  createHash, timingSafeEqual, Buffer, URL, URLSearchParams, BigInt, Response,
  console: { error() {} },
  Deno: { env: { get: key => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture', ROBOKASSA_PASSWORD_2: 'live-fixture', ROBOKASSA_TEST_PASSWORD_2: 'test-fixture' })[key] }, serve: callback => { handler = callback; } },
  createClient: () => ({ rpc: async (name, args) => { calls.push({ name, ...args }); return { error: rpcError }; } })
});
function notification(secret = 'live-fixture', extra = {}) {
  const values = { OutSum: '490.000000', InvId: '1234', ...extra };
  const shp = Object.entries(values).filter(([key]) => key.startsWith('Shp_')).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => key + '=' + value);
  values.SignatureValue = createHash('md5').update([values.OutSum, values.InvId, secret, ...shp].join(':')).digest('hex');
  return new URLSearchParams(values);
}
const request = body => new Request('https://example.invalid/result', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
let response = await handler(request(notification()));
assert.equal(response.status, 200);
assert.equal(await response.text(), 'OK1234');
assert.equal(calls[0].name, 'process_verified_robokassa_payment');
assert.equal(calls[0].p_amount, '490.000000');
calls.length = 0;
assert.equal((await handler(request(notification('test-fixture')))).status, 200);
assert.equal(calls.length, 0, 'Test callbacks must not write real entitlements');
assert.equal((await handler(request(notification('forged')))).status, 403);
assert.equal(calls.length, 0);
const changedAmount = notification(); changedAmount.set('OutSum', '1');
assert.equal((await handler(request(changedAmount))).status, 403);
const duplicate = notification(); duplicate.append('InvId', '5678');
assert.equal((await handler(request(duplicate))).status, 400);
const ambiguous = notification(); ambiguous.set('InvoiceID', '5678');
assert.equal((await handler(request(ambiguous))).status, 400);
assert.equal((await handler(request(notification('live-fixture', { OutSum: 'NaN' })))).status, 400);
assert.equal((await handler(request(notification('live-fixture', { InvId: '0' })))).status, 400);
assert.equal(calls.length, 0);
assert.equal((await handler(request(notification('live-fixture', { Shp_company: 'fixture' })))).status, 200);
calls.length = 0;
rpcError = { code: '22023' };
assert.equal((await handler(request(notification()))).status, 400);
rpcError = { code: 'P0002' };
assert.equal((await handler(request(notification()))).status, 404);
rpcError = { code: 'unexpected' };
assert.equal((await handler(request(notification()))).status, 500);
assert.equal((await handler(new Request('https://example.invalid/result', { method: 'DELETE' }))).status, 405);
console.log('PASS: payment callback authentication, amount tampering, test isolation, parameter ambiguity, RPC errors and method checks');
