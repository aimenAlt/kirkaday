// Local checks for api/subscribe.js with Beehiiv mocked out.
// Usage: node api/_test/subscribe.test.mjs  (not deployed: see .vercelignore)
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const calls = [];
let beehiivStatus = 201;
globalThis.fetch = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ data: {} }), { status: beehiivStatus });
};
process.env.BEEHIIV_API_KEY = 'test-key-not-real';
delete process.env.BEEHIIV_PUBLICATION_ID;
const handler = require('../subscribe.js');

const server = http.createServer((req, res) => handler(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (body, headers = {}, method = 'POST') =>
  new Promise((resolve, reject) => {
    const req = http.request(base + '/api/subscribe', { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
const form = (fields, headers = {}) =>
  request(new URLSearchParams(fields).toString(), { 'Content-Type': 'application/x-www-form-urlencoded', ...headers });

const results = [];
async function test(name, fn) {
  calls.length = 0;
  beehiivStatus = 201;
  process.env.BEEHIIV_API_KEY = 'test-key-not-real';
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
}

await test('form post sends the right Beehiiv request and 303s to /thanks', async () => {
  const r = await form({
    email: ' Someone@Example.com ', zip: '77 00-4x9', source: 'home',
    utm_source: 'tiktok', utm_medium: 'social', utm_campaign: 'day1', utm_term: '', utm_content: 'bio',
    referring_site: 'https://www.tiktok.com/', company: '',
  });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/thanks');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.beehiiv.com/v2/publications/pub_a08ae7d5-54f0-4f5c-8514-7c82012a0c87/subscriptions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key-not-real');
  assert.deepEqual(calls[0].body, {
    email: 'someone@example.com',
    reactivate_existing: false,
    send_welcome_email: true,
    double_opt_override: 'on',
    utm_source: 'tiktok',
    utm_medium: 'social',
    utm_campaign: 'day1',
    utm_content: 'bio',
    referring_site: 'https://www.tiktok.com/',
    custom_fields: [{ name: 'zip', value: '77004' }, { name: 'source', value: 'home' }],
  });
});

await test('JSON post returns {ok:true}; no zip or UTMs means none sent; unknown source -> other', async () => {
  const r = await request(JSON.stringify({ email: 'a@b.co', source: 'tiktok-bio' }), { 'Content-Type': 'application/json' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  assert.deepEqual(calls[0].body, {
    email: 'a@b.co', reactivate_existing: false, send_welcome_email: true, double_opt_override: 'on',
    custom_fields: [{ name: 'source', value: 'other' }],
  });
});

await test('source=join is kept', async () => {
  await form({ email: 'a@b.co', source: 'join' });
  assert.deepEqual(calls[0].body.custom_fields, [{ name: 'source', value: 'join' }]);
});

await test('honeypot short-circuits: no API call, 303 to /thanks', async () => {
  const r = await form({ email: 'bot@spam.co', source: 'home', company: 'Acme' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/thanks');
  assert.equal(calls.length, 0);
});

await test('invalid email: no API call, 303 back to the form page with ?error=1', async () => {
  const r = await form({ email: 'not-an-email', source: 'join' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/join?error=1');
  assert.equal(calls.length, 0);
});

await test('Beehiiv failure: 303 back to the referring form page, keeping its query', async () => {
  beehiivStatus = 400;
  const r = await form({ email: 'a@b.co', source: 'home' }, { Referer: base.replace('http://', 'http://') + '/?utm_source=ig&error=1', Host: new URL(base).host });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/?utm_source=ig&error=1');
});

await test('foreign or unknown Referer is ignored; default is /join?error=1', async () => {
  beehiivStatus = 500;
  let r = await form({ email: 'a@b.co' }, { Referer: 'https://evil.example/join' });
  assert.equal(r.headers.location, '/join?error=1');
  r = await form({ email: 'a@b.co', source: 'home' }, { Referer: base + '//evil.example/' });
  assert.equal(r.headers.location, '/?error=1');
});

await test('missing API key: logged, no API call, 303 with ?error=1', async () => {
  delete process.env.BEEHIIV_API_KEY;
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const r = await form({ email: 'a@b.co', source: 'home' });
  console.error = orig;
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/?error=1');
  assert.equal(calls.length, 0);
  assert.ok(errors.some((e) => e.includes('BEEHIIV_API_KEY is not set')));
});

await test('the API key is never logged', async () => {
  beehiivStatus = 401;
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  await form({ email: 'a@b.co', source: 'home' });
  console.error = orig;
  assert.ok(logged.length > 0);
  assert.ok(!logged.join('\n').includes('test-key-not-real'));
});

await test('JSON failure returns ok:false', async () => {
  beehiivStatus = 503;
  const r = await request(JSON.stringify({ email: 'a@b.co' }), { 'Content-Type': 'application/json' });
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.body).ok, false);
});

await test('GET is rejected with 405', async () => {
  const r = await request(null, {}, 'GET');
  assert.equal(r.status, 405);
  assert.equal(calls.length, 0);
});

server.close();
for (const r of results) console.log(r.join('  '));
if (results.some((r) => r[0] === 'FAIL')) process.exit(1);
