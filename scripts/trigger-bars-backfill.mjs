/**
 * Triggers rsBarsSyncAdmin to do a full backfill of rs-bars for all symbols.
 * Run with: node scripts/trigger-bars-backfill.mjs
 *
 * Optional: pass specific symbols to test first:
 *   node scripts/trigger-bars-backfill.mjs AAPL MSFT TSLA
 */
const symbols = process.argv.slice(2); // optional symbol list from CLI args

console.log('Triggering rsBarsSyncAdmin...');
console.log(symbols.length > 0 ? `Symbols: ${symbols.join(', ')}` : 'Symbols: ALL');

// Use the REST API directly since admin SDK callable invocation isn't straightforward
const { GoogleAuth } = await import('google-auth-library');
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const token = await auth.getAccessToken();

const url = 'https://us-central1-rel-str.cloudfunctions.net/rsBarsSyncAdmin';
const body = {
  data: {
    forceFullFetch: true,
    ...(symbols.length > 0 ? { symbols } : {}),
  },
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
