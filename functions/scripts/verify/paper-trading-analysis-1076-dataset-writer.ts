/**
 * Verification script for Task #1076 — dataset writer + generateTradeDataset.
 *
 * Exercises every pipeline stage this task adds, against REAL prod
 * resources where they exist:
 *   - callable validation (in-process: bad grammar → invalid-argument,
 *     no index doc)
 *   - index-doc lifecycle on real Firestore — generating write, then
 *     writeDataset drives generating → ready (real GCS upload, bytes
 *     read back, header = manifest order) and a forced failure drives
 *     → failed + error
 *   - enqueue seam — attempts a real taskQueue('analysisDatasetTask')
 *     enqueue; post-deploy the stub task flips the doc to 'failed' with
 *     its not-implemented error, proving the whole hop end-to-end.
 *     Pre-deploy the enqueue throws — reported as SKIP, never PASS.
 *
 * Writes two `verify-1076-*` probe docs + one GCS object, all deleted
 * in cleanup. Run from functions/ with ADC:
 *   npx tsx scripts/verify/paper-trading-analysis-1076-dataset-writer.ts
 *
 * Pass: every check prints ✔ (or ⊘ SKIP for the pre-deploy enqueue),
 * exit 0. Fail: ✖ lines + exit 1.
 */

import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';

// taskQueue() needs a project id under local ADC — functions env supplies
// it at deploy; scripts fall back to the project literal.
process.env.GOOGLE_CLOUD_PROJECT ??= 'rel-str';

import { db } from '../../src/firebase-admin-init';
import { TradeSide } from '@common';
import {
  PaperTradingKind,
  PaperTradeStatus,
} from '@paper-trading/contracts';
import {
  ANALYSIS_COLUMNS,
  AnalysisCohort,
  type AnalysisDatasetDoc,
  type AnalysisDatasetTaskPayload,
  type GenerateTradeDatasetRequest,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import {
  analysisDatasetsPath,
  analysisDatasetGcsPath,
} from '@paper-trading/ids';
import {
  handleGenerateTradeDataset,
  type GenerateDatasetDeps,
} from '../../src/paper-trading/analysis/analysis-callables';
import {
  datasetWriterDeps,
  writeDataset,
} from '../../src/paper-trading/analysis/dataset-writer';

let checks = 0;
let failed = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks++;
  console.log(`  ${condition ? '✔' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed++;
}

function skip(label: string, detail: string): void {
  checks++;
  skipped++;
  console.log(`  ⊘ SKIP ${label} — ${detail}`);
}

const PROBE_OK = 'verify-1076-ok';
const PROBE_FAIL = 'verify-1076-fail';
// Parameterless admin init carries no default bucket under local ADC —
// the deployed function resolves it from env; scripts must name it.
const BUCKET = 'rel-str.appspot.com';

function makeRow(tradeId: string, datasetId: string): TradeAnalysisRow {
  return {
    datasetId,
    tradeId,
    signalId: 'sig-probe',
    signalType: 'D_ST_TREND_RIDER_V2_LONG',
    cohortId: null,
    positionGroupId: null,
    symbol: 'AMAT',
    direction: TradeSide.LONG,
    expression: 'EQ',
    captureList: 'PRIMARY',
    sector: 'Technology',
    industry: 'Semis',
    capTier: 'large',
    source: 'live',
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: PaperTradeStatus.CLOSED,
    signalStatus: 'CONFIRMED',
    signalBarDate: '2026-10-01',
    entryDate: '2026-10-01',
    entryPrice: 119.465,
    exitDate: '2026-10-10',
    exitPrice: 131.41,
    qty: 10,
    daysHeld: 9,
    exitReason: 'trailing-8',
    tradeRetPct: 10,
    symbolMovePct: 10,
    realizedPnl: 119.465,
    capitalRequired: 1194.65,
    mfePct: 12,
    maePct: -2,
    mfeDate: '2026-10-08',
    maeDate: '2026-10-02',
    daysToMfe: 7,
    givebackRatio: 0.17,
    excursionSource: 'marks',
    'ind.delta': 1,
    'ind.windowV2': 3,
    'ind.zoneV1': 4,
    'ind.zoneV1Prev': 3,
    'ind.zoneV2': 4,
    'ind.zoneV2Prev': 4,
    'strength.diPlus': 30,
    'strength.diMinus': 10,
    'strength.diHist': 20,
    'strength.adx': 35,
  };
}

const VALID: GenerateTradeDatasetRequest = {
  origin: 'live',
  symbolScope: ['AMAT'],
  signalTypes: ['D_ST_TREND_RIDER_V2_LONG'],
  exitRule: 'trailing-8',
  barRange: { from: '2023-01-01', to: '2026-10-20' },
  entryConvention: 'signal-bar-close',
};

async function docStatus(id: string): Promise<AnalysisDatasetDoc | null> {
  const snap = await db.collection(analysisDatasetsPath()).doc(id).get();
  return snap.exists ? (snap.data() as AnalysisDatasetDoc) : null;
}

async function cleanup(): Promise<void> {
  for (const id of [PROBE_OK, PROBE_FAIL]) {
    await db.collection(analysisDatasetsPath()).doc(id).delete().catch(() => {});
  }
  const bucket = getStorage().bucket(BUCKET);
  await bucket.file(analysisDatasetGcsPath(PROBE_OK)).delete().catch(() => {});
  await db.collection(analysisDatasetsPath()).doc('verify-1076-enqueue').delete().catch(() => {});
}

async function main(): Promise<void> {
  console.log('verify-1076: dataset writer + generateTradeDataset → real prod\n');

  // ── In-process: validation contract ──────────────────────────────
  let sawDoc = false;
  const captureDeps: GenerateDatasetDeps = {
    createIndexDoc: async () => { sawDoc = true; },
    updateIndexDoc: async () => {},
    enqueueTask: async () => {},
    now: () => new Date('2026-10-20T15:30:00Z'),
    nonce: () => 'verify',
  };
  let code = '';
  try {
    await handleGenerateTradeDataset(
      { data: { ...VALID, exitRule: 'not-a-rule' }, auth: { uid: 'u' } },
      captureDeps,
    );
  } catch (e) {
    code = (e as { code?: string }).code ?? '';
  }
  check('bad exit grammar → invalid-argument', code === 'invalid-argument');
  check('invalid run writes no index doc', !sawDoc);

  // ── Real Firestore: valid call → generating doc + enqueue payload ─
  let enqueued: AnalysisDatasetTaskPayload | null = null;
  let minted = '';
  const realWriteDeps: GenerateDatasetDeps = {
    createIndexDoc: async (id, doc) => {
      minted = id;
      // Re-key the probe id so cleanup is deterministic.
      await db.collection(analysisDatasetsPath()).doc(PROBE_OK).set({ ...doc, id: PROBE_OK });
    },
    updateIndexDoc: async (id, fields) => {
      await db.collection(analysisDatasetsPath()).doc(id).set(fields, { merge: true });
    },
    enqueueTask: async (p) => { enqueued = p; },
    now: () => new Date('2026-10-20T15:30:00Z'),
    nonce: () => 'verify-1076',
  };
  const res = await handleGenerateTradeDataset(
    { data: VALID, auth: { uid: 'verify' } }, realWriteDeps);
  check('minted ds-{date}-{origin}-{hash} id', /^ds-\d{8}-live-[0-9a-f]{8}$/.test(res.datasetId), res.datasetId);

  const probe = await docStatus(PROBE_OK);
  check('index doc on real Firestore = generating with full params',
    probe !== null && probe.status === 'generating' &&
    probe.exitRule === 'trailing-8' && probe.entryConvention === 'signal-bar-close' &&
    probe.barRange.from === '2023-01-01' && probe.origin === 'live');
  check('enqueue payload carries datasetId + params',
    enqueued !== null && (enqueued as AnalysisDatasetTaskPayload).datasetId === minted &&
    (enqueued as AnalysisDatasetTaskPayload).params.exitRule === 'trailing-8');

  // ── Real GCS + Firestore: writeDataset success path ─────────────
  const bucket = getStorage().bucket(BUCKET);
  const deps = datasetWriterDeps(db, bucket);
  const rows = [makeRow('probe-t-1', PROBE_OK), makeRow('probe-t-2', PROBE_OK)];
  await writeDataset(rows, PROBE_OK, deps);

  const readyDoc = await docStatus(PROBE_OK);
  check('index doc flipped to ready with rowCount + gcsPath',
    readyDoc?.status === 'ready' && readyDoc.rowCount === 2 &&
    readyDoc.gcsPath === analysisDatasetGcsPath(PROBE_OK));

  const [buf] = await bucket.file(analysisDatasetGcsPath(PROBE_OK)).download();
  const csv = buf.toString('utf8');
  check('GCS object exists, header = manifest order',
    csv.split('\n')[0] === ANALYSIS_COLUMNS.map((c) => c.key).join(','));
  check('CSV preserves 3-decimal fill price losslessly',
    csv.includes('119.465'));

  // ── Forced failure: generating → failed + error ──────────────────
  await db.collection(analysisDatasetsPath()).doc(PROBE_FAIL).set({
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: PROBE_FAIL,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: 'live',
    status: 'generating',
    symbolScope: [],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-20' },
    entryConvention: 'signal-bar-close',
    generatedAt: new Date().toISOString(),
    gcsPath: analysisDatasetGcsPath(PROBE_FAIL),
    tags: [],
  } satisfies AnalysisDatasetDoc);
  await writeDataset([makeRow('probe-t-3', PROBE_FAIL)], PROBE_FAIL, {
    ...deps,
    writeObject: async () => { throw new Error('verify-1076 forced GCS failure'); },
  }).catch(() => {});
  const failDoc = await docStatus(PROBE_FAIL);
  check('writer failure flips doc to failed with error, never wedged',
    failDoc?.status === 'failed' && /forced GCS failure/.test(failDoc.error ?? ''));

  // ── Enqueue seam: real taskQueue → deployed stub → failed ───────
  const enqueueId = 'verify-1076-enqueue';
  // Doc must exist as 'generating' BEFORE enqueue — the stub task
  // merge-writes 'failed' and a late-creating doc would mask it.
  await db.collection(analysisDatasetsPath()).doc(enqueueId).set({
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: enqueueId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: 'live',
    status: 'generating',
    symbolScope: [],
    signalTypes: [],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-20' },
    entryConvention: 'signal-bar-close',
    generatedAt: new Date().toISOString(),
    gcsPath: analysisDatasetGcsPath(enqueueId),
    tags: [],
  } satisfies AnalysisDatasetDoc);
  try {
    await getFunctions().taskQueue('analysisDatasetTask').enqueue({
      datasetId: enqueueId,
      params: VALID,
    } satisfies AnalysisDatasetTaskPayload);
    let flipped = false;
    for (let i = 0; i < 20 && !flipped; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const d = await docStatus(enqueueId);
      flipped = d?.status === 'failed' && /not implemented/.test(d.error ?? '');
    }
    check('task enqueue → deployed stub flips doc to failed (end-to-end)', flipped);
    await db.collection(analysisDatasetsPath()).doc(enqueueId).delete().catch(() => {});
  } catch (e) {
    skip('task enqueue', `queue not reachable — deploy functions first (${(e as Error).message})`);
  }

  console.log(`\n${failed === 0 ? `=== ALL CHECKS PASSED (${skipped} skipped)` : `=== ${failed}/${checks} FAILED`} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((err) => {
    console.error('verify-1076 crashed:', err);
    process.exit(1);
  })
  .finally(cleanup);
