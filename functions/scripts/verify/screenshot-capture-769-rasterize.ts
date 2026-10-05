/**
 * Verification script for Task #769 — PNG rasterization in the callable.
 *
 * Runs the real handler end-to-end against production (same flow as the
 * #768 script) and verifies each stored SVG now has a PNG sibling: object
 * exists, downloads with a PNG signature, IHDR dimensions match the spec
 * (800×560 default), contentType image/png, and a non-trivial body (a
 * rendered chart is tens of KB — a blank image would be ~1KB).
 *
 * Requires ADC (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS). Project: rel-str. Writes real objects
 * under st-trade-screenshots/{SYMBOL}/.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/screenshot-capture-769-rasterize.ts [SYMBOL]
 *   SYMBOL  default GOOG
 */

import { getStorage } from 'firebase-admin/storage';
import '../../src/firebase-admin-init'; // side-effect: default app init

import { handleCaptureChartSnapshot } from '../../src/screenshot-capture/capture-chart';
import { assembleChartModels } from '../../src/screenshot-capture/chart-data-loader';
import { renderChartSvg } from '../../src/screenshot-capture/svg-renderer';
import { bundledFontFiles, rasterizeSvgToPng } from '../../src/screenshot-capture/rasterizer';
import { createArtifactWriter } from '../../src/screenshot-capture/storage-writer';
import { CaptureEvent, PositionType } from '@screenshot-capture/contracts';
import { SCREENSHOT_STORAGE_PREFIX } from '@screenshot-capture/utils';

const SYMBOL = process.argv[2] ?? 'GOOG';
// Default bucket — mirrors storageBucket in src/environments/*.ts. Passed
// explicitly because parameterless bucket() only resolves under Functions
// runtime config (FIREBASE_CONFIG), not local ADC.
const BUCKET = 'rel-str.appspot.com';
const NOW = new Date('2026-10-05T14:30:22.000Z');
const EXPECTED_DIMS = { width: 800, height: 560 };
// A real rendered chart PNG is tens of KB; blank is ~1–2KB.
const MIN_PNG_BYTES = 10_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  console.log(`  ${condition ? '✔' : '✖'} ${label}`);
  if (condition) passed++;
}

/** PNG IHDR dimensions (bytes 16–24, big-endian). */
function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
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
    event: CaptureEvent.MANUAL,
    positionType: PositionType.STOCK,
    refId: 'verify',
    visibleBars: 30,
  };
  const request = { data: spec, auth: { uid: 'local-verify' } };

  console.log(`capture ${SYMBOL} → ${BUCKET}/${SCREENSHOT_STORAGE_PREFIX}/ (SVG+PNG)`);

  // Bundled font resolution from the functions/ cwd — proves the deployed
  // lookup path before any bucket traffic.
  check('bundled Roboto TTFs resolve (3 files)', bundledFontFiles().length === 3);

  const result = await handleCaptureChartSnapshot(request, deps);

  check('every artifact carries a pngPath', result.artifacts.every((a) => !!a.pngPath));
  check('paths interleave svg+png per artifact',
    result.artifacts.every((a, i) =>
      result.paths[i * 2] === a.svgPath && result.paths[i * 2 + 1] === a.pngPath));

  for (const artifact of result.artifacts) {
    const pngPath = artifact.pngPath!;
    const pathRe = new RegExp(
      `^${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/\\d{4}-\\d{2}-\\d{2}-\\d{6}-manual-stock-verify-${artifact.interval}\\.png$`,
    );
    check(`${artifact.interval} png path matches convention`, pathRe.test(pngPath));

    const file = bucket.file(pngPath);
    const [exists] = await file.exists();
    check(`${artifact.interval} png object exists`, exists);
    if (!exists) continue;

    const [body] = await file.download();
    check(`${artifact.interval} png signature`, body.subarray(0, 8).equals(PNG_MAGIC));
    const dims = pngDimensions(body);
    check(`${artifact.interval} png dims ${EXPECTED_DIMS.width}×${EXPECTED_DIMS.height}`,
      dims.width === EXPECTED_DIMS.width && dims.height === EXPECTED_DIMS.height);
    check(`${artifact.interval} png non-trivial (> ${MIN_PNG_BYTES / 1000}KB — text rendered)`,
      body.length > MIN_PNG_BYTES);
    const [meta] = await file.getMetadata();
    check(`${artifact.interval} contentType image/png`, meta.contentType === 'image/png');

    const [svgExists] = await bucket.file(artifact.svgPath).exists();
    check(`${artifact.interval} svg sibling still exists`, svgExists);
  }

  console.log(`\n${passed}/${checks} checks passed`);
  console.log('Artifacts:');
  result.paths.forEach((p) => console.log(`  gs://${BUCKET}/${p}`));
  if (passed !== checks) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exitCode = 1;
});
