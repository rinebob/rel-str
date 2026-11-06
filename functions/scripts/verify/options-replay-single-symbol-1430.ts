/**
 * Read-only audit for #1430 — verifies the single-symbol Selection Replay
 * model against live Firestore:
 *
 *   st-options-replay-runs/{runId}      — one doc per (template, symbol,
 *                                         startDate); scalar `symbol`, no
 *                                         `symbols[]`/`listOutcomes`/counters;
 *                                         runId ends with `_{SYMBOL}`
 *   st-options-contract-lists/{runId}   — listDocId IS the runId (1:1)
 *   st-options-analysis-results/{runId}_{exitId}
 *                                       — result keying off the runId
 *
 *   FAIL (drives exit 1):
 *   - new-model run missing scalar `symbol`, or `symbol` doesn't match the
 *     runId's `_{SYMBOL}` suffix
 *   - run `status` outside OPTIONS_REPLAY_RUN_STATUSES
 *   - `completed` run with no contract-list doc (the worker writes the
 *     list BEFORE close-out — a completed run with no list is corrupt)
 *   - list doc whose `runId`/`symbol` fields disagree with the run
 *   - result doc with no `contractListDocId`, a doc id that isn't
 *     `{contractListDocId}_{exitId}`, or an exitId outside the registry
 *
 *   WARN (reported, does not fail):
 *   - legacy multi-symbol run docs (`symbols[]`/`listOutcomes`/counters) —
 *     expected until the #1430 migration deletes them
 *   - non-completed run with no list doc — legal states: pending/running
 *     may sit before the enqueue, a `failed` run may have died ON the
 *     enqueue (no list doc is ever created), `cancelled` has no guarantee
 *   - run/list status disagreement (transient closeout window)
 *   - result docs keyed off a docId that isn't a live new-model run —
 *     legacy `{runId}_{SYMBOL}` keys or orphans; migration candidates
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/options-replay-single-symbol-1430.ts [--run <runId>]
 *
 * Read-only — never writes. Needs ADC. Exit 0 on clean audit; nonzero on FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
} from '@st/collections';
import {
  OPTIONS_REPLAY_RUN_STATUSES,
  type OptionsContractListDoc,
  type OptionsReplayRunStatus,
} from '@options-replay/contracts';
import { EXIT_STRATEGIES } from '@options-analysis/registry';

interface Finding {
  tier: 'FAIL' | 'WARN';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const fail = (docId: string, detail: string) => findings.push({ tier: 'FAIL', docId, detail });
const warn = (docId: string, detail: string) => findings.push({ tier: 'WARN', docId, detail });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Legacy multi-symbol envelope fields — presence marks a pre-#1430 doc. */
const LEGACY_FIELDS = ['symbols', 'listOutcomes', 'totalLists', 'completedLists', 'failedLists'];

const EXIT_IDS = new Set(EXIT_STRATEGIES.map((e) => e.exitId));

const argRun = (() => {
  const i = process.argv.indexOf('--run');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

/** Expected list-doc status per run status; undefined = any. */
const LIST_STATUS_BY_RUN: Record<OptionsReplayRunStatus, readonly string[] | undefined> = {
  pending: ['pending', 'running'],
  running: ['pending', 'running'],
  completed: ['success'],
  failed: ['failed'],
  cancelled: undefined, // cancelled runs don't guarantee a list state
};

async function main(): Promise<void> {
  const runsCol = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT);
  const runSnaps = argRun
    ? [await runsCol.doc(argRun).get()].filter((s) => s.exists)
    : (await runsCol.get()).docs;
  console.log(
    `st-options-replay-runs audit: ${runSnaps.length} run doc(s)${argRun ? ` (--run ${argRun})` : ''}`,
  );
  if (runSnaps.length === 0) {
    console.log('EMPTY — no runs to audit');
  }

  let legacyRuns = 0;
  const newRunIds = new Set<string>();

  for (const snap of runSnaps) {
    const d = snap.data() ?? {};
    const legacy = LEGACY_FIELDS.filter((f) => f in d);
    if (legacy.length > 0) {
      legacyRuns++;
      warn(snap.id, `legacy multi-symbol run (${legacy.join(', ')}) — delete per #1430 migration`);
      continue;
    }
    newRunIds.add(snap.id);

    const symbol = d.symbol;
    if (!isStr(symbol)) {
      fail(snap.id, `scalar 'symbol' missing or empty`);
    } else if (!snap.id.endsWith(`_${symbol}`)) {
      fail(snap.id, `symbol '${symbol}' does not match runId '_{SYMBOL}' suffix`);
    }

    const status = d.status as OptionsReplayRunStatus;
    if (!OPTIONS_REPLAY_RUN_STATUSES.includes(status)) {
      fail(snap.id, `status '${d.status}' not in ${OPTIONS_REPLAY_RUN_STATUSES.join('|')}`);
      continue;
    }

    const listSnap = await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(snap.id).get();
    if (!listSnap.exists) {
      if (status === 'completed') {
        // The worker writes the list doc BEFORE closeOutRun flips the run —
        // a completed run with no list doc is genuinely corrupt.
        fail(snap.id, `completed run missing contract-list doc at docId == runId`);
      } else {
        // Every other status can legally lack a list doc: pending/running
        // may sit before the enqueue; a `failed` run may have died ON the
        // enqueue (start writes failed with no list ever created);
        // cancelled guarantees nothing.
        warn(
          snap.id,
          `${status} run has no contract-list doc${isStr(d.error) ? ` — run error: ${d.error}` : ''}`,
        );
      }
      continue;
    }

    const list = listSnap.data() as OptionsContractListDoc;
    if (list.runId !== snap.id) {
      fail(snap.id, `list doc runId '${list.runId}' != docId '${snap.id}'`);
    }
    if (isStr(symbol) && list.symbol !== symbol) {
      fail(snap.id, `list doc symbol '${list.symbol}' != run symbol '${symbol}'`);
    }
    const expected = LIST_STATUS_BY_RUN[status];
    if (expected && !expected.includes(list.status)) {
      // May be a closeout-window read — or a durable legal state: a
      // post-retry enqueue failure leaves run 'failed' + list 'pending'
      // (claimRetry reset the list, failRun re-failed the run).
      warn(
        snap.id,
        `status disagreement — run '${status}' vs list '${list.status}' (expected one of ${expected.join('|')}; transient closeout-window or post-retry enqueue failure)`,
      );
    }
  }

  // ── Analysis-results keying ──────────────────────────────────────────────

  const resultsSnap = argRun
    ? await db
        .collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT)
        .where('contractListDocId', '==', argRun)
        .get()
    : await db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT).get();
  console.log(`st-options-analysis-results audit: ${resultsSnap.size} doc(s)`);

  for (const doc of resultsSnap.docs) {
    const d = doc.data();
    const listDocId = d.contractListDocId;
    if (!isStr(listDocId)) {
      fail(doc.id, `contractListDocId missing or empty`);
      continue;
    }
    const prefix = `${listDocId}_`;
    if (!doc.id.startsWith(prefix)) {
      fail(doc.id, `doc id is not '{contractListDocId}_{exitId}' (field '${listDocId}')`);
      continue;
    }
    const exitId = doc.id.slice(prefix.length);
    if (!EXIT_IDS.has(exitId)) {
      fail(doc.id, `exitId suffix '${exitId}' not in the exit registry`);
    }
    if (!newRunIds.has(listDocId)) {
      warn(
        doc.id,
        `keyed off '${listDocId}' — not a live new-model run id (legacy '{runId}_{SYMBOL}' key or orphan); migration candidate`,
      );
    }
  }

  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(
    `\n${fails.length} FAIL / ${warns.length} WARN — ` +
      `${newRunIds.size} new-model run(s), ${legacyRuns} legacy, ${resultsSnap.size} result doc(s)`,
  );
  if (fails.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('AUDIT PASS');
  }
}

main().catch((err) => {
  console.error(`audit crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
