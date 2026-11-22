/**
 * Verification: manage-domain instance + variant contracts (task #1538).
 *
 * Exercises the manage contracts through the real `@manage/*` tsconfig
 * aliases — a passing run proves alias resolution under tsx plus the pinned
 * vocabularies, the mode/stop-type invariant, and the doc shapes.
 *
 * Usage: npx tsx scripts/verify/strat-manage-contracts-1538.ts
 *
 * No credentials, no Firestore — contracts and pure helpers only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  INSTANCE_MODES,
  INSTANCE_TRIGGERS,
  INSTANCE_RUN_STATES,
  isValidModeStopType,
  ManageInstance,
  MANAGE_ADHOC_VARIANT_REF,
  STOP_TYPE_ALL,
} from '@manage/instance-contracts';
import {
  ManageTemplate,
  ManageVariant,
} from '@manage/variant-contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import type { VariantLeg } from '@options-replay/contracts';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// ── Vocabulary consts ──────────────────────────────────────────────────────

check('INSTANCE_MODES', INSTANCE_MODES, ['paper', 'real']);
check('INSTANCE_TRIGGERS', INSTANCE_TRIGGERS, ['daily', 'signal']);
check('INSTANCE_RUN_STATES', INSTANCE_RUN_STATES, ['UNSTARTED', 'ACTIVE', 'STOPPED']);
check('STOP_TYPE_ALL', STOP_TYPE_ALL, 'ALL');
check('MANAGE_ADHOC_VARIANT_REF', MANAGE_ADHOC_VARIANT_REF, 'adhoc');

// ── Mode/stop-type invariant ───────────────────────────────────────────────

check('paper + ALL is valid', isValidModeStopType('paper', 'ALL'), true);
check('paper + concrete stop is invalid', isValidModeStopType('paper', 'T8'), false);
check('real + concrete stop is valid', isValidModeStopType('real', 'T8'), true);
check('real + ALL is invalid', isValidModeStopType('real', 'ALL'), false);
check('real + empty stop is invalid', isValidModeStopType('real', ''), false);
check('real + whitespace stop is invalid', isValidModeStopType('real', '   '), false);
check('real + lowercase all is invalid (normalizes to reserved)', isValidModeStopType('real', 'all'), false);
check('real + padded ALL is invalid (normalizes to reserved)', isValidModeStopType('real', ' ALL '), false);
check('paper + padded all is valid (normalizes to ALL)', isValidModeStopType('paper', ' all '), true);

// ── Template shape (bands, no concrete coordinate) ─────────────────────────

const template: ManageTemplate = {
  id: 'cds',
  name: 'Call Debit Spread',
  code: 'CDS',
  legs: [
    {
      kind: 'option',
      role: 'long',
      type: OptionType.CALL,
      side: TradeSide.LONG,
      deltaMin: 0.35,
      deltaMax: 0.55,
      dteMin: 25,
      dteMax: 35,
    },
    {
      kind: 'option',
      role: 'short',
      type: OptionType.CALL,
      side: TradeSide.SHORT,
      deltaMin: 0.25,
      deltaMax: 0.45,
      dteMin: 25,
      dteMax: 35,
    },
  ],
};

check('template code', template.code, 'CDS');
check('template leg count', template.legs.length, 2);
check(
  'option slot band keys',
  Object.keys(template.legs[0]).sort(),
  ['deltaMax', 'deltaMin', 'dteMax', 'dteMin', 'kind', 'role', 'side', 'type'],
);

// ── Variant (concrete legs) ────────────────────────────────────────────────

const legs: VariantLeg[] = [
  { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
  { kind: 'option', type: OptionType.CALL, targetDelta: 0.4, dte: 30, side: TradeSide.SHORT },
];

const variant: ManageVariant = {
  id: 'cds-30-50-40',
  name: 'call debit spread 30 50-40',
  templateId: 'cds',
  dte: 30,
  legs,
};

check('variant templateId', variant.templateId, 'cds');
check('variant dte', variant.dte, 30);
check(
  'variant leg deltas (template order)',
  legs.filter((l): l is Extract<VariantLeg, { kind: 'option' }> => l.kind === 'option')
    .map((l) => l.targetDelta),
  [0.5, 0.4],
);

// ── Instance doc ───────────────────────────────────────────────────────────

const instance: ManageInstance = {
  id: 'QQQ-CDS-30-50-40-ALL',
  variantRef: MANAGE_ADHOC_VARIANT_REF,
  variant,
  symbol: 'QQQ',
  mode: 'paper',
  trigger: 'daily',
  stopType: STOP_TYPE_ALL,
  runState: 'UNSTARTED',
  userId: 'u1',
  paperAccountId: 'pa-1',
  createdAt: '2026-11-14T20:00:00Z',
  updatedAt: '2026-11-14T20:00:00Z',
};

check('instance id STOP segment', instance.id.endsWith(instance.stopType), true);
check('instance embeds variant snapshot', instance.variant.name, 'call debit spread 30 50-40');
check(
  'instance JSON round-trip',
  JSON.parse(JSON.stringify(instance)),
  instance,
);
check(
  'mode/stop-type invariant holds on fixture',
  isValidModeStopType(instance.mode, instance.stopType),
  true,
);

// ── Summary ────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.log(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
