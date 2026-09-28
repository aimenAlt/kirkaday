// POST /api/subscribe: adds an email to the KirkaDay Beehiiv publication.
//
// Accepts application/x-www-form-urlencoded (the plain HTML forms, which must
// work with JS off) and application/json. Form posts get a 303 to /thanks, or
// back to the page they came from with ?error=1. JSON callers get {ok}.
//
// Needs BEEHIIV_API_KEY in the server environment. It is never sent to the
// browser and never logged.

const PUB_ID = process.env.BEEHIIV_PUBLICATION_ID || 'pub_a08ae7d5-54f0-4f5c-8514-7c82012a0c87';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const SOURCES = ['home', 'join'];
// Pages that carry a signup form, and where a failed signup goes back to.
const FORM_PAGES = { home: '/', join: '/join' };
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const MAX_BODY = 16 * 1024;
const TIMEOUT_MS = 8000;

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

function text(v, max) {
  v = first(v);
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function contentType(req) {
  return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

function parseRaw(raw, type) {
  if (!raw) return {};
  if (type === 'application/json') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
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

// Vercel's Node runtime pre-parses JSON and urlencoded bodies into req.body.
// Fall back to reading the stream so this also runs under a bare http server.
async function readBody(req) {
  const type = contentType(req);
  let body;
  try {
    body = req.body;
  } catch (e) {
    return {}; // Malformed JSON: the runtime's parser throws.
  }
  if (Buffer.isBuffer(body)) return parseRaw(body.toString('utf8'), type);
  if (typeof body === 'string') return parseRaw(body, type);
  if (body && typeof body === 'object') return body;
  return parseRaw(await readStream(req), type);
}

function wantsJson(req) {
  if (contentType(req) === 'application/json') return true;
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

// Send the visitor back to the form they used, keeping its query (UTMs) but
// never trusting the Referer for anything beyond our own known form pages.
function errorLocation(req, source) {
  let path = FORM_PAGES[source] || '/join';
  let params = new URLSearchParams();
  const ref = req.headers.referer;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (ref && host) {
    try {
      const u = new URL(ref);
      let refPath = u.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
      if (refPath === '/index') refPath = '/';
      if (u.host === host && Object.values(FORM_PAGES).includes(refPath)) {
        path = refPath;
        params = u.searchParams;
      }
    } catch (e) { /* ignore a malformed Referer */ }
  }
  params.delete('error');
  params.set('error', '1');
  return path + '?' + params.toString();
}

function send(res, status, headers, body) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function redirect(res, location) {
  send(res, 303, { Location: location, 'Content-Type': 'text/plain; charset=utf-8' }, 'See ' + location);
}

function json(res, status, obj) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
  }

  const isJson = wantsJson(req);
  const input = await readBody(req);
  const rawSource = text(input.source, 20).toLowerCase();
  const source = SOURCES.includes(rawSource) ? rawSource : 'other';

  const ok = () => (isJson ? json(res, 200, { ok: true }) : redirect(res, '/thanks'));
  const fail = (status, error) => (isJson ? json(res, status, { ok: false, error }) : redirect(res, errorLocation(req, source)));

  // Honeypot: people never see this field, so anything in it is a bot.
  if (text(input.company, 200)) return ok();

  const email = text(input.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(400, 'invalid_email');

  const zip = text(input.zip, 40).replace(/\D/g, '').slice(0, 5);

  const apiKey = process.env.BEEHIIV_API_KEY;
  if (!apiKey) {
    console.error('[subscribe] BEEHIIV_API_KEY is not set; signup not sent (source=%s)', source);
    return fail(500, 'not_configured');
  }

  const payload = {
    email,
    reactivate_existing: false,
    send_welcome_email: true,
    double_opt_override: 'on',
  };
  for (const key of UTM_KEYS) {
    const v = text(input[key], 200);
    if (v) payload[key] = v;
  }
  const referringSite = text(input.referring_site, 500);
  if (referringSite) payload.referring_site = referringSite;
  payload.custom_fields = [];
  if (zip) payload.custom_fields.push({ name: 'zip', value: zip });
  payload.custom_fields.push({ name: 'source', value: source });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.beehiiv.com/v2/publications/' + encodeURIComponent(PUB_ID) + '/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (r.ok) return ok();
    let detail = '';
    try { detail = (await r.text()).slice(0, 500).split(email).join('<email>'); } catch (e) { /* ignore */ }
    console.error('[subscribe] Beehiiv responded %d (source=%s): %s', r.status, source, detail);
    return fail(502, 'subscribe_failed');
  } catch (err) {
    console.error('[subscribe] Beehiiv request failed (source=%s): %s', source, err && err.name === 'AbortError' ? 'timeout' : String(err && err.message));
    return fail(502, 'subscribe_failed');
  } finally {
    clearTimeout(timer);
  }
};
