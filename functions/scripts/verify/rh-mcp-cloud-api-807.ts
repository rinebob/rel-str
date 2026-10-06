/**
 * Live verification for task #807 — the deployed `rhApi` function.
 *
 * Unauthenticated run (always safe — every check rejects before dispatch):
 *   npx tsx scripts/verify/rh-mcp-cloud-api-807.ts
 *
 * Authenticated run (needs a real Firebase ID token for the owner account):
 *   npx tsx scripts/verify/rh-mcp-cloud-api-807.ts --token <idToken>
 *   Mint one in the app (sign in → console:
 *   `await getAuth().currentUser.getIdToken()`), or via the local dev API.
 *
 * Passing: every unauth check returns 401 before dispatch; with --token,
 * GET /api/rh/tools lists tools, POST get_accounts returns success:true,
 * and POST /api/rh/auth/reauth returns the structured reauth state.
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
  console.error('Usage: rh-mcp-cloud-api-807.ts [--token <idToken>]');
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

async function call(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  const res = await fetch(`${FUNCTION_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body — treat as opaque
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`--- unauthenticated gate (${FUNCTION_URL}) ---`);

  const noAuth = await call('/api/rh/tools');
  check('GET /tools without token -> 401', noAuth.status === 401, `status ${noAuth.status}`);
  check(
    '401 envelope is structured',
    noAuth.body.success === false && typeof noAuth.body.error === 'string',
  );

  const badToken = await call('/api/rh/tools', { token: 'not-a-real-token' });
  check('GET /tools bad token -> 401', badToken.status === 401, `status ${badToken.status}`);

  const postNoAuth = await call('/api/rh/tools/get_accounts', {
    method: 'POST',
    body: {},
  });
  check('POST tool without token -> 401', postNoAuth.status === 401, `status ${postNoAuth.status}`);

  const reauthNoAuth = await call('/api/rh/auth/reauth', { method: 'POST', body: {} });
  check(
    'POST reauth without token -> 401 (auth before dispatch)',
    reauthNoAuth.status === 401,
    `status ${reauthNoAuth.status}`,
  );

  if (!idToken) {
    console.log('\n(skipping authenticated checks — rerun with --token <idToken>)');
  } else {
    console.log('\n--- authenticated (owner token) ---');

    const tools = await call('/api/rh/tools', { token: idToken });
    check('GET /tools -> 200', tools.status === 200, `status ${tools.status}`);
    const toolList = tools.body.tools;
    check(
      'tool list is non-empty',
      Array.isArray(toolList) && toolList.length > 0,
      `${Array.isArray(toolList) ? toolList.length : 0} tools`,
    );

    const accounts = await call('/api/rh/tools/get_accounts', {
      method: 'POST',
      token: idToken,
      body: {},
    });
    check(
      'POST get_accounts -> 200',
      accounts.status === 200,
      `status ${accounts.status}`,
    );
    check(
      'get_accounts succeeded',
      accounts.body.success === true,
      accounts.body.success === true ? '' : `error: ${String(accounts.body.error)}`,
    );

    const reauth = await call('/api/rh/auth/reauth', {
      method: 'POST',
      token: idToken,
      body: {},
    });
    check(
      'reauth -> structured REAUTHORIZATION_REQUIRED',
      reauth.status === 200 && reauth.body.state === 'REAUTHORIZATION_REQUIRED',
      `status ${reauth.status}, state ${String(reauth.body.state)}`,
    );
  }

  console.log(failures === 0 ? '\n=== PASS ===' : `\n=== FAIL (${failures}) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
