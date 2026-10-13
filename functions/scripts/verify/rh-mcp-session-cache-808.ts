/**
 * Live verification for task #808 — rhApi session cache + minInstances.
 *
 * Checks, in order:
 *   1. Function config — `gcloud functions describe rhApi` shows
 *      minInstanceCount >= 1 and maxInstanceRequestConcurrency === 8.
 *   2. Auth gate still rejects unauthenticated calls before dispatch.
 *   3. With --token: three sequential authenticated `get_accounts` calls all
 *      succeed; timings are printed so warm-session reuse is visible
 *      (the first call on a fresh instance pays credential load + MCP
 *      connect; later calls reuse the cached session).
 *
 * Session reuse itself is proven by the unit suite
 * (rh-agent-mcp-session-cache.test.ts — transportCount stays 1 across
 * requests) and observable in prod via Cloud Logging:
 *   query `jsonPayload.type="connect"` on the rhApi function — ONE
 *   `rh_mcp_session` connect event per instance warm-up, not per request.
 *
 * Usage:
 *   npx tsx scripts/verify/rh-mcp-session-cache-808.ts [--token <idToken>]
 *   (run from the functions/ directory; --token needs a real owner Firebase
 *   ID token — mint in the app console: `await getAuth().currentUser.getIdToken()`)
 *
 * exit 0 = PASS, exit 1 = FAIL, exit 2 = usage error.
 */

import { execSync } from 'node:child_process';

const FUNCTION_URL =
  process.env.RH_API_URL ??
  'https://us-central1-rel-str.cloudfunctions.net/rhApi';

const args = process.argv.slice(2);
const tokenIdx = args.indexOf('--token');
const idToken = tokenIdx >= 0 ? args[tokenIdx + 1] : undefined;
if (tokenIdx >= 0 && (!idToken || idToken.startsWith('--'))) {
  console.error('Usage: rh-mcp-session-cache-808.ts [--token <idToken>]');
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
  ms: number;
}

async function call(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  const start = Date.now();
  const res = await fetch(`${FUNCTION_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const ms = Date.now() - start;
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // leave empty
  }
  return { status: res.status, body, ms };
}

interface GcloudFunctionDescription {
  serviceConfig?: {
    minInstanceCount?: number | string;
    maxInstanceRequestConcurrency?: number | string;
  };
}

async function main(): Promise<void> {
  console.log(`rhApi session-cache verification (#808)\ntarget: ${FUNCTION_URL}\n`);

  console.log('--- function config (gcloud functions describe) ---');
  try {
    const raw = execSync(
      'gcloud functions describe rhApi --region=us-central1 --project=rel-str --format=json',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' ? 'cmd.exe' : undefined },
    );
    const desc = JSON.parse(raw) as GcloudFunctionDescription;
    const min = Number(desc.serviceConfig?.minInstanceCount ?? 0);
    const concurrency = Number(desc.serviceConfig?.maxInstanceRequestConcurrency ?? 0);
    check('minInstances >= 1 (warm instance)', min >= 1, `minInstanceCount=${min}`);
    check('concurrency === 8', concurrency === 8, `maxInstanceRequestConcurrency=${concurrency}`);
  } catch (error) {
    check(
      'gcloud functions describe rhApi',
      false,
      error instanceof Error ? error.message.slice(0, 200) : String(error),
    );
  }

  console.log('\n--- auth gate ---');
  const noAuth = await call('/api/rh/tools/get_accounts', { method: 'POST', body: {} });
  check('POST tool without token -> 401', noAuth.status === 401, `status ${noAuth.status}`);

  if (!idToken) {
    console.log('\n(skipping authenticated checks — rerun with --token <idToken>)');
  } else {
    console.log('\n--- warm-session latency (3 sequential calls) ---');
    const timings: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = await call('/api/rh/tools/get_accounts', {
        method: 'POST',
        token: idToken,
        body: {},
      });
      timings.push(res.ms);
      check(
        `call ${i} -> 200 success`,
        res.status === 200 && res.body.success === true,
        `status ${res.status} in ${res.ms}ms${res.body.success === false ? ` error: ${String(res.body.error)}` : ''}`,
      );
    }
    if (timings.every((t) => t > 0)) {
      console.log(
        `  timings: ${timings.map((t) => `${t}ms`).join(' → ')}` +
          '  (reused sessions skip credential load + connect)',
      );
    }
  }

  console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} check(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
