/**
 * Read-only audit for #1492 — SHARED Task: template-shape + named-variant
 * registries (Thread #1270 Multi-leg Templates).
 *
 * The task's runtime-visible change is that `shared/options-replay-templates.ts`
 * became a two-registry model: `REPLAY_TEMPLATE_SHAPES` (generic legs +
 * delta/DTE bands) and `REPLAY_VARIANTS` (concrete named legs), with
 * `REPLAY_TEMPLATES`/`getReplayTemplate` derived from the 1-leg variants
 * as the legacy read surface. This script verifies both registries against
 * the live grid contract and every prod run doc:
 *
 *   1. REGISTRY STRUCTURE — every field/grid/id/duplicate-leg check
 *      delegates to the shared `validateVariantRegistry()` (#1494): unique
 *      ids across shapes+variants, display fields, ≥1 leg, per-kind
 *      required/forbidden fields, bands on the pick-doc grid
 *      (`PICK_GRID_DTES`, Δ step 5 within [5,95]), variant legs on-grid
 *      with sign matching type, `structure` referential integrity (FAIL —
 *      a typo'd shape id is a data bug, not a warn-level hint). The
 *      script-local extras are the zero-evidence guards and the
 *      `getTemplateShape` round-trip.
 *   2. MIGRATION PARITY — the derived `REPLAY_TEMPLATES` reproduce the
 *      four legacy entries verbatim (id/name/description/side/coordinate),
 *      each resolvable via `getReplayTemplate`, `getReplayVariant`, and
 *      `legToPickDocCoordinate`. Zero derived entries = zero evidence = FAIL.
 *   3. PROD COMPAT — every `st-options-replay-runs` doc's `templateId`
 *      resolves via BOTH the legacy `getReplayTemplate` and the new
 *      `getReplayVariant` — no prod run references an id the new registry
 *      can't serve.
 *
 *   WARN (reported, does not fail):
 *   - zero run docs — nothing to audit for Leg 3
 *   - `--run <id>` matching no run doc — operator error, not an empty set
 *   - legacy multi-symbol run docs (`symbols[]`) — migration candidates
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/options-replay-template-registries-1492.ts [--run <runId>]
 *
 * Read-only — never writes. Needs ADC. Exit 0 on clean audit; nonzero on FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import { ST_OPTIONS_REPLAY_RUNS_ROOT } from '@st/collections';
import {
  legToPickDocCoordinate,
  type PickDocCoordinate,
} from '@options-replay/contracts';
import {
  getReplayTemplate,
  getReplayVariant,
  getTemplateShape,
  REPLAY_TEMPLATE_SHAPES,
  REPLAY_TEMPLATES,
  REPLAY_VARIANTS,
  validateVariantRegistry,
} from '@options-replay/templates';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

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
// Distinguish "no flag" (full audit) from "flag with no value" (usage error).
const runFlagWithoutValue = process.argv.includes('--run') && !isStr(argRun);

async function main(): Promise<void> {
  // ── Leg 1: registry structure ───────────────────────────────────────────
  console.log(`registry structure: ${REPLAY_TEMPLATE_SHAPES.length} shape(s), ${REPLAY_VARIANTS.length} variant(s)`);
  if (runFlagWithoutValue) {
    fail('args', '--run flag present without a runId — usage: --run <runId>');
  }
  const structureFindingsBefore = findings.length;
  if (REPLAY_TEMPLATE_SHAPES.length === 0) {
    fail('registry', 'REPLAY_TEMPLATE_SHAPES is empty — zero-evidence pass');
  }
  if (REPLAY_VARIANTS.length === 0) {
    fail('registry', 'REPLAY_VARIANTS is empty — zero-evidence pass');
  }

  // Field/grid/id/duplicate-leg checks delegate to the shared canonical
  // validator (#1494) — this script previously hand-rolled the same rules
  // and the two copies had already begun to diverge.
  for (const violation of validateVariantRegistry()) {
    fail('registry', violation);
  }
  for (const shape of REPLAY_TEMPLATE_SHAPES) {
    if (getTemplateShape(shape.id) !== shape) {
      fail(shape.id, 'getTemplateShape does not round-trip its own entry');
    }
  }
  // Only claim the leg-1 pass when no structure finding was recorded —
  // the exit code is always right either way, but a misleading PASS line
  // under FAILs would muddy the output.
  if (findings.length === structureFindingsBefore) {
    console.log(`PASS registry structure (${REPLAY_TEMPLATE_SHAPES.length} shapes)`);
  }

  // ── Leg 2: migration parity ─────────────────────────────────────────────
  const LEGACY: Record<string, { side: TradeSide; coordinate: PickDocCoordinate; name: string; description: string }> = {
    'csp-45-20': {
      side: TradeSide.SHORT,
      name: '45DTE 20Δ put (CSP)',
      description: 'Sell one 45DTE 20-delta put each trading day — cash-secured-put ladder.',
      coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    },
    'csp-30-30': {
      side: TradeSide.SHORT,
      name: '30DTE 30Δ put (CSP)',
      description: 'Sell one 30DTE 30-delta put each trading day — closer cash-secured-put ladder.',
      coordinate: { type: OptionType.PUT, targetDelta: -0.3, expiry: { mode: 'nearestDte', dte: 30 } },
    },
    'lc-30-20': {
      side: TradeSide.LONG,
      name: '30DTE 20Δ call (LC)',
      description: 'Buy one 30DTE 20-delta call each trading day — long-call ladder.',
      coordinate: { type: OptionType.CALL, targetDelta: 0.2, expiry: { mode: 'nearestDte', dte: 30 } },
    },
    'lc-45-15': {
      side: TradeSide.LONG,
      name: '45DTE 15Δ call (LC)',
      description: 'Buy one 45DTE 15-delta call each trading day — long-call ladder.',
      coordinate: { type: OptionType.CALL, targetDelta: 0.15, expiry: { mode: 'nearestDte', dte: 45 } },
    },
  };
  console.log(`\nmigration parity: ${REPLAY_TEMPLATES.length} derived legacy template(s)`);
  if (REPLAY_TEMPLATES.length === 0) {
    fail('registry', 'derived REPLAY_TEMPLATES is empty — zero-evidence pass');
  }
  for (const [id, exp] of Object.entries(LEGACY)) {
    const entryFindingsBefore = findings.length;
    const t = getReplayTemplate(id);
    if (!t) {
      fail(id, 'getReplayTemplate miss — legacy surface broken');
      continue;
    }
    if (t.name !== exp.name) fail(id, `name drifted: '${t.name}' != '${exp.name}'`);
    if (t.description !== exp.description) fail(id, `description drifted: '${t.description}'`);
    if (t.side !== exp.side) fail(id, `side drifted: ${t.side} != ${exp.side}`);
    if (!coordEqual(t.coordinate, exp.coordinate)) {
      fail(id, `coordinate drifted: ${JSON.stringify(t.coordinate)}`);
    }
    const v = getReplayVariant(id);
    if (!v) {
      fail(id, 'getReplayVariant miss — variant surface broken');
      continue;
    }
    if (v.legs.length !== 1 || v.legs[0].kind !== 'option') {
      fail(id, `variant legs not a single option leg (${JSON.stringify(v.legs)})`);
      continue;
    }
    const leg = v.legs[0];
    // The single-option-leg guard above already proved this is an option
    // leg — this re-check exists solely to narrow VariantLeg → OptionLeg.
    if (leg.kind !== 'option') continue;
    if (leg.side !== exp.side) fail(id, `variant side drifted: ${leg.side} != ${exp.side}`);
    if (!coordEqual(legToPickDocCoordinate(leg), exp.coordinate)) {
      fail(id, `variant leg coordinate drifted: ${JSON.stringify(legToPickDocCoordinate(leg))}`);
    }
    if (findings.length === entryFindingsBefore) {
      console.log(`PASS ${id} → ${JSON.stringify(t.coordinate)}`);
    }
  }
  // The variant-leg field/grid checks and the structure-resolution check
  // that used to live here now run inside validateVariantRegistry() above —
  // one canonical copy. (The structure check upgrades WARN → FAIL: a typo'd
  // shape id is a data bug per the spec, not an ignorable hint.)

  // ── Leg 3: prod run-doc templateId resolution ───────────────────────────
  const runsCol = db.collection(ST_OPTIONS_REPLAY_RUNS_ROOT);
  const runSnaps = argRun
    ? [await runsCol.doc(argRun).get()].filter((s) => s.exists)
    : (await runsCol.get()).docs;
  console.log(`\nst-options-replay-runs audit: ${runSnaps.length} run doc(s)${argRun ? ` (--run ${argRun})` : ''}`);
  if (runSnaps.length === 0) {
    // Distinguish a mistyped --run id from a genuinely empty collection —
    // the former is operator error, the latter is "nothing to audit".
    warn('collection', argRun
      ? `--run '${argRun}' matched no run doc`
      : 'no run docs — prod templateId resolution unverifiable');
  }

  let legacyRuns = 0;
  for (const snap of runSnaps) {
    const d = snap.data() ?? {};
    if ('symbols' in d) {
      legacyRuns++;
      warn(snap.id, 'legacy multi-symbol run — migration candidate');
      continue;
    }
    if (!isStr(d.templateId)) {
      fail(snap.id, 'templateId missing — run cannot resolve a variant');
      continue;
    }
    if (!getReplayTemplate(d.templateId)) {
      fail(snap.id, `templateId '${d.templateId}' does not resolve via getReplayTemplate`);
    }
    if (!getReplayVariant(d.templateId)) {
      fail(snap.id, `templateId '${d.templateId}' does not resolve via getReplayVariant`);
    }
  }

  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(
    `\n${fails.length} FAIL / ${warns.length} WARN — ` +
      `${REPLAY_TEMPLATE_SHAPES.length} shapes, ${REPLAY_VARIANTS.length} variants, ` +
      `${runSnaps.length - legacyRuns} new-model run(s), ${legacyRuns} legacy`,
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
