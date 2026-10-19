import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../functions/delete-company/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const owner = '11111111-1111-4111-8111-111111111111';
const company = '22222222-2222-4222-8222-222222222222';
const employee = '33333333-3333-4333-8333-333333333333';
let handler, beginError = null, authError = null, removeError = null, calls = [], batches = [];
const admin = {
  auth: { getUser: async () => ({ data: { user: { id: owner } }, error: authError }), admin: { deleteUser: async id => { calls.push(['deleteUser', id]); return {}; } } },
  storage: { from: bucket => ({ remove: async names => { calls.push(['remove', bucket, names]); return { error: removeError }; } }) },
  rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'begin_company_deletion') return { error: beginError };
    if (name === 'company_deletion_status') return { data: null };
    return { data: batches.shift() };
  }
};
vm.runInNewContext(source, { URL, Response, Date, Map, console: { error() {} }, Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } }, createClient: () => admin });
const request = (body, token = true) => new Request('https://example.invalid/delete-company', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body) });
assert.equal((await handler(request({}, false))).status, 401);
assert.equal((await handler(request({ companyId: company, confirmation: 'удалить' }))).status, 400);
assert.equal(calls.length, 0, 'Wrong confirmation must not create a deletion job');
authError = { message: 'Expired' };
assert.equal((await handler(request({ companyId: company, confirmation: 'УДАЛИТЬ' }))).status, 401);
authError = null; beginError = { code: '42501' };
assert.equal((await handler(request({ companyId: company, confirmation: 'УДАЛИТЬ', actor: employee }))).status, 403);
assert.equal(calls[0][1].p_actor, owner, 'Browser actor must not be trusted');
assert.equal(calls.some(c => c[0] === 'deleteUser'), false);
beginError = null; calls = [];
batches = [{ phase: 'photos', photos: [{ bucket_id: 'equipment-photos', name: company + '/fixture.jpg' }] }, { phase: 'accounts', users: [employee], final: false }, { phase: 'accounts', users: [owner], final: true }];
let result = await handler(request({ companyId: company, confirmation: 'УДАЛИТЬ' }));
assert.equal(result.status, 200); assert.equal((await result.json()).complete, true);
const removeIndex = calls.findIndex(c => c[0] === 'remove');
assert.ok(removeIndex >= 0 && removeIndex < calls.findIndex(c => c[0] === 'deleteUser'));
assert.equal(calls.filter(c => c[0] === 'deleteUser').at(-1)[1], owner);
calls = []; removeError = { code: 'StorageUnavailable' };
batches = [{ phase: 'photos', photos: [{ bucket_id: 'equipment-photos', name: company + '/fixture.jpg' }] }];
result = await handler(request({ companyId: company, confirmation: 'УДАЛИТЬ' }));
assert.equal(result.status, 503); assert.equal((await result.json()).pending, true);
assert.equal(calls.some(c => c[0] === 'deleteUser'), false, 'Storage failure must stop account deletion');
console.log('PASS: delete-company authentication, literal confirmation, stored actor, owner-only access, files-before-accounts and resumable failure');
