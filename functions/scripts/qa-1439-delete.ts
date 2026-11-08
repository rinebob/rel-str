/**
 * QA driver for #1439 — exercises the deployed `optionsReplayDelete`
 * callable end-to-end against prod.
 *
 * S1 unauthenticated call → `unauthenticated`
 * S2 failed run (bad symbol) → authed delete → run+list docs gone
 * S3 completed run + analysis → authed delete → run+list+6 results gone
 * S4 re-delete → all-zero counts, idempotent no-op
 *
 * Auth: mints a custom token via admin SDK, exchanges it for a real
 * Firebase ID token through identitytoolkit (web apiKey = public client
 * config), then calls the callable protocol with
 * `Authorization: Bearer <idToken>`.
 *
 * Usage (from functions/):
 *   npx tsx scripts/qa-1439-delete.ts
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
} from '@st/collections';

const API_KEY = 'AIzaSyDiDoun2WG0xaTuXsI722-LjW9-6YBXZwc';
const REGION = 'us-central1';
const PROJECT = 'rel-str';
const QA_UID = 'qa-1439-delete';

// Signs custom tokens via iam.serviceAccounts.signBlob (same pattern as
// backfill-orphan-st-symbols.ts) — ADC user creds can't sign locally.
const app = initializeApp({
  projectId: PROJECT,
  serviceAccountId: '145446780542-compute@developer.gserviceaccount.com',
});
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
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

interface CallResult {
  status: number;
  data?: Record<string, unknown>;
  error?: { status?: string; message?: string };
}

async function callFn(
  name: string,
  data: Record<string, unknown>,
  token?: string,
): Promise<CallResult> {
  const res = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  // Callable protocol: success → {result}, failure → {error}
  return { status: res.status, data: body.result ?? body.data, error: body.error };
}

async function waitForRunStatus(
  runId: string,
  want: string[],
  timeoutMs = 300_000,
): Promise<string> {
  const ref = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT).doc(runId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await ref.get();
    const status = snap.data()?.status as string | undefined;
    if (status && want.includes(status)) return status;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return 'TIMEOUT';
}

async function docExists(root: string, id: string): Promise<boolean> {
  return (await db.collection(root).doc(id).get()).exists;
}

async function resultDocIds(runId: string): Promise<string[]> {
  const snap = await db
    .collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT)
    .where('contractListDocId', '==', runId)
    .get();
  return snap.docs.map((d) => d.id);
}

async function main(): Promise<void> {
  console.log('=== minting ID token ===');
  const idToken = await mintIdToken();
  console.log('token minted');

  // ---------- S1: unauthenticated → unauthenticated ----------
  console.log('\n=== S1: unauthenticated delete → unauthenticated ===');
  const s1 = await callFn('optionsReplayDelete', { runId: 'qa-nonexistent-run' });
  check(
    'no-token call rejected with unauthenticated',
    s1.error?.status?.toUpperCase() === 'UNAUTHENTICATED' && s1.status === 401,
    `status=${s1.status} error.status=${s1.error?.status ?? 'none'} msg=${s1.error?.message ?? ''}`,
  );

  // ---------- S2: failed run → delete → run+list gone ----------
  console.log('\n=== S2: failed run (ZZZZZ) → authed delete ===');
  // Auth token required post-#1437 — the start/analysis callables gained
  // the same request.auth?.uid guard as delete.
  const s2start = await callFn('optionsReplayStart', {
    templateId: 'csp-45-20',
    symbols: ['ZZZZZ'],
    startDate: '2026-01-01',
  }, idToken);
  const runIds = (s2start.data?.['runIds'] as string[]) ?? [];
  check('start returned one runId', runIds.length === 1, JSON.stringify(s2start.data ?? s2start.error));
  const failRunId = runIds[0];
  const s2status = await waitForRunStatus(failRunId, ['failed', 'completed']);
  check('ZZZZZ run reached failed', s2status === 'failed', `status=${s2status}`);

  const s2del = await callFn('optionsReplayDelete', { runId: failRunId }, idToken);
  check(
    'delete returned deletedRun:true',
    s2del.data?.['deletedRun'] === true,
    JSON.stringify(s2del.data ?? s2del.error),
  );
  const s2listGone = !(await docExists(ST_OPTIONS_CONTRACT_LISTS_ROOT, failRunId));
  const s2runGone = !(await docExists(ST_OPTIONS_REPLAY_RUNS_ROOT, failRunId));
  check('run doc deleted', s2runGone);
  check('list doc deleted', s2listGone, `deletedLists=${s2del.data?.['deletedLists']}`);

  // ---------- S3: completed run + analysis → cascade all ----------
  console.log('\n=== S3: SPY run + analysis → cascade ===');
  const s3start = await callFn('optionsReplayStart', {
    templateId: 'csp-45-20',
    symbols: ['SPY'],
    startDate: '2026-01-01',
  }, idToken);
  const s3ids = (s3start.data?.['runIds'] as string[]) ?? [];
  check('start returned one runId', s3ids.length === 1);
  const spyRunId = s3ids[0];
  const s3status = await waitForRunStatus(spyRunId, ['failed', 'completed']);
  check('SPY run completed', s3status === 'completed', `status=${s3status}`);

  const s3ana = await callFn('optionsAnalysisStart', { contractListDocId: spyRunId }, idToken);
  check('analysis accepted', !s3ana.error, JSON.stringify(s3ana.error ?? s3ana.data));
  // Wait for the 6 result docs.
  const deadline = Date.now() + 300_000;
  let ids: string[] = [];
  while (Date.now() < deadline) {
    ids = await resultDocIds(spyRunId);
    if (ids.length >= 6) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  check('6 result docs written', ids.length === 6, `found ${ids.length}`);

  const s3del = await callFn('optionsReplayDelete', { runId: spyRunId }, idToken);
  check(
    'cascade counts run+list+6 results',
    s3del.data?.['deletedRun'] === true &&
      s3del.data?.['deletedLists'] === 1 &&
      s3del.data?.['deletedResults'] === 6,
    JSON.stringify(s3del.data ?? s3del.error),
  );
  const s3runGone = !(await docExists(ST_OPTIONS_REPLAY_RUNS_ROOT, spyRunId));
  const s3listGone = !(await docExists(ST_OPTIONS_CONTRACT_LISTS_ROOT, spyRunId));
  const s3resultsGone = (await resultDocIds(spyRunId)).length === 0;
  check('run doc deleted', s3runGone);
  check('list doc deleted', s3listGone);
  check('all result docs deleted', s3resultsGone);

  // ---------- S4: re-delete → idempotent no-op ----------
  console.log('\n=== S4: re-delete → idempotent no-op ===');
  const s4 = await callFn('optionsReplayDelete', { runId: spyRunId }, idToken);
  check(
    're-delete returns all-zero counts',
    s4.data?.['deletedRun'] === false &&
      s4.data?.['deletedLists'] === 0 &&
      s4.data?.['deletedResults'] === 0,
    JSON.stringify(s4.data ?? s4.error),
  );
  const s4bad = await callFn('optionsReplayDelete', { runId: 'qa-never-existed' }, idToken);
  check(
    'never-existed runId also a clean no-op',
    s4bad.data?.['deletedRun'] === false && s4bad.data?.['deletedResults'] === 0,
    JSON.stringify(s4bad.data ?? s4bad.error),
  );

  // ---------- cleanup ----------
  await getAuth(app).deleteUser(QA_UID).catch(() => undefined);
  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('driver crashed:', e);
  process.exit(1);
});
