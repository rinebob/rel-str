/**
 * Targeted re-sync of one or more specific symbols via symbolDataSyncAdminHttp.
 *
 * Use this for ad-hoc re-syncs of a small number of known symbols.
 * For bulk backfills use trigger-symbol-data-sync.js with --force instead.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/trigger-bars-backfill.ts AAPL MSFT TSLA
 *
 * Override the impersonated service account if needed:
 *   $env:IMPERSONATE_SERVICE_ACCOUNT="your-sa@rel-str.iam.gserviceaccount.com"
 */
import { execSync } from 'child_process';

const symbols = process.argv.slice(2);
if (symbols.length === 0) {
  console.error('ERROR: provide at least one symbol. Example: npx tsx scripts/trigger-bars-backfill.ts AAPL MSFT');
  process.exit(1);
}

const url = 'https://us-central1-rel-str.cloudfunctions.net/symbolDataSyncAdminHttp';
const serviceAccount = process.env.IMPERSONATE_SERVICE_ACCOUNT ?? '145446780542-compute@developer.gserviceaccount.com';

console.log('Triggering symbolDataSyncAdminHttp...');
console.log(`Symbols: ${symbols.join(', ')}`);
console.log('Impersonating service account:', serviceAccount);

function getIdToken(audience: string): string {
  try {
    return execSync(
      `gcloud auth print-identity-token --audiences="${audience}" --impersonate-service-account="${serviceAccount}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch (err: any) {
    console.error('Failed to get identity token via gcloud impersonation.');
    console.error(err?.stderr || err?.message || err);
    process.exit(1);
  }
}

const token = getIdToken(url);
const body = {
  forceFullFetch: true,
  ...(symbols.length > 0 ? { symbols } : {}),
};

console.log('POST', url);
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error(`Error ${res.status}:`, text);
  process.exit(1);
}

const json = JSON.parse(text);
console.log('Result:', JSON.stringify(json?.result ?? json, null, 2));
