// Renders the 1200x630 social previews in assets/og/ from template.html.
// Usage: node scripts/og/build.mjs   (needs Playwright + Chromium; no repo deps)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../assets/og');

let playwright;
try {
  playwright = createRequire(import.meta.url)('playwright');
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  playwright = createRequire(path.join(globalRoot, 'noop.js'))('playwright');
}

// The can is framed on the logo and product name; the plate at the foot of
// the arch sits over the on-pack callouts so the preview carries no numbers.
const CAN = { w: '800px', left: '-231px', top: '-178px' };

const PAGES = [
  { name: 'home', eyebrow: 'Launching Spring 2027',
    headline: 'Sparkling Hibiscus Energy.', sub: 'Launching Spring 2027 in <b>Houston</b>.', path: '' },
  { name: 'join', eyebrow: 'The Sunday email',
    headline: 'Follow the build.', sub: 'What worked, what broke, and first dibs on <b>Houston tastings</b>.', path: '/join' },
  { name: 'wholesale', eyebrow: 'Wholesale interest list',
    headline: 'Stock KirkaDay.', sub: 'Samples first and <b>founding-partner terms</b> for stores and distributors.', path: '/wholesale' },
];

// Webfonts come from Google Fonts; route through HTTPS_PROXY when one is set.
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await playwright.chromium.launch(proxy ? { proxy: { server: proxy } } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// Fetch webfonts from Node (which honours NODE_EXTRA_CA_CERTS behind a TLS proxy).
await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => route.fulfill({ response: await route.fetch() }));
for (const p of PAGES) {
  const q = new URLSearchParams({ eyebrow: p.eyebrow, headline: p.headline, sub: p.sub, path: p.path, ...CAN });
  await page.goto(pathToFileURL(path.join(here, 'template.html')).href + '?' + q, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(out, p.name + '.jpg');
  await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`${p.name}.jpg  ${kb} KB`);
  if (kb >= 300) throw new Error(`${p.name}.jpg is ${kb} KB; keep previews under 300 KB`);
}
await browser.close();
