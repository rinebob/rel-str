/**
 * Live verification for task #809 — `POST /api/rh/batch` on the deployed
 * `rhApi` function.
 *
 * Unauthenticated run (always safe — auth rejects before dispatch):
 *   npx tsx scripts/verify/rh-mcp-batch-809.ts
 *
 * Authenticated run (needs a real Firebase ID token for the owner account):
 *   npx tsx scripts/verify/rh-mcp-batch-809.ts --token <idToken>
 *   Mint one in the app (sign in → console:
 *   `await getAuth().currentUser.getIdToken()`).
 *
 * Passing: unauth batch POST returns 401; with --token, empty/malformed
 * calls → 400, and a mixed batch returns 200 with ordered per-item
 * success/error entries (a bad tool name fails its item, not the batch).
 * exit 0 = PASS, exit 1 = FAIL.
 */
export {};

const FUNCTION_URL =
  process.env.RH_API_URL ??
  'https://us-central1-rel-str.cloudfunctions.net/rhApi';

const args = process.argv.slice(2);
const tokenIdx = args.indexOf('--token');
const idToken = tokenIdx >= 0 ? args[tokenIdx + 1] : undefined;
if (tokenIdx >= 0 && (!idToken || idToken.startsWith('--'))) {
  console.error('Usage: rh-mcp-batch-809.ts [--token <idToken>]');
  process.exit(2);
}
for (const a of args) {
  if (a !== '--token' && a !== idToken) {
    console.error(`Unknown argument: ${a}`);
    process.exit(2);
  }
}

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
}

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function postBatch(
  payload: unknown,
  token?: string,
): Promise<JsonResponse> {
  const res = await fetch(`${FUNCTION_URL}/api/rh/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body — treat as opaque
  }
  return { status: res.status, body };
}

interface BatchResult {
  success: boolean;
  tool?: string;
  category?: string;
  error?: string;
}

async function main() {
  console.log(`--- unauthenticated gate (${FUNCTION_URL}) ---`);

  const noAuth = await postBatch({ calls: [{ tool: 'get_accounts' }] });
  check(
    'POST /batch without token -> 401 (auth before dispatch)',
    noAuth.status === 401,
    `status ${noAuth.status}`,
  );

  if (!idToken) {
    console.log('\n(skipping authenticated checks — rerun with --token <idToken>)');
  } else {
    console.log('\n--- authenticated (owner token) ---');

    const empty = await postBatch({ calls: [] }, idToken);
    check('empty calls -> 400', empty.status === 400, `status ${empty.status}`);

    const oversized = await postBatch(
      { calls: Array.from({ length: 21 }, () => ({ tool: 'get_accounts' })) },
      idToken,
    );
    check('21 calls -> 400', oversized.status === 400, `status ${oversized.status}`);

    const malformed = await postBatch({ calls: [{}] }, idToken);
    check(
      'call missing tool -> 400',
      malformed.status === 400,
      `status ${malformed.status}`,
    );

    const mixed = await postBatch(
      {
        calls: [
          { tool: 'get_accounts' },
          { tool: 'not_a_tool' },
          { tool: 'get_accounts' },
        ],
      },
      idToken,
    );
    check('mixed batch -> 200', mixed.status === 200, `status ${mixed.status}`);
    check(
      'envelope success',
      mixed.body.success === true,
      mixed.body.success === true ? '' : `error: ${String(mixed.body.error)}`,
    );

    const results = (mixed.body.results ?? []) as BatchResult[];
    check('ordered results array, length 3', results.length === 3, `${results.length}`);
    check('item 0 succeeded', results[0]?.success === true);
    check(
      'item 1 failed VALIDATION (not a whole-batch error)',
      results[1]?.success === false && results[1]?.category === 'VALIDATION',
      `category ${String(results[1]?.category)}`,
    );
    check('item 2 still ran and succeeded', results[2]?.success === true);
  }

  console.log(failures === 0 ? '\n=== PASS ===' : `\n=== FAIL (${failures}) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
