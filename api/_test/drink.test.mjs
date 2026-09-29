// Local checks for api/drink.js with Beehiiv mocked out.
// Usage: node api/_test/drink.test.mjs  (not deployed: see .vercelignore)
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const SID = 'sub_3f1c2b9a-1d2e-4f50-9a7b-0c1d2e3f4a5b';
const BASE = 'https://api.beehiiv.com/v2/publications/pub_a08ae7d5-54f0-4f5c-8514-7c82012a0c87';
const calls = [];
let fields = []; // the publication's custom fields
let stored = {}; // the subscriber's custom field values
let putStatus = 200;
let putWarnings = [];
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method, body, auth: init.headers && init.headers.Authorization });
  const reply = (status, obj) => new Response(JSON.stringify(obj), { status });
  if (url === BASE + '/custom_fields?limit=100' && method === 'GET') return reply(200, { data: fields });
  if (url === BASE + '/custom_fields' && method === 'POST') {
    fields.push({ id: 'cf_1', kind: body.kind, display: body.display });
    return reply(200, { data: fields[fields.length - 1] });
  }
  if (url === BASE + '/subscriptions/' + SID && method === 'PUT') {
    if (putStatus !== 200) return reply(putStatus, { errors: [{ message: 'nope' }] });
    for (const f of body.custom_fields) stored[f.name] = f.value;
    return reply(200, { data: { id: SID, status: 'active' }, warnings: putWarnings });
  }
  if (url === BASE + '/subscriptions/' + SID + '?expand[]=custom_fields' && method === 'GET') {
    return reply(200, { data: { id: SID, status: 'active',
      custom_fields: Object.entries(stored).map(([name, value]) => ({ name, kind: 'string', value })) } });
  }
  return reply(404, { errors: [{ message: 'unexpected ' + method + ' ' + url }] });
};
process.env.BEEHIIV_API_KEY = 'test-key-not-real';
delete process.env.BEEHIIV_PUBLICATION_ID;

// Fresh module per test so the "field exists" cache starts empty.
const require = createRequire(import.meta.url);
const load = () => {
  delete require.cache[require.resolve('../drink.js')];
  return require('../drink.js');
};
let handler = load();
const server = http.createServer((req, res) => handler(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (obj, method = 'POST') =>
  new Promise((resolve, reject) => {
    const req = http.request(base + '/api/drink', { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (obj) req.write(typeof obj === 'string' ? obj : JSON.stringify(obj));
    req.end();
  });

const results = [];
async function test(name, fn) {
  calls.length = 0;
  fields = [{ id: 'cf_0', kind: 'string', display: 'zip' }, { id: 'cf_9', kind: 'string', display: 'go_to_drink' }];
  stored = {};
  putStatus = 200;
  putWarnings = [];
  process.env.BEEHIIV_API_KEY = 'test-key-not-real';
  handler = load();
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
}

await test('a chip answer is saved on the subscription and read back', async () => {
  const r = await post({ sid: SID, drink: 'Sparkling water' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, field: 'go_to_drink', value: 'Sparkling water', saved: true,
    fields: { go_to_drink: 'Sparkling water' }, status: 'active' });
  const put = calls.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { custom_fields: [{ name: 'go_to_drink', value: 'Sparkling water' }] });
  assert.equal(put.auth, 'Bearer test-key-not-real');
  assert.ok(!calls.some((c) => c.url.endsWith('/custom_fields') && c.method === 'POST'), 'existing field is not recreated');
});

await test('creates the go_to_drink field once when the publication lacks it', async () => {
  fields = [{ id: 'cf_0', kind: 'string', display: 'zip' }];
  await post({ sid: SID, drink: 'Tea' });
  const creates = calls.filter((c) => c.url === BASE + '/custom_fields' && c.method === 'POST');
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].body, { kind: 'string', display: 'go_to_drink' });
  calls.length = 0;
  await post({ sid: SID, drink: 'Coffee' });
  assert.ok(!calls.some((c) => c.url.includes('/custom_fields')), 'field check is cached');
  assert.equal(stored.go_to_drink, 'Coffee');
});

await test('Other: tags stripped, trimmed, capped at 40, stored as "Other: ..."', async () => {
  const r = await post({ sid: SID, drink: 'Other', other: '  <b>Hibiscus</b>\n tea <script>x</script>' + ' iced'.repeat(20) });
  assert.equal(r.status, 200);
  assert.ok(r.body.value.startsWith('Other: Hibiscus tea x iced'));
  assert.ok(r.body.value.length <= 'Other: '.length + 40);
  assert.ok(!/[<>]/.test(stored.go_to_drink));
});

await test('step 2: detail saved to go_to_drink_detail (field created once), sanitized to 60 chars', async () => {
  await post({ sid: SID, drink: 'Energy drink' });
  let r = await post({ sid: SID, detail: '  <em>test</em>   brand ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.field, 'go_to_drink_detail');
  assert.deepEqual(r.body.fields, { go_to_drink: 'Energy drink', go_to_drink_detail: 'test brand' });
  assert.equal(r.body.saved, true);
  const creates = calls.filter((c) => c.url === BASE + '/custom_fields' && c.method === 'POST');
  assert.deepEqual(creates.map((c) => c.body), [{ kind: 'string', display: 'go_to_drink_detail' }]);
  r = await post({ sid: SID, detail: 'x'.repeat(200) });
  assert.equal(stored.go_to_drink_detail.length, 60);
  assert.equal(calls.filter((c) => c.url === BASE + '/custom_fields' && c.method === 'POST').length, 1);
});

await test('rejects bad sids, unknown drinks and empty Other without calling Beehiiv', async () => {
  for (const body of [
    { sid: 'sub_123', drink: 'Tea' },
    { sid: SID.toUpperCase().replace('SUB_', 'nope_'), drink: 'Tea' },
    { sid: SID, drink: 'Beer' },
    { sid: SID, drink: 'coffee' },
    { sid: SID, drink: 'Other', other: ' <i></i> ' },
    { sid: SID, detail: '  <b></b> ' },
    { sid: SID },
    'not json',
  ]) {
    const r = await post(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

await test('Beehiiv errors and custom-field warnings report ok:false', async () => {
  putStatus = 404;
  let r = await post({ sid: SID, drink: 'Juice' });
  assert.equal(r.status, 404);
  assert.equal(r.body.ok, false);
  putStatus = 200;
  putWarnings = [{ message: 'custom field not found' }];
  r = await post({ sid: SID, drink: 'Juice' });
  assert.equal(r.status, 502);
});

await test('missing API key and GET are rejected; the key is never logged', async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  putStatus = 500;
  await post({ sid: SID, drink: 'Soda' });
  delete process.env.BEEHIIV_API_KEY;
  const r = await post({ sid: SID, drink: 'Soda' });
  console.error = orig;
  assert.equal(r.status, 500);
  assert.ok(!logged.join('\n').includes('test-key-not-real'));
  assert.equal((await post(null, 'GET')).status, 405);
});

server.close();
for (const r of results) console.log(r.join('  '));
if (results.some((r) => r[0] === 'FAIL')) process.exit(1);
