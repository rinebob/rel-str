/**
 * Verification script for Task #1073 — trade-analysis contracts.
 *
 * Proves the anchored collection paths and doc shapes round-trip through
 * real Firestore (admin SDK): writes a probe AnalysisDatasetDoc and a
 * probe AnalysisSlice under paper-trading/analysis-{datasets,slices}/items,
 * reads them back field-by-field, then deletes both. Also asserts the
 * manifest ⇄ row-schema bijection at runtime (belt over the jest pin).
 *
 * Requires ADC (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS). Project: rel-str. Writes two probe
 * docs (verify-1073-*) and deletes them in a finally block.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/paper-trading-analysis-1073-contracts.ts
 *
 * Pass: every check prints ✔, exit 0. Fail: ✖ lines + exit 1.
 */

import { db } from '../../src/firebase-admin-init';
import {
  ANALYSIS_COLUMNS,
  AnalysisCohort,
  type AnalysisDatasetDoc,
  type AnalysisSlice,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import {
  analysisDatasetGcsPath,
  analysisDatasetsPath,
  analysisSlicesPath,
} from '@paper-trading/ids';
import { PaperTradingKind } from '@paper-trading/contracts';

let checks = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks++;
  console.log(`  ${condition ? '✔' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed++;
}

const DATASET_ID = 'verify-1073-dataset';
const SLICE_ID = 'verify-1073-slice';
const NOW = '2026-10-20T00:00:00.000Z';

const probeDataset: AnalysisDatasetDoc = {
  kind: PaperTradingKind.ANALYSIS_DATASET,
  id: DATASET_ID,
  createdAt: NOW,
  updatedAt: NOW,
  origin: 'replay',
  status: 'generating',
  symbolScope: ['AMAT'],
  signalTypes: ['D_ST_TREND_RIDER_V2_SHORT'],
  exitRule: 'trailing-8',
  barRange: { from: '2023-01-01', to: '2026-10-15' },
  entryConvention: 'signal-bar-close',
  generatedAt: NOW,
  gcsPath: analysisDatasetGcsPath(DATASET_ID),
  tags: ['verify'],
  notes: 'contract probe — safe to delete',
};

const probeSlice: AnalysisSlice = {
  kind: PaperTradingKind.ANALYSIS_SLICE,
  id: SLICE_ID,
  createdAt: NOW,
  updatedAt: NOW,
  name: 'V2 shorts, adverse zone',
  filters: [
    { column: 'analysisCohort', op: 'in', value: [AnalysisCohort.SIGNAL_EQUITY] },
    { column: 'signalType', op: 'in', value: ['D_ST_TREND_RIDER_V2_SHORT'] },
    { column: 'ind.zoneV2', op: 'range', value: { max: -1 } },
    { column: 'entryDate', op: 'dateRange', value: { from: '2023-01-01' } },
  ],
};

async function main(): Promise<void> {
  console.log('verify-1073: analysis contracts → real Firestore round-trip\n');

  // Path helpers
  check('datasets path', analysisDatasetsPath() === 'paper-trading/analysis-datasets/items', analysisDatasetsPath());
  check('slices path', analysisSlicesPath() === 'paper-trading/analysis-slices/items', analysisSlicesPath());
  check('gcs path', analysisDatasetGcsPath('x') === 'analysis-datasets/x.csv');

  // Manifest ⇄ schema bijection (runtime echo of the jest pin)
  const rowKeys = new Set<keyof TradeAnalysisRow>([
    'datasetId', 'tradeId', 'signalId', 'signalType', 'cohortId',
    'positionGroupId', 'symbol', 'direction', 'expression', 'captureList',
    'sector', 'industry', 'capTier', 'source', 'analysisCohort', 'status',
    'signalStatus', 'signalBarDate', 'entryDate', 'entryPrice', 'exitDate',
    'exitPrice', 'qty', 'daysHeld', 'exitReason', 'tradeRetPct',
    'symbolMovePct', 'realizedPnl', 'capitalRequired', 'mfePct', 'maePct',
    'mfeDate', 'maeDate', 'daysToMfe', 'givebackRatio', 'excursionSource',
    'ind.delta', 'ind.windowV2', 'ind.zoneV1', 'ind.zoneV1Prev',
    'ind.zoneV2', 'ind.zoneV2Prev', 'strength.diPlus', 'strength.diMinus',
    'strength.diHist', 'strength.adx',
  ]);
  const manifestKeys = new Set(ANALYSIS_COLUMNS.map((c) => c.key));
  const missing = [...rowKeys].filter((k) => !manifestKeys.has(k));
  const orphans = [...manifestKeys].filter((k) => !rowKeys.has(k as keyof TradeAnalysisRow));
  check('manifest ⇄ row bijection', missing.length === 0 && orphans.length === 0,
    `missing:[${missing}] orphans:[${orphans}]`);
  check('manifest ordered & unique', manifestKeys.size === ANALYSIS_COLUMNS.length,
    `${ANALYSIS_COLUMNS.length} columns`);

  const datasets = db.collection(analysisDatasetsPath());
  const slices = db.collection(analysisSlicesPath());

  try {
    // Dataset doc round-trip
    await datasets.doc(DATASET_ID).set(probeDataset);
    const dsSnap = await datasets.doc(DATASET_ID).get();
    check('dataset doc written + readable', dsSnap.exists);
    const ds = dsSnap.data() as AnalysisDatasetDoc;
    check('dataset kind', ds.kind === 'analysis-dataset', ds.kind);
    check('dataset status lifecycle seed', ds.status === 'generating');
    check('dataset gcsPath', ds.gcsPath === 'analysis-datasets/verify-1073-dataset.csv', ds.gcsPath);
    check('dataset barRange round-trips', ds.barRange?.from === '2023-01-01' && ds.barRange?.to === '2026-10-15');
    check('dataset tags round-trip', Array.isArray(ds.tags) && ds.tags[0] === 'verify');

    // Slice doc round-trip (discriminated-union filters serialize as plain JSON)
    await slices.doc(SLICE_ID).set(probeSlice);
    const slSnap = await slices.doc(SLICE_ID).get();
    check('slice doc written + readable', slSnap.exists);
    const sl = slSnap.data() as AnalysisSlice;
    check('slice kind', sl.kind === 'analysis-slice', sl.kind);
    check('slice filters round-trip', sl.filters?.length === 4);
    check('range filter shape', (sl.filters?.[2] as { op: string })?.op === 'range');
  } finally {
    await datasets.doc(DATASET_ID).delete().catch(() => undefined);
    await slices.doc(SLICE_ID).delete().catch(() => undefined);
    const gone = await datasets.doc(DATASET_ID).get();
    check('probe docs cleaned up', !gone.exists);
  }

  console.log(`\n${failed === 0 ? '=== ALL CHECKS PASSED' : `=== ${failed}/${checks} FAILED`} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-1073 crashed:', err);
  process.exit(1);
});
