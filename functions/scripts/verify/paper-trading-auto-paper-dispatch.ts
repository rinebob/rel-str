/**
 * Manually dispatch a payload to the deployed `stAutoPaperIngest` task
 * queue (#917 wiring, #920 QA, #980 trigger-gate verification).
 *
 * Behavior depends on the payload:
 *   - `triggeredBy: 'pdr' | 'symbol-added'` (or absent) → the task must
 *     skip `st_autopaper_skip reason=non-post-trigger` (#980).
 *   - `triggeredBy: 'manual'` + today's `marketDate` → real ingest runs
 *     (creates / dedupes trades — QA re-dispatch path).
 *   - A non-today `marketDate` → skips `reason=historical-run`.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/paper-trading-auto-paper-dispatch.ts \
 *     [runId] [marketDate] [triggeredBy]
 *
 * Defaults: the most recent completed pdr run id, today's PT date,
 * 'manual'. Verify via `st_autopaper_*` entries in the function log.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFunctions } from 'firebase-admin/functions';
import type { StTriggeredBy } from '../../src/common/st-runs';

initializeApp({
  credential: applicationDefault(),
  projectId: 'rel-str',
  // The task's OIDC audience — from `gcloud functions describe stAutoPaperIngest
  // --gen2` serviceConfig.serviceAccountEmail. Required to mint the task's ID
  // token locally (in-function it resolves from the metadata server).
  serviceAccountId: 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com',
});

const [, , runIdArg, marketDateArg, triggerArg] = process.argv;

const payload = {
  runId: runIdArg ?? '2026-10-12_mon_123022_pdr',
  marketDate: marketDateArg ?? new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  }),
  triggeredBy: (triggerArg ?? 'manual') as StTriggeredBy,
};

await getFunctions().taskQueue('stAutoPaperIngest').enqueue(payload);
console.log('enqueued:', JSON.stringify(payload));
console.log(
  "expected: st_autopaper_ingest_start (manual/nightly, today) | " +
    "st_autopaper_skip reason=non-post-trigger (pdr/symbol-added/absent) | " +
    "reason=historical-run (non-today marketDate)",
);
