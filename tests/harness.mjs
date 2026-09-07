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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

  writeFileSync(join(outDir, 'index.html'), html);
  return join(outDir, 'index.html');
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
  'supabase.co', 'fonts.googleapis.com', 'fonts.gstatic.com', 'ERR_CONNECTION_RESET',
  'ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_REFUSED', 'ERR_BLOCKED_BY_CLIENT',
];
export const isExpectedNetwork = (s) => EXPECTED_NETWORK.some((x) => String(s).includes(x));

/* Seeding this skips onboarding — most flows are unreachable otherwise. */
export const SEEDED_STATE = { setupComplete: true, baseRate: 50 };
export const STORAGE_KEY = 'nursingWagePlannerData';
