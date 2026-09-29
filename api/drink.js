// POST /api/drink: saves the /thanks "go-to drink" poll answers on a Beehiiv
// subscription.
//
// Body (JSON), step 1: { sid, drink, other? } -> custom field go_to_drink.
// drink must be one of the poll chips; "Other" takes a free-text answer (tags
// stripped, trimmed, 40 chars) stored as "Other: <text>".
// Body, optional step 2: { sid, detail } -> custom field go_to_drink_detail
// (tags stripped, trimmed, 60 chars).
// sid is the subscription id that /api/subscribe returned to the browser.
// Creates a custom field once if the publication lacks it.
//
// Needs BEEHIIV_API_KEY in the server environment. It is never sent to the
// browser and never logged.

const PUB_ID = process.env.BEEHIIV_PUBLICATION_ID || 'pub_a08ae7d5-54f0-4f5c-8514-7c82012a0c87';
const API = 'https://api.beehiiv.com/v2/publications/' + encodeURIComponent(PUB_ID);
const FIELD = 'go_to_drink';
const DETAIL_FIELD = 'go_to_drink_detail';
const CHOICES = ['Coffee', 'Energy drink', 'Soda', 'Tea', 'Sparkling water', 'Juice'];
const SID_RE = /^sub_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4 * 1024;
const TIMEOUT_MS = 8000;

// Custom fields known to exist on the publication (per warm instance).
const readyFields = new Set();

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readStream(req) {
  return new Promise((resolve) => {
    if (req.readableEnded || req.complete) return resolve('');
    let raw = '';
    const done = () => resolve(raw);
    const timer = setTimeout(done, 5000);
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) { raw = raw.slice(0, MAX_BODY); req.destroy(); }
    });
    req.on('end', () => { clearTimeout(timer); done(); });
    req.on('error', () => { clearTimeout(timer); done(); });
  });
}

// Vercel's Node runtime pre-parses JSON into req.body; fall back to the stream.
async function readBody(req) {
  let body;
  try {
    body = req.body;
  } catch (e) {
    return {}; // Malformed JSON: the runtime's parser throws.
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (body === undefined || body === null) body = await readStream(req);
  if (typeof body === 'string') {
    try { body = JSON.parse(body.slice(0, MAX_BODY)); } catch (e) { return {}; }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

// Free text: no tags, no control characters, one line, capped.
function clean(v, max) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

async function beehiiv(apiKey, path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* empty or non-JSON body */ }
    return { status: r.status, ok: r.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureField(apiKey, name) {
  if (readyFields.has(name)) return;
  const list = await beehiiv(apiKey, '/custom_fields?limit=100');
  if (list.ok && Array.isArray(list.data && list.data.data)) {
    for (const f of list.data.data) if (f && f.display) readyFields.add(f.display);
  }
  if (readyFields.has(name)) return;
  const made = await beehiiv(apiKey, '/custom_fields', { method: 'POST', body: JSON.stringify({ kind: 'string', display: name }) });
  if (!made.ok) throw new Error('custom field create failed: ' + made.status + ' ' + JSON.stringify(made.data).slice(0, 300));
  console.log('[drink] created custom field %s', name);
  readyFields.add(name);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const input = await readBody(req);
  const sid = String(input.sid || '');
  if (!SID_RE.test(sid)) return send(res, 400, { ok: false, error: 'invalid_sid' });

  const drink = String(input.drink || '');
  let field = FIELD;
  let value;
  if (!drink && input.detail !== undefined) {
    field = DETAIL_FIELD;
    value = clean(input.detail, 60);
    if (!value) return send(res, 400, { ok: false, error: 'empty_detail' });
  } else if (CHOICES.includes(drink)) {
    value = drink;
  } else if (drink === 'Other') {
    const other = clean(input.other, 40);
    if (!other) return send(res, 400, { ok: false, error: 'empty_other' });
    value = 'Other: ' + other;
  } else {
    return send(res, 400, { ok: false, error: 'invalid_drink' });
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  if (!apiKey) {
    console.error('[drink] BEEHIIV_API_KEY is not set; answer not saved');
    return send(res, 500, { ok: false, error: 'not_configured' });
  }

  try {
    await ensureField(apiKey, field);
    const sub = '/subscriptions/' + encodeURIComponent(sid);
    const put = await beehiiv(apiKey, sub, { method: 'PUT', body: JSON.stringify({ custom_fields: [{ name: field, value }] }) });
    const warnings = put.data && Array.isArray(put.data.warnings) ? put.data.warnings : [];
    if (!put.ok || warnings.length) {
      console.error('[drink] Beehiiv update responded %d: %s', put.status, JSON.stringify(put.data).slice(0, 500));
      return send(res, put.status === 404 ? 404 : 502, { ok: false, error: 'save_failed' });
    }
    // Read it back so the response reflects what Beehiiv actually stored.
    const got = await beehiiv(apiKey, sub + '?expand[]=custom_fields');
    const fields = (got.data && got.data.data && got.data.data.custom_fields) || [];
    const stored = fields.find((f) => f && f.name === field);
    const others = {};
    for (const f of fields) if (f && (f.name === FIELD || f.name === DETAIL_FIELD)) others[f.name] = f.value;
    return send(res, 200, {
      ok: true,
      field,
      value,
      saved: Boolean(stored && stored.value === value),
      fields: others,
      status: (got.data && got.data.data && got.data.data.status) || null,
    });
  } catch (err) {
    console.error('[drink] Beehiiv request failed: %s', err && err.name === 'AbortError' ? 'timeout' : String(err && err.message));
    return send(res, 502, { ok: false, error: 'save_failed' });
  }
};
