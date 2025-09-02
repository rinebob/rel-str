/* eslint-disable */
const fs = require('fs');
const path = require('path');

// Load local env vars if a file exists (local-only). Do not log to stdout.
try {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '.env.rel-str'),
    path.join(cwd, '.env.local'),
    path.join(cwd, '.env')
  ];
  const chosen = candidates.find((p) => fs.existsSync(p));
  if (chosen) {
    require('dotenv').config({ path: chosen });
  }
} catch (_) {
  // Ignore if dotenv is not installed in CI
}

const key = process.env.SYNC_FUSION_LICENSE_KEY || '';
if (!key) {
  console.error('SYNC_FUSION_LICENSE_KEY env var is missing.');
  process.exit(1);
}

const out = `export const SYNC_FUSION_LICENSE_KEY = '${key.replace(/'/g, "\\'")}';\n`;
const outPath = path.resolve(__dirname, '../src/secrets/syncfusion-license.ts');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');
// Intentionally no console.log to keep build output clean for App Hosting