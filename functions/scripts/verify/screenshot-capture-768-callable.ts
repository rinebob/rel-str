/**
 * Verification script for Task #768 — captureChartSnapshot callable.
 *
 * Runs the real handler end-to-end against production: spec validation →
 * Firestore symbol-data bars → indicator series → render model → SVG →
 * real write into the default Storage bucket → exists() + content
 * round-trip. Also exercises the error contract (invalid-argument,
 * failed-precondition) and deterministic-path repeat capture.
 *
 * Requires ADC (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS). Project: rel-str. Writes real objects
 * under st-trade-screenshots/{SYMBOL}/ — that's the artifact store this
 * pipeline exists to populate.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/screenshot-capture-768-callable.ts [SYMBOL]
 *   SYMBOL  default GOOG
 */

import { getStorage } from 'firebase-admin/storage';
import '../../src/firebase-admin-init'; // side-effect: default app init

import { handleCaptureChartSnapshot } from '../../src/screenshot-capture/capture-chart';
import { assembleChartModels } from '../../src/screenshot-capture/chart-data-loader';
import { renderChartSvg } from '../../src/screenshot-capture/svg-renderer';
import { rasterizeSvgToPng } from '../../src/screenshot-capture/rasterizer';
import { createArtifactWriter } from '../../src/screenshot-capture/storage-writer';
import { CaptureEvent, ChartInterval, PositionType } from '@screenshot-capture/contracts';
import { SCREENSHOT_STORAGE_PREFIX } from '@screenshot-capture/utils';

const SYMBOL = process.argv[2] ?? 'GOOG';
// Default bucket — mirrors storageBucket in src/environments/*.ts. Passed
// explicitly because parameterless bucket() only resolves under Functions
// runtime config (FIREBASE_CONFIG), not local ADC.
const BUCKET = 'rel-str.appspot.com';
const NOW = new Date('2026-10-05T14:30:22.000Z');

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
    renderOnly: false, // verify real bucket writes
    event: CaptureEvent.MANUAL,
    positionType: PositionType.STOCK,
    refId: 'verify',
    visibleBars: 30,
  };
  const request = { data: spec, auth: { uid: 'local-verify' } };

  console.log(`capture ${SYMBOL} → ${BUCKET}/${SCREENSHOT_STORAGE_PREFIX}/`);

  const result = await handleCaptureChartSnapshot(request, deps);

  check('returns inline svg', result.svg.startsWith('<svg'));
  check('artifacts per default intervals [daily, weekly]',
    result.artifacts.map((a) => a.interval).join(',') === `${ChartInterval.DAILY},${ChartInterval.WEEKLY}`);
  // Post-#769 each artifact contributes [svgPath, pngPath] to `paths`.
  check('paths flatten the artifacts', result.paths.length === 4 &&
    result.artifacts.every((a, i) =>
      result.paths[i * 2] === a.svgPath && result.paths[i * 2 + 1] === a.pngPath));

  const pathRe = new RegExp(
    `^${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/\\d{4}-\\d{2}-\\d{2}-\\d{6}-manual-stock-verify-(daily|weekly)\\.(svg|png)$`,
  );
  check('paths match the storage convention', result.paths.every((p) => pathRe.test(p)));

  for (const artifact of result.artifacts) {
    // renderOnly:false → paths are present; assert the invariant.
    if (!artifact.svgPath) throw new Error(`${artifact.interval} missing svgPath`);
    const file = bucket.file(artifact.svgPath);
    const [exists] = await file.exists();
    check(`${artifact.interval} object exists`, exists);
    if (exists) {
      const [body] = await file.download();
      check(`${artifact.interval} content round-trips`, body.toString('utf-8') === artifact.svg);
      const [meta] = await file.getMetadata();
      check(`${artifact.interval} contentType image/svg+xml`,
        meta.contentType === 'image/svg+xml');
    }
  }

  console.log('\n— deterministic repeat —');
  const again = await handleCaptureChartSnapshot(request, deps);
  check('same spec+timestamp → identical paths', again.paths.join() === result.paths.join());

  console.log('\n— error contract —');
  check('invalid spec → invalid-argument',
    (await codeOf(() =>
      handleCaptureChartSnapshot({ data: { symbol: SYMBOL }, auth: request.auth }, deps),
    )) === 'invalid-argument');
  check('unauthenticated → unauthenticated',
    (await codeOf(() => handleCaptureChartSnapshot({ data: spec }, deps))) === 'unauthenticated');
  check('unknown symbol → failed-precondition',
    (await codeOf(() =>
      handleCaptureChartSnapshot(
        { data: { ...spec, symbol: 'ZZZZ-NOT-A-SYMBOL' }, auth: request.auth },
        deps,
      ),
    )) === 'failed-precondition');

  console.log(`\n${passed}/${checks} checks passed`);
  console.log('Artifacts:');
  result.paths.forEach((p) => console.log(`  gs://${BUCKET}/${p}`));
  if (passed !== checks) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exitCode = 1;
});
