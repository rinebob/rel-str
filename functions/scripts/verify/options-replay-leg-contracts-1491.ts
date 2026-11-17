/**
 * Read-only audit for #1491 — SHARED Task: leg + variant + request /
 * snapshot contracts (Thread #1270 Multi-leg Templates).
 *
 * The task's runtime-visible change is that `OptionsReplayPermutationPayload`
 * shrank to `{runId, symbol}` — the worker now reads its selection inputs
 * off the run doc (`ReplayPermutationDeps.getRun`), and `OptionLeg` +
 * `legToPickDocCoordinate` became the canonical leg→coordinate derivation.
 * This script verifies both against live data, not fakes:
 *
 *   1. RUN-DOC FIELDS — every new-model `st-options-replay-runs` doc
 *      carries non-empty `templateId` + `startDate`. The shrunken payload
 *      means a doc missing either fails permanently on the next worker
 *      pass or retry — FAIL.
 *   2. COORDINATE PARITY — `legToPickDocCoordinate` applied to the leg
 *      form of every `REPLAY_TEMPLATES` entry reproduces that template's
 *      `coordinate` exactly — proves the derivation on the real curated
 *      registry, not fixtures. Zero registry entries = zero evidence = FAIL.
 *   3. PERSISTED CHAIN — for each completed run with a contract-list doc,
 *      templateId → registry template → legToPickDocCoordinate must equal
 *      the list doc's recorded `pickDocMeta.coordinate` — the derivation
 *      matches what the worker actually persisted.
 *
 *   WARN (reported, does not fail):
 *   - run doc with `variantSnapshot` absent — expected until the writer
 *     stamps it (#1498); counted for visibility
 *   - zero run docs — nothing to audit (fields can't be proven, nothing
 *     is broken either)
 *   - legacy multi-symbol run docs (`symbols[]`) — migration candidates
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/options-replay-leg-contracts-1491.ts [--run <runId>]
 *
 * Read-only — never writes. Needs ADC. Exit 0 on clean audit; nonzero on FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
} from '@st/collections';
import {
  legToPickDocCoordinate,
  templateToOptionLeg,
  type OptionsContractListDocV1,
  type PickDocCoordinate,
} from '@options-replay/contracts';
import { REPLAY_TEMPLATES, getReplayTemplate } from '@options-replay/templates';

interface Finding {
  tier: 'FAIL' | 'WARN';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const fail = (docId: string, detail: string) => findings.push({ tier: 'FAIL', docId, detail });
const warn = (docId: string, detail: string) => findings.push({ tier: 'WARN', docId, detail });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function coordEqual(a: PickDocCoordinate, b: PickDocCoordinate | undefined): boolean {
  // `b` is persisted data — a malformed coordinate (missing `expiry`)
  // must read as a mismatch, not crash the audit.
  if (!b?.expiry) return false;
  return (
    a.type === b.type &&
    a.targetDelta === b.targetDelta &&
    a.expiry.mode === b.expiry.mode &&
    a.expiry.dte === b.expiry.dte
  );
}

const argRun = (() => {
  const i = process.argv.indexOf('--run');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

async function main(): Promise<void> {
  // ── Leg 2: coordinate parity over the real registry ─────────────────────
  console.log(`registry parity: ${REPLAY_TEMPLATES.length} template(s)`);
  if (REPLAY_TEMPLATES.length === 0) {
    fail('registry', 'REPLAY_TEMPLATES is empty — zero-evidence pass');
  }
  for (const t of REPLAY_TEMPLATES) {
    const derived = legToPickDocCoordinate(templateToOptionLeg(t));
    if (!coordEqual(derived, t.coordinate)) {
      fail(t.id, `legToPickDocCoordinate != template.coordinate (${JSON.stringify(derived)})`);
    } else {
      console.log(`PASS ${t.id} → ${JSON.stringify(derived)}`);
    }
  }

  // ── Legs 1 + 3: run-doc fields + persisted-coordinate chain ─────────────
  const runsCol = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT);
  const runSnaps = argRun
    ? [await runsCol.doc(argRun).get()].filter((s) => s.exists)
    : (await runsCol.get()).docs;
  console.log(`\nst-options-replay-runs audit: ${runSnaps.length} run doc(s)${argRun ? ` (--run ${argRun})` : ''}`);
  if (runSnaps.length === 0) {
    warn('collection', 'no run docs — worker getRun inputs unverifiable');
  }

  let missingSnapshot = 0;
  let legacyRuns = 0;
  for (const snap of runSnaps) {
    const d = snap.data() ?? {};
    if ('symbols' in d) {
      legacyRuns++;
      warn(snap.id, 'legacy multi-symbol run — migration candidate');
      continue;
    }

    // Leg 1 — the worker's getRun view must resolve.
    if (!isStr(d.templateId)) fail(snap.id, 'templateId missing — worker getRun cannot resolve');
    if (!isStr(d.startDate)) fail(snap.id, 'startDate missing — worker getRun cannot resolve');
    if (d.variantSnapshot === undefined) missingSnapshot++;

    // Leg 3 — derivation matches what the worker persisted.
    if (!isStr(d.templateId) || d.status !== 'completed') continue;
    const template = getReplayTemplate(d.templateId);
    if (!template) {
      fail(snap.id, `templateId '${d.templateId}' not in registry`);
      continue;
    }
    const listSnap = await db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(snap.id).get();
    if (!listSnap.exists) continue; // covered by the 1430 audit
    const meta = (listSnap.data() as OptionsContractListDocV1).pickDocMeta;
    if (!meta?.coordinate) {
      // A completed run whose list doc lacks pickDocMeta.coordinate is a
      // contract violation, not a skip — the success write always sets it.
      fail(snap.id, 'completed run missing pickDocMeta.coordinate');
    } else if (!coordEqual(legToPickDocCoordinate(templateToOptionLeg(template)), meta.coordinate)) {
      fail(snap.id, `derived coordinate != persisted pickDocMeta.coordinate (${JSON.stringify(meta.coordinate)})`);
    }
  }

  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(
    `\n${fails.length} FAIL / ${warns.length} WARN — ` +
      `${runSnaps.length - legacyRuns} new-model run(s), ${missingSnapshot} without variantSnapshot, ${legacyRuns} legacy`,
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
