/**
 * Live auth-guard verification for #1437 — the four public-invoker
 * options callables must reject anonymous callers before any work.
 *
 * Per callable (optionsReplayStart / optionsReplayRetry /
 * optionsAnalysisStart / optionsReplayDelete):
 *
 *   FAIL (drives exit 1):
 *   - no Authorization header → anything but 401 UNAUTHENTICATED
 *   - garbage bearer token → anything but 401 UNAUTHENTICATED
 *   - minted ID token + malformed input → anything but 400
 *     INVALID_ARGUMENT (proves the auth check passed and validation ran;
 *     chosen inputs mutate nothing — no run/list/task effects)
 *
 * Auth: mints a custom token via service-account impersonation (the
 * backfill-scripts pattern — ADC user creds can't sign), exchanges it
 * for a real ID token through identitytoolkit (web apiKey = public
 * client config), and deletes the disposable auth user on exit.
 *
 * Usage (from functions/):
 *   NODE_OPTIONS="--require C:/Users/bob/.config/node/ipv4-only.cjs" \
 *     npx tsx scripts/verify/options-auth-guard-1437.ts
 *
 * Requires a deploy containing the #1437 guards. Exit 0 on ALL PASS.
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const API_KEY = 'AIzaSyDiDoun2WG0xaTuXsI722-LjW9-6YBXZwc';
const BASE = 'https://us-central1-rel-str.cloudfunctions.net';
const QA_UID = 'qa-1437-auth-guard';

const app = initializeApp({
  projectId: 'rel-str',
  serviceAccountId: '145446780542-compute@developer.gserviceaccount.com',
});

interface Probe {
  name: string;
  /** Input that passes NOTHING but must reach validation — authed call
   *  must surface invalid-argument, proving the guard ran first. */
  badData: Record<string, unknown>;
}

const CALLABLES: Probe[] = [
  { name: 'optionsReplayStart', badData: { templateId: 'no-such-template' } },
  { name: 'optionsReplayRetry', badData: {} },
  { name: 'optionsAnalysisStart', badData: {} },
  { name: 'optionsReplayDelete', badData: {} },
];

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function callFn(
  name: string,
  data: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; errorStatus?: string }> {
  const res = await fetch(`${BASE}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, errorStatus: body?.error?.status };
}

async function mintIdToken(): Promise<string> {
  const custom = await getAuth(app).createCustomToken(QA_UID);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`signInWithCustomToken failed: ${JSON.stringify(body)}`);
  return body.idToken as string;
}

async function main(): Promise<void> {
  const idToken = await mintIdToken();
  console.log('disposable ID token minted\n');

  try {
    for (const probe of CALLABLES) {
      const anon = await callFn(probe.name, probe.badData);
      check(
        `${probe.name} anonymous → UNAUTHENTICATED`,
        anon.status === 401 && anon.errorStatus?.toUpperCase() === 'UNAUTHENTICATED',
        `status=${anon.status} error=${anon.errorStatus ?? 'none'}`,
      );
  
      const garbage = await callFn(probe.name, probe.badData, 'garbage-token');
      check(
        `${probe.name} garbage token → UNAUTHENTICATED`,
        garbage.status === 401 && garbage.errorStatus?.toUpperCase() === 'UNAUTHENTICATED',
        `status=${garbage.status} error=${garbage.errorStatus ?? 'none'}`,
      );
  
      const authed = await callFn(probe.name, probe.badData, idToken);
      check(
        `${probe.name} authed + bad input → INVALID_ARGUMENT (auth passed)`,
        authed.status === 400 && authed.errorStatus?.toUpperCase() === 'INVALID_ARGUMENT',
        `status=${authed.status} error=${authed.errorStatus ?? 'none'}`,
      );
    }
  } finally {
    await getAuth(app).deleteUser(QA_UID).catch(() => undefined);
  }
  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('driver crashed:', e);
  process.exit(1);
});
