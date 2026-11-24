/**
 * Verification: canonical variant identity (task #1711).
 *
 * Exercises `parseManageInstanceId` + `variantDisplayName` through the
 * real `@manage/*` tsconfig aliases — a passing run proves: the
 * {SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP} grammar parses back to typed
 * segments, generate→parse round-trips for every catalog variant, the
 * display name derives dte-first from structure (the CDS name-segment
 * shuffle fix — stale stored names like 'call debit spread 50-40 30'
 * render 'call debit spread 30 50-40'), every catalog entry's derived
 * name equals its stored name, no duplicate display names, and every
 * malformed/dishonest input fails closed (bad segments, unknown codes,
 * ΔLEGS↔template shape mismatch, non-canonical encodings, STK-only
 * ΔLEGS, CUSTOM spread, unrenderable deltas/dte).
 *
 * Usage: npx tsx scripts/verify/strat-manage-variant-identity-1711.ts
 *
 * No credentials, no Firestore — pure functions over seeded catalog data.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  generateManageInstanceId,
  parseManageInstanceId,
} from '@manage/instance-id';
import { variantDisplayName } from '@manage/variant-display';
import {
  getManageTemplate,
  getManageVariant,
  MANAGE_CUSTOM_TEMPLATE_ID,
  MANAGE_VARIANTS,
} from '@manage/variant-catalog';
import type { ManageVariant } from '@manage/variant-contracts';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const v50 = getManageVariant('cds-30-50-40')!;

// ── Parse: canonical form ────────────────────────────────────────────
check(
  'parse canonical CDS id',
  parseManageInstanceId('QQQ-CDS-30-50-40-ALL'),
  { symbol: 'QQQ', spreadCode: 'CDS', dte: 30, deltaLegs: [50, 40], stop: 'ALL' },
);
check(
  'parse STK piece + CUSTOM spread + real stop',
  parseManageInstanceId('QQQ-CUSTOM-30-STK-50-T8'),
  { symbol: 'QQQ', spreadCode: 'CUSTOM', dte: 30, deltaLegs: ['STK', 50], stop: 'T8' },
);
check(
  'boundary deltas 1 and 100 parse',
  parseManageInstanceId('QQQ-CDS-30-1-100-ALL').deltaLegs,
  [1, 100],
);

// ── Parse: fail-closed on anything the grammar can't emit ────────────
for (const [label, id] of [
  ['too few segments', 'QQQ-CDS-30-ALL'],
  ['non-integer DTE', 'QQQ-CDS-X-50-40-ALL'],
  ['unknown spread code', 'QQQ-FOO-30-50-40-ALL'],
  ['unknown stop code', 'QQQ-CDS-30-50-40-ZZ9'],
  ['numeric-format unknown stop', 'QQQ-CDS-30-50-40-8'],
  ['non-delta ΔLEGS piece', 'QQQ-CDS-30-50-XY-ALL'],
  ['out-of-range delta', 'QQQ-CDS-30-50-150-ALL'],
  ['zero delta', 'QQQ-CDS-30-0-50-ALL'],
  ['leading-zero DTE', 'QQQ-CDS-030-50-40-ALL'],
  ['leading-zero delta', 'QQQ-CDS-30-050-40-ALL'],
  ['lowercase segments', 'qqq-cds-30-50-40-all'],
  ['ΔLEGS under-count vs template', 'QQQ-CDS-30-50-ALL'],
  ['ΔLEGS over-count vs template', 'QQQ-CDS-30-50-40-30-ALL'],
  ['STK under option-only template', 'QQQ-CDS-30-STK-40-ALL'],
  ['IC with CDS leg count', 'QQQ-IC-30-50-40-ALL'],
] as const) {
  check(`parse throws — ${label}`, throws(() => parseManageInstanceId(id)), true);
}

// ── Generate: encodability ───────────────────────────────────────────
const optLegs = v50.legs.filter((l) => l.kind === 'option');
const tinyDelta: ManageVariant = {
  ...v50,
  templateId: MANAGE_CUSTOM_TEMPLATE_ID,
  legs: [{ ...optLegs[0], targetDelta: 0.004 }, optLegs[1]],
};
check(
  'sub-0.5% delta throws at mint (would not round-trip)',
  throws(() =>
    generateManageInstanceId({
      symbol: 'QQQ',
      variant: tinyDelta,
      mode: 'paper',
      stopType: 'ALL',
    }),
  ),
  true,
);

// ── Display name: the CDS shuffle regression ─────────────────────────
check(
  'variant → dte-first name',
  variantDisplayName(v50),
  'call debit spread 30 50-40',
);
check(
  'id → dte-first name (shuffle regression: NOT 50-40 30)',
  variantDisplayName('SPY-CDS-30-50-40-ALL'),
  'call debit spread 30 50-40',
);

// ── Whole-catalog round-trips (offender-reporting) ───────────────────
{
  const nameMisses = MANAGE_VARIANTS.filter(
    (v) => variantDisplayName(v) !== v.name,
  ).map((v) => `${v.id}→${variantDisplayName(v)}`);
  check('every catalog variant: derived name === stored name', nameMisses, []);
}
{
  const rtMisses = MANAGE_VARIANTS.filter((v) => {
    const tpl = getManageTemplate(v.templateId)!;
    const id = generateManageInstanceId({
      symbol: 'QQQ',
      variant: v,
      template: tpl,
      mode: 'paper',
      stopType: 'ALL',
    });
    const p = parseManageInstanceId(id);
    return (
      p.spreadCode !== tpl.code ||
      p.dte !== v.dte ||
      variantDisplayName(id) !== v.name
    );
  }).map((v) => v.id);
  check(
    'every catalog variant: generate → parse → name round-trips',
    rtMisses,
    [],
  );
}
check(
  'no duplicate display names across the catalog',
  new Set(MANAGE_VARIANTS.map((v) => variantDisplayName(v))).size,
  MANAGE_VARIANTS.length,
);

// ── Honest fallbacks + fails ─────────────────────────────────────────
const adhoc: ManageVariant = {
  ...v50,
  templateId: MANAGE_CUSTOM_TEMPLATE_ID,
  name: 'my wide fly',
};
check('custom variant → authored name', variantDisplayName(adhoc), 'my wide fly');
const nonConforming: ManageVariant = {
  ...v50,
  legs: [optLegs[1], optLegs[0]],
  name: 'authored cds-ish',
};
check(
  'non-conforming legs → authored name',
  variantDisplayName(nonConforming),
  'authored cds-ish',
);
check(
  'unrenderable delta → authored name',
  variantDisplayName({
    ...v50,
    legs: [{ ...optLegs[0], targetDelta: Number.NaN }, optLegs[1]],
    name: 'authored',
  }),
  'authored',
);
check(
  'non-integer variant.dte → authored name',
  variantDisplayName({ ...v50, dte: 30.5, name: 'authored' }),
  'authored',
);
check(
  'diagonal legs → authored name',
  variantDisplayName({
    ...v50,
    legs: [optLegs[0], { ...optLegs[1], dte: 45 }],
    name: 'authored',
  }),
  'authored',
);
check(
  'credit-ordered CDS → authored name (direction gate)',
  variantDisplayName({
    ...v50,
    legs: [
      { ...optLegs[0], targetDelta: 0.2 },
      { ...optLegs[1], targetDelta: 0.5 },
    ],
    name: 'authored',
  }),
  'authored',
);
check(
  'CUSTOM-spread id throws (no structure to name)',
  throws(() => variantDisplayName('QQQ-CUSTOM-30-50-40-ALL')),
  true,
);
check(
  'STK-only ΔLEGS id throws (nothing to name)',
  throws(() => variantDisplayName('QQQ-CDS-30-STK-ALL')),
  true,
);
check(
  'null input throws friendly error',
  throws(() => variantDisplayName(null as unknown as ManageVariant)),
  true,
);

if (failures > 0) {
  console.log(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
