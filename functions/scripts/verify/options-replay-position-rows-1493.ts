/**
 * Read-only audit for #1493 — SHARED Task: position-row v2 schema + v1
 * narrowing shim (Thread #1270 Multi-leg Templates).
 *
 * The task's runtime-visible change is that `shared/options-replay-contracts.ts`
 * gained the v2 row union (`ContractListPositionRow` +
 * `ContractListNoSelectionRow` with required `legMisses`), `schemaVersion: 2`
 * + `legMetas` on `OptionsContractListDoc`, and the narrowing shim
 * (`v1PickToPosition` / `v1RowsToPositionRows` / `v1ListDocToV2`) that lets
 * readers see one schema while prod docs stay v1 until the writer task lands.
 * This script verifies the shim against EVERY REAL prod list doc — not
 * fixtures:
 *
 *   1. DOC NARROW — every `st-options-contract-lists` doc carrying
 *      `pickDocMeta` (the v1 marker) is narrowed via `v1ListDocToV2` and
 *      checked field-for-field: schemaVersion stamped 2, legMetas ===
 *      [pickDocMeta], row count + kind mapping preserved, each position
 *      row's legs[0] carries all 12 PickDocDay fields + side verbatim with
 *      the doc's recorded coordinate stamped, each no-selection row gains
 *      legMisses naming leg 0's coordinate (+reason when known).
 *   2. REPEAT NORMALIZATION — `repeatsPrevious` on a narrowed position is
 *      true iff the v1 row claimed it AND the previous output row is a
 *      position AND the legs still match — a gap, first row, or
 *      contractId change can never repeat.
 *   3. V2-AWARE — a doc already carrying `schemaVersion: 2` is skipped as
 *      already-v2 (counted, not narrowed) — the shim must not re-mangle it.
 *
 *   WARN (reported, does not fail):
 *   - docs whose rows aren't v1-shaped (neither pick nor no-selection)
 *   - zero list docs — nothing to audit
 *   - `--run <id>` matching no list doc — operator error, not an empty set
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/options-replay-position-rows-1493.ts [--run <runId>]
 *
 * Read-only — never writes. Needs ADC. Exit 0 on clean audit; nonzero on FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import { ST_OPTIONS_CONTRACT_LISTS_ROOT } from '@st/collections';
import {
  positionRepeatsPrevious,
  v1ListDocToV2,
  type OptionsContractListDoc,
  type OptionsContractListDocV1,
  type PickDocCoordinate,
  type PickDocDay,
} from '@options-replay/contracts';

interface Finding {
  tier: 'FAIL' | 'WARN';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const fail = (docId: string, detail: string) => findings.push({ tier: 'FAIL', docId, detail });
const warn = (docId: string, detail: string) => findings.push({ tier: 'WARN', docId, detail });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const DAY_FIELDS: readonly (keyof PickDocDay)[] = [
  'underlyingClose',
  'contractId',
  'expiration',
  'dte',
  'strike',
  'delta',
  'iv',
  'mark',
  'bid',
  'ask',
  'volume',
  'openInterest',
];

function coordEqual(a: PickDocCoordinate, b: PickDocCoordinate | undefined): boolean {
  if (!b?.expiry) return false;
  return (
    a.type === b.type &&
    a.targetDelta === b.targetDelta &&
    a.expiry.mode === b.expiry.mode &&
    a.expiry.dte === b.expiry.dte
  );
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const argRun = (() => {
  const i = process.argv.indexOf('--run');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
// Distinguish "no flag" (full audit) from "flag with no value" (usage error).
const runFlagWithoutValue = process.argv.includes('--run') && !isStr(argRun);

async function main(): Promise<void> {
  if (runFlagWithoutValue) {
    fail('args', '--run flag present without a runId — usage: --run <runId>');
  }

  const listsCol = db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT);
  const listSnaps = argRun
    ? [await listsCol.doc(argRun).get()].filter((s) => s.exists)
    : (await listsCol.get()).docs;
  console.log(
    `st-options-contract-lists audit: ${listSnaps.length} list doc(s)` +
      (argRun ? ` (--run ${argRun})` : ''),
  );
  if (listSnaps.length === 0) {
    // Distinguish a mistyped --run id from a genuinely empty collection —
    // the former is operator error, the latter is "nothing to audit".
    warn('collection', argRun
      ? `--run '${argRun}' matched no list doc`
      : 'no list docs — v1 narrowing unverifiable');
  }

  let v1Docs = 0;
  let v2Docs = 0;
  let positions = 0;
  let markers = 0;

  for (const snap of listSnaps) {
    const d = snap.data() ?? {};
    if (d['schemaVersion'] === 2) {
      v2Docs++;
      continue; // already v2 — the shim doesn't apply
    }
    if (!d['pickDocMeta']) {
      warn(snap.id, 'no schemaVersion and no pickDocMeta — not a v1 doc the shim can narrow');
      continue;
    }
    v1Docs++;
    const doc = d as OptionsContractListDocV1;
    const coordinate = doc.pickDocMeta.coordinate;
    let v2: OptionsContractListDoc;
    try {
      v2 = v1ListDocToV2(doc);
    } catch (err) {
      fail(snap.id, `v1ListDocToV2 threw: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // Doc-level invariants.
    if (v2.schemaVersion !== 2) fail(snap.id, `schemaVersion ${v2.schemaVersion} != 2`);
    if (v2.legMetas.length !== 1 || !jsonEqual(v2.legMetas[0], doc.pickDocMeta)) {
      fail(snap.id, 'legMetas is not [pickDocMeta] verbatim');
    }
    for (const field of ['runId', 'symbol', 'templateId', 'status', 'generatedAt', 'error'] as const) {
      if (!jsonEqual(v2[field], doc[field])) {
        fail(snap.id, `passthrough field '${field}' drifted`);
      }
    }
    if (v2.rows.length !== doc.rows.length) {
      fail(snap.id, `row count drifted: ${v2.rows.length} != ${doc.rows.length}`);
    }

    const count = Math.min(v2.rows.length, doc.rows.length);
    for (let i = 0; i < count; i++) {
      const before = doc.rows[i];
      const after = v2.rows[i];
      const tag = `${snap.id}.rows[${i}]`;

      if (before.kind === 'pick') {
        positions++;
        if (after.kind !== 'position') {
          fail(tag, `pick narrowed to kind '${after.kind}'`);
          continue;
        }
        if (after.legs.length !== 1 || after.legs[0].kind !== 'option') {
          fail(tag, `position legs not a single option leg (${JSON.stringify(after.legs)})`);
          continue;
        }
        const leg = after.legs[0];
        for (const f of DAY_FIELDS) {
          if (leg[f] !== before[f]) {
            fail(tag, `day field '${f}' drifted: ${JSON.stringify(leg[f])} != ${JSON.stringify(before[f])}`);
          }
        }
        if (leg.side !== before.side) fail(tag, `side drifted: ${leg.side} != ${before.side}`);
        if (!coordEqual(leg.coordinate, coordinate)) {
          fail(tag, `leg coordinate != pickDocMeta.coordinate (${JSON.stringify(leg.coordinate)})`);
        }
        if (after.entryDate !== before.entryDate) {
          fail(tag, `entryDate drifted: ${after.entryDate} != ${before.entryDate}`);
        }
        // Repeat normalization: the flag survives only when the previous
        // OUTPUT row is a position AND the legs still match — a gap,
        // first row, or contractId change can never repeat.
        const prevRow = v2.rows[i - 1];
        const expectRepeat =
          before.repeatsPrevious &&
          prevRow?.kind === 'position' &&
          positionRepeatsPrevious(prevRow.legs, after.legs);
        if (after.repeatsPrevious !== expectRepeat) {
          fail(tag, `repeatsPrevious ${after.repeatsPrevious} != expected ${expectRepeat}`);
        }
      } else if (before.kind === 'no-selection') {
        markers++;
        if (after.kind !== 'no-selection') {
          fail(tag, `no-selection narrowed to kind '${after.kind}'`);
          continue;
        }
        if (after.reason !== before.reason) {
          fail(tag, `reason drifted: ${after.reason} != ${before.reason}`);
        }
        const miss = after.legMisses[0];
        if (
          after.legMisses.length !== 1 ||
          miss.legIndex !== 0 ||
          !coordEqual(miss.coordinate, coordinate) ||
          miss.reason !== before.reason
        ) {
          fail(tag, `legMisses != [{legIndex:0, coordinate, reason}] (${JSON.stringify(after.legMisses)})`);
        }
      } else {
        warn(tag, `row kind '${(before as { kind: unknown }).kind}' is not a v1 row shape — skipped`);
      }
    }
  }

  // Before the summary snapshot — a vacuous audit (nothing narrowed,
  // nothing failed) must surface as a counted WARN, not a silent pass.
  if (v1Docs === 0 && !findings.some((f) => f.tier === 'FAIL')) {
    warn('collection', 'zero v1 docs narrowed — narrowing evidence is empty');
  }
  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) {
    console.log(`${f.tier} ${f.docId}: ${f.detail}`);
  }
  console.log(
    `\n${fails.length} FAIL / ${warns.length} WARN — ` +
      `${v1Docs} v1 doc(s) narrowed (${positions} position rows, ${markers} markers), ${v2Docs} already-v2`,
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
