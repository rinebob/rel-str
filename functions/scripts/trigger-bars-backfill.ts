/**
 * Triggers rsBarsSyncAdmin to do a full backfill of rs-bars for all symbols.
 *
 * Uses ADC + gcloud service-account impersonation to mint an ID token for the
 * onCall Cloud Function. No downloaded service-account key required.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/trigger-bars-backfill.ts
 *
 * Optional: pass specific symbols to test first:
 *   npx tsx scripts/trigger-bars-backfill.ts AAPL MSFT TSLA
 *
 * Override the impersonated service account if needed:
 *   $env:IMPERSONATE_SERVICE_ACCOUNT="your-sa@rel-str.iam.gserviceaccount.com"
 */
import { execSync } from 'child_process';

const symbols = process.argv.slice(2); // optional symbol list from CLI args
const url = 'https://us-central1-rel-str.cloudfunctions.net/rsBarsSyncAdminHttp';
const serviceAccount = process.env.IMPERSONATE_SERVICE_ACCOUNT ?? '145446780542-compute@developer.gserviceaccount.com';

console.log('Triggering rsBarsSyncAdmin...');
console.log(symbols.length > 0 ? `Symbols: ${symbols.join(', ')}` : 'Symbols: ALL');
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
