/* Build a locally-servable copy of index.html.
 *
 * The sandbox blocks unpkg/cdnjs/jsdelivr and Supabase but allows registry.npmjs.org, so the five
 * CDN <script> tags are rewritten to vendored node_modules paths and their integrity/crossorigin
 * attributes are stripped — IN THE SCRATCH COPY ONLY. index.html itself is never modified, so
 * Invariant 2 (SRI on all 5 scripts) cannot be damaged by running the tests.
 *
 * Versions here are pinned to exactly what index.html loads. If you bump a CDN pin, bump it here
 * too or the harness stops testing the code that ships.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';

export const PKGS = [
  'react@18.2.0',
  'react-dom@18.2.0',
  '@babel/standalone@7.24.7',
  'pdfjs-dist@3.11.174',
  '@supabase/supabase-js@2.45.4',
  'playwright-core@1.47.2',
];

/* CDN url -> path inside node_modules. Order matters only for readability. */
const MAP = [
  ['https://unpkg.com/react@18.2.0/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
  ['https://unpkg.com/@babel/standalone@7.24.7/babel.min.js', '@babel/standalone/babel.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjs-dist/build/pdf.min.js'],
  ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js', '@supabase/supabase-js/dist/umd/supabase.js'],
];

/* THE SCRATCH COPY MUST NOT REACH THE REAL PROJECT.
 *
 * Only the five CDN <script> tags were ever rewritten, which left `createClient(SUPABASE_URL, …)`
 * pointing at the production Supabase project. In the sandbox that failed silently — there is no
 * route out — so it read as harmless for months. On a GitHub Actions runner the network is open,
 * and `ci.yml` runs this suite on every push and pull_request, so every CI run inserted real
 * `app_open` / `setup_completed` / `shift_saved` rows into production `events`, each one under a
 * fresh anon_id because each browser context starts with empty localStorage.
 *
 * The damage is measurable: of 304 iPhone-user-agent devices on 2026-09-16, 266 had fired exactly
 * one event, and 251 of them carry Playwright's iPhone 13 profile — identified by the internally
 * inconsistent pair `iPhone OS 15_0` + `Version/18.0`, which no real iPhone emits. 291 rows, first
 * seen 2026-09-07: the day `ci.yml` was added and CI became a required check. A test suite was the
 * app's largest "user" by two orders of magnitude.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve. Requests still carry the same
 * /rest/v1/... paths, so `page.route('**\/rest/v1/feedback*')` interception — which is how the
 * anon_id assertion actually works — is unaffected. */
const REAL_SUPABASE_HOST = 'https://mnnlgcxnvodjwlhhiphq.supabase.co';
const NEUTRAL_SUPABASE_HOST = 'https://harness-must-never-write.invalid';

function neutralizeSupabase(html, what) {
  if (!html.includes(REAL_SUPABASE_HOST)) {
    throw new Error(`${what}: Supabase host not found — the harness can no longer prove it is offline`);
  }
  if (!/connect-src /.test(html)) {
    throw new Error(`${what}: no connect-src in the meta CSP — the rewrite below would silently no-op`);
  }
  /* The meta CSP names *.supabase.co, so swapping the host alone gets every telemetry request
     killed by CSP before it reaches the network — which also means before Playwright can
     intercept it, so an assertion on what the app SENDS can never fire. Widen connect-src by
     exactly this one unresolvable host, in the scratch copy only. Every real origin the CSP
     allows is left exactly as it ships. */
  return html
    .split(REAL_SUPABASE_HOST).join(NEUTRAL_SUPABASE_HOST)
    .split('connect-src ').join(`connect-src ${NEUTRAL_SUPABASE_HOST} `);
}

/* Dev React surfaces warnings production silences — missing keys, controlled/uncontrolled flips,
   setState on unmounted. Those are real defects that never raise a pageerror. */
const DEV_SWAP = [
  ['react/umd/react.production.min.js', 'react/umd/react.development.js'],
  ['react-dom/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.development.js'],
];

export function vendor(root) {
  if (existsSync(join(root, 'node_modules', 'playwright-core'))) return;
  execSync(`npm install --no-save --silent ${PKGS.join(' ')}`, { cwd: root, stdio: 'inherit' });
}

export function buildScratch(root, outDir, { dev = false } = {}) {
  mkdirSync(outDir, { recursive: true });
  let html = readFileSync(join(root, 'index.html'), 'utf8');

  for (const [cdn, local] of MAP) {
    if (!html.includes(cdn)) throw new Error(`CDN pin moved, harness is stale: ${cdn}`);
    html = html.replace(cdn, `/node_modules/${local}`);
  }
  if (dev) for (const [prod, devPath] of DEV_SWAP) html = html.replace(prod, devPath);

  /* Local files have no subresource hash; leaving the attributes on blocks every script. */
  html = html.replace(/\s+integrity="sha384-[^"]*"/g, '').replace(/\s+crossorigin="[^"]*"/g, '');

  const n = (html.match(/\/node_modules\//g) || []).length;
  if (n < MAP.length) throw new Error(`expected ${MAP.length} rewritten scripts, got ${n}`);

  html = neutralizeSupabase(html, 'index.html');

  writeFileSync(join(outDir, 'index.html'), html);
  /* The app loads the pdf.js worker same-origin from the publish set. Without it here the
     paystub path silently degrades and every import test fails for the wrong reason. */
  copyFileSync(join(root, 'pdf.worker.min.js'), join(outDir, 'pdf.worker.min.js'));
  buildOpsScratch(root, outDir);
  return join(outDir, 'index.html');
}

/* The ops console is a second published page, so the harness has to serve it too or the
   signed-out gate can never be asserted. It loads exactly one of the five CDN scripts
   (supabase-js), so it gets the same rewrite treatment — again, in the scratch copy only. */
export function buildOpsScratch(root, outDir) {
  const [cdn, local] = MAP.find(([u]) => u.includes('supabase-js'));
  let html = readFileSync(join(root, 'ops.html'), 'utf8');
  if (!html.includes(cdn)) throw new Error(`ops.html supabase pin moved, harness is stale: ${cdn}`);
  html = html.replace(cdn, `/node_modules/${local}`)
    .replace(/\s+integrity="sha384-[^"]*"/g, '')
    .replace(/\s+crossorigin="[^"]*"/g, '');
  html = neutralizeSupabase(html, 'ops.html');
  /* The meta CSP names the real CDN host; the local path is same-origin, which 'self' already
     covers, so nothing else needs rewriting for the page to run under the harness. */
  writeFileSync(join(outDir, 'ops.html'), html);
  return join(outDir, 'ops.html');
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.map': 'application/json' };

/* Serves the scratch copy at / and the repo's node_modules under /node_modules. */
export function serve(root, scratchDir) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = url.startsWith('/node_modules/')
      ? join(root, url)
      : join(scratchDir, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root) && !file.startsWith(scratchDir)) { res.writeHead(403).end(); return; }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (_) { res.writeHead(404).end('not found'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
  }));
}

/* The sandbox has no route to Supabase or the fonts CDN. Those failures are expected and must not
   be counted as defects; anything else is a real finding. */
export const EXPECTED_NETWORK = [
  /* 'supabase.co' stays for a scratch copy built before the neutralisation above; the .invalid
     host is what a current build actually fails against. */
  'supabase.co', 'harness-must-never-write.invalid',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'ERR_CONNECTION_RESET',
  'ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_REFUSED', 'ERR_BLOCKED_BY_CLIENT',
];
export const isExpectedNetwork = (s) => EXPECTED_NETWORK.some((x) => String(s).includes(x));

/* Seeding this skips onboarding — most flows are unreachable otherwise. */
export const SEEDED_STATE = { setupComplete: true, baseRate: 50 };
export const STORAGE_KEY = 'nursingWagePlannerData';

/* A structurally valid single-page PDF whose only content is `lines`, one Tj per line.
 *
 * The paystub importer is the one surface with no end-to-end coverage, because reaching it needs
 * a real PDF for pdf.js to parse — a fixture string handed straight to the parser proves the
 * parser works and says nothing about whether the import works. This builds the smallest file
 * pdf.js will accept: uncompressed, one Helvetica font, a byte-accurate xref table.
 *
 * Note what pdf.js then does with it: getTextContent() returns one item per Tj, and the app joins
 * them with a single space. So the text the parser actually sees has NO line breaks, which is the
 * whole reason parseEarningsRows tokenises instead of matching line shapes. Building the fixture
 * this way rather than as a pre-joined string is what makes that property testable.
 */
export function makeMinimalPdf(lines) {
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = 'BT /F1 9 Tf 12 TL 24 760 Td\n'
    + lines.map((l) => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
