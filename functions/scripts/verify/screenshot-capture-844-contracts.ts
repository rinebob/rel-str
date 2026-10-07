/**
 * Verification script for Task #844 — grouped-capture contract additions.
 *
 * Runs the real handler end-to-end against production to prove the new
 * contract surface: `groupId` adds a `{symbol}/{groupId}/` directory level
 * in the storage path (all campaign captures list under one prefix), and
 * the strategy `positionType` tags are accepted end-to-end. Writes a real
 * object into the default bucket and checks `exists()` + contentType.
 *
 * Requires ADC (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS). Project: rel-str. Writes real objects
 * under st-trade-screenshots/{SYMBOL}/{GROUP_ID}/.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/screenshot-capture-844-contracts.ts [SYMBOL]
 *   SYMBOL  default GOOG
 */

import { getStorage } from 'firebase-admin/storage';
import '../../src/firebase-admin-init'; // side-effect: default app init

import {
  handleCaptureChartSnapshot,
  parseCaptureChartSpec,
} from '../../src/screenshot-capture/capture-chart';
import { assembleChartModels } from '../../src/screenshot-capture/chart-data-loader';
import { renderChartSvg } from '../../src/screenshot-capture/svg-renderer';
import { rasterizeSvgToPng } from '../../src/screenshot-capture/rasterizer';
import { createArtifactWriter } from '../../src/screenshot-capture/storage-writer';
import {
  CaptureEvent,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';
import {
  SCREENSHOT_STORAGE_PREFIX,
  buildScreenshotStoragePath,
} from '@screenshot-capture/utils';

const SYMBOL = process.argv[2] ?? 'GOOG';
const BUCKET = 'rel-str.appspot.com';
const NOW = new Date('2026-10-05T14:30:22.000Z');
const GROUP_ID = 'verify-cohort-844';

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  console.log(`  ${condition ? '✔' : '✖'} ${label}`);
  if (condition) passed++;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as { code?: string }).code ?? '';
  }
  return '';
}

async function main(): Promise<void> {
  const bucket = getStorage().bucket(BUCKET);
  const deps = {
    assembleChartModels,
    renderChartSvg,
    rasterizeSvgToPng,
    writeArtifact: createArtifactWriter(bucket),
    now: () => NOW,
  };
  const spec = {
    symbol: SYMBOL,
    renderOnly: false,
    event: CaptureEvent.ORDER_FILLED,
    positionType: PositionType.OPTION_SINGLE,
    groupId: GROUP_ID,
    refId: 'leg-1',
    intervals: [ChartInterval.DAILY],
  };
  const request = { data: spec, auth: { uid: 'local-verify' } };

  console.log(`grouped capture ${SYMBOL}/${GROUP_ID} → ${BUCKET}/${SCREENSHOT_STORAGE_PREFIX}/`);

  const result = await handleCaptureChartSnapshot(request, deps);

  check('returns one artifact (daily only)', result.artifacts.length === 1);
  const expected = buildScreenshotStoragePath({
    symbol: SYMBOL,
    event: CaptureEvent.ORDER_FILLED,
    positionType: PositionType.OPTION_SINGLE,
    interval: ChartInterval.DAILY,
    ext: 'svg',
    date: '2026-10-05',
    time: '143022',
    refId: 'leg-1',
    groupId: GROUP_ID,
  });
  check('svg path matches grouped convention', result.artifacts[0].svgPath === expected);
  check('path nests under {symbol}/{groupId}/',
    result.artifacts[0].svgPath?.startsWith(`${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/${GROUP_ID}/`) === true);
  check('path carries the strategy positionType', result.artifacts[0].svgPath?.includes('-option-single-') === true);

  const file = bucket.file(expected);
  const [exists] = await file.exists();
  check('grouped object exists in the bucket', exists);
  if (exists) {
    const [meta] = await file.getMetadata();
    check('contentType image/svg+xml', meta.contentType === 'image/svg+xml');
    const [siblings] = await bucket.getFiles({ prefix: `${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/${GROUP_ID}/` });
    check('group prefix lists the capture', siblings.some((f) => f.name === expected));
  }

  console.log('\n— contract surface —');
  for (const pt of Object.values(PositionType)) {
    check(`positionType '${pt}' parses`, parseCaptureChartSpec({
      symbol: SYMBOL, event: CaptureEvent.MANUAL, positionType: pt,
    }).positionType === pt);
  }
  check('non-string groupId → invalid-argument',
    (await codeOf(() =>
      handleCaptureChartSnapshot({ data: { ...spec, groupId: 42 }, auth: request.auth }, deps),
    )) === 'invalid-argument');

  console.log(`\n${passed}/${checks} checks passed`);
  console.log('Artifacts:');
  result.paths.forEach((p) => console.log(`  gs://${BUCKET}/${p}`));
  if (passed !== checks) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exitCode = 1;
});
