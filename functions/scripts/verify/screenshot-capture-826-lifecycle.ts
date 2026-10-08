/**
 * Verification script for Task #848 — order-lifecycle capture intake
 * (Topic #746 / Thread #826).
 *
 * Exercises `captureLifecycleEvent` end-to-end against production through
 * the real seams (`createLifecycleCaptureDeps`): a seeded scratch carrier
 * doc + one synthetic `order-filled` event → real Firestore transactions +
 * real bucket write. Asserts the full ledger contract:
 *   - outcome 'captured' with artifact paths under
 *     st-trade-screenshots/{SYMBOL}/{GROUP_ID}/
 *   - every artifact exists in the bucket with the right contentType
 *   - the carrier doc's capturedEvents manifest flipped pending → captured
 *   - the st-screenshots index doc landed under the deterministic id
 *   - a second invocation is a no-op (skipped-duplicate, no new objects,
 *     index doc untouched)
 *
 * Requires ADC (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS). Project: rel-str.
 * Writes: the scratch carrier doc st-screenshot-verify/826-lifecycle, one
 * st-screenshots index doc, and real objects under
 * st-trade-screenshots/{SYMBOL}/verify-826-lifecycle/ — all left in place
 * as run evidence (the carrier/index are the ledger the script asserts on).
 * Reruns reset the carrier doc first so each run captures fresh.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/screenshot-capture-826-lifecycle.ts [SYMBOL]
 *   SYMBOL  default GOOG
 */

import type { ScreenshotIndexEntry } from '@screenshot-capture/contracts';
import type { LifecycleCaptureInput } from '../../src/screenshot-capture/lifecycle-capture';

// Locally the admin app has no storageBucket — `initializeApp()` only picks
// one up from FIREBASE_CONFIG on Cloud Run. `createLifecycleCaptureDeps`
// writes through the DEFAULT bucket (`getStorage().bucket()`), so seed
// FIREBASE_CONFIG before any firebase-admin module evaluates — hence the
// dynamic imports below (static imports hoist above top-level statements).
process.env.FIREBASE_CONFIG ??= JSON.stringify({
  projectId: 'rel-str',
  storageBucket: 'rel-str.appspot.com',
});

const { getFirestore } = await import('firebase-admin/firestore');
const { getStorage } = await import('firebase-admin/storage');
await import('../../src/firebase-admin-init'); // side-effect: default app init

const {
  captureLifecycleEvent,
  createLifecycleCaptureDeps,
  screenshotIndexDocId,
} = await import('../../src/screenshot-capture/lifecycle-capture');
const {
  CAPTURED_EVENTS_FIELD,
  enginePositionCarrier,
  screenshotIndexDocPath,
} = await import('../../src/screenshot-capture/tracking');
const {
  CaptureEvent,
  ChartInterval,
  PositionType,
  ST_SCREENSHOTS_COLLECTION,
} = await import('@screenshot-capture/contracts');
const { SCREENSHOT_STORAGE_PREFIX } = await import('@screenshot-capture/utils');

const SYMBOL = (process.argv[2] ?? 'GOOG').toUpperCase();
const BUCKET = 'rel-str.appspot.com';

const CARRIER_PATH = 'st-screenshot-verify/826-lifecycle';
const POSITION_ID = 'verify-826-carrier';
const GROUP_ID = 'verify-826-lifecycle';
const EVENT = CaptureEvent.ORDER_FILLED;
const REF_ID = `${POSITION_ID}-${EVENT}`; // intake default composition
const INDEX_DOC_ID = screenshotIndexDocId(GROUP_ID, REF_ID, EVENT);

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  console.log(`  ${condition ? '✔' : '✖'} ${label}`);
  if (condition) passed++;
}

async function main(): Promise<void> {
  const db = getFirestore();
  const bucket = getStorage().bucket(BUCKET);
  // Real prod seams, but a wider await-cap than the 10s order-path budget:
  // locally (no same-VPC GCS/Firestore, cold resvg) a capture runs ~15-30s.
  // The cap is caller-side accounting only — the detached capture writes
  // either way — so overriding it changes nothing the intake guarantees.
  const deps = { ...createLifecycleCaptureDeps(db), timeoutMs: 120_000 };

  // Clean slate: drop the carrier's dedup ledger and the index doc so a
  // rerun captures fresh instead of skipping on the previous run's entry.
  await db.doc(CARRIER_PATH).delete();
  await db.doc(screenshotIndexDocPath(INDEX_DOC_ID)).delete();
  await db.doc(CARRIER_PATH).set({
    kind: 'verify-scratch',
    note: 'Task #848 lifecycle-capture verify carrier — safe to delete.',
    seededAt: new Date().toISOString(),
  });
  const carrier = enginePositionCarrier(CARRIER_PATH);

  console.log(`lifecycle capture: ${CARRIER_PATH} → ${EVENT} on ${SYMBOL}`);

  const input: LifecycleCaptureInput = {
    positionId: POSITION_ID,
    event: EVENT,
    symbol: SYMBOL,
    positionType: PositionType.OPTION_SINGLE,
    groupId: GROUP_ID,
    carrier,
    intervals: [ChartInterval.DAILY],
  };

  const t0 = Date.now();
  const outcome = await captureLifecycleEvent(input, deps);

  console.log(`\n— outcome —  (capture ran ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check('outcome is captured', outcome.status === 'captured');
  const paths = outcome.status === 'captured' ? outcome.paths : [];
  check('daily interval → svg + png artifacts', paths.length === 2);
  check(
    'paths nest under {symbol}/{groupId}/',
    paths.length > 0 &&
      paths.every((p) => p.startsWith(`${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/${GROUP_ID}/`)),
  );

  console.log('\n— bucket —');
  for (const p of paths) {
    const file = bucket.file(p);
    const [exists] = await file.exists();
    check(`artifact exists: ${p.split('/').pop()}`, exists);
    if (exists) {
      const [meta] = await file.getMetadata();
      const want = p.endsWith('.png') ? 'image/png' : 'image/svg+xml';
      check(`contentType ${want}`, meta.contentType === want);
    }
  }

  console.log('\n— carrier manifest —');
  const carrierSnap = await db.doc(CARRIER_PATH).get();
  const capturedEvents = (carrierSnap.data()?.[CAPTURED_EVENTS_FIELD] ?? {}) as Record<
    string,
    { status?: string; claimedAt?: string; capturedAt?: string; paths?: string[] }
  >;
  const entry = capturedEvents[EVENT];
  check('capturedEvents entry present', !!entry);
  check('entry status captured', entry?.status === 'captured');
  check('entry carries claimedAt + capturedAt', !!entry?.claimedAt && !!entry?.capturedAt);
  check(
    'entry paths match outcome',
    Array.isArray(entry?.paths) && JSON.stringify(entry.paths) === JSON.stringify(paths),
  );

  console.log('\n— st-screenshots index —');
  const indexSnap = await db.collection(ST_SCREENSHOTS_COLLECTION).doc(INDEX_DOC_ID).get();
  check('index doc exists', indexSnap.exists);
  const idx = (indexSnap.data() ?? {}) as Partial<ScreenshotIndexEntry>;
  check('index id is {groupId}-{refId}-{event}', INDEX_DOC_ID === `${GROUP_ID}-${REF_ID}-${EVENT}`);
  check('index positionId', idx.positionId === POSITION_ID);
  check('index refId', idx.refId === REF_ID);
  check('index event', idx.event === EVENT);
  check('index symbol', idx.symbol === SYMBOL);
  check('index positionType', idx.positionType === PositionType.OPTION_SINGLE);
  check('index groupId', idx.groupId === GROUP_ID);
  check(
    'index carrier points at the scratch doc',
    idx.carrier?.kind === 'engine-position' && idx.carrier?.docPath === CARRIER_PATH,
  );
  check(
    'index paths match outcome',
    Array.isArray(idx.paths) && JSON.stringify(idx.paths) === JSON.stringify(paths),
  );

  console.log('\n— dedup rerun —');
  const [before] = await bucket.getFiles({
    prefix: `${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/${GROUP_ID}/`,
  });
  const indexBefore = (await indexSnap.ref.get()).updateTime ?? null;
  const second = await captureLifecycleEvent(input, deps);
  check('second call is skipped-duplicate', second.status === 'skipped-duplicate');
  const [after] = await bucket.getFiles({
    prefix: `${SCREENSHOT_STORAGE_PREFIX}/${SYMBOL}/${GROUP_ID}/`,
  });
  check('no new objects written', after.length === before.length);
  const indexAfter = (await indexSnap.ref.get()).updateTime;
  check(
    'index doc untouched',
    !!indexBefore && !!indexAfter && indexAfter.isEqual(indexBefore),
  );

  console.log(`\n${passed}/${checks} checks passed`);
  console.log('Artifacts:');
  paths.forEach((p) => console.log(`  gs://${BUCKET}/${p}`));
  if (passed !== checks) process.exitCode = 1;
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exitCode = 1;
});
