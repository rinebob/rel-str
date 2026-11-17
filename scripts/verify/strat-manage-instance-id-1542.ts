/**
 * Verification: manage instance ID generator (task #1542).
 *
 * Exercises `generateManageInstanceId` + `STOP_CODES` through the real
 * `@manage/*` tsconfig aliases — a passing run proves alias resolution
 * under tsx plus: the ALL-CAPS grammar shape ({SYM}-{SPREAD}-{DTE}-
 * {ΔLEGS}-{STOP}), template-order ΔLEGS with STK stock markers, CUSTOM
 * for ad hoc variants, normalization, mode⇒stop enforcement against
 * STOP_CODES, and every fail-closed reject (multi-expiry, mismatched
 * dte/template, hyphen smuggling, empty legs, garbage mode, non-finite
 * delta, non-conforming legs, prototype-chain + unseeded stop codes, …).
 *
 * Usage: npx tsx scripts/verify/strat-manage-instance-id-1542.ts
 *
 * No credentials, no Firestore — a pure generator over seeded catalog data.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  generateManageInstanceId,
  STOP_CODES,
} from '@manage/instance-id';
import {
  getManageTemplate,
  getManageVariant,
  MANAGE_CUSTOM_TEMPLATE_ID,
  MANAGE_VARIANTS,
  variantMatchesTemplate,
} from '@manage/variant-catalog';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

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

const cds = getManageTemplate('cds')!;
const v50 = getManageVariant('cds-30-50-40')!;

// ── Grammar shape ────────────────────────────────────────────────────
check(
  'paper CDS id',
  generateManageInstanceId({
    symbol: 'qqq',
    variant: v50,
    template: cds,
    mode: 'paper',
    stopType: 'ALL',
  }),
  'QQQ-CDS-30-50-40-ALL',
);
check(
  'real stop code',
  generateManageInstanceId({
    symbol: 'SPY',
    variant: getManageVariant('cds-45-40-30')!,
    template: cds,
    mode: 'real',
    stopType: ' t8 ',
  }),
  'SPY-CDS-45-40-30-T8',
);
check(
  'custom (ad hoc) SPREAD segment',
  generateManageInstanceId({
    symbol: 'QQQ',
    variant: { ...v50, templateId: MANAGE_CUSTOM_TEMPLATE_ID },
    mode: 'paper',
    stopType: 'ALL',
  }),
  'QQQ-CUSTOM-30-50-40-ALL',
);
check('stock leg emits STK (ad hoc path)',
  generateManageInstanceId({
    symbol: 'QQQ',
    variant: {
      ...v50,
      templateId: MANAGE_CUSTOM_TEMPLATE_ID,
      legs: [{ kind: 'stock', side: TradeSide.LONG }, v50.legs[0]],
    },
    mode: 'paper',
    stopType: 'ALL',
  }),
  'QQQ-CUSTOM-30-STK-50-ALL',
);

// ── STOP_CODES vocabulary ────────────────────────────────────────────
check('STOP_CODES has ALL',
  Object.prototype.hasOwnProperty.call(STOP_CODES, 'ALL'), true);
check('STOP_CODES keys are ALL-CAPS alnum',
  Object.keys(STOP_CODES).every((k) => /^[A-Z0-9]+$/.test(k)), true);
check('STOP_CODES is frozen', Object.isFrozen(STOP_CODES), true);

// ── Every seeded variant generates a distinct, grammar-clean id ──────
check(
  'seeded variants produce unique ids',
  (() => {
    const ids = MANAGE_VARIANTS.map((v) =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v,
        template: getManageTemplate(v.templateId),
        mode: 'paper',
        stopType: 'ALL',
      }),
    );
    return new Set(ids).size === ids.length;
  })(),
  true,
);
check(
  'seeded ids carry no lowercase or whitespace',
  MANAGE_VARIANTS.every((v) => {
    const id = generateManageInstanceId({
      symbol: 'QQQ',
      variant: v,
      template: getManageTemplate(v.templateId),
      mode: 'paper',
      stopType: 'ALL',
    });
    return id === id.toUpperCase() && !/\s/.test(id);
  }),
  true,
);

// ── Fail-closed rejects ──────────────────────────────────────────────
const optLegs = v50.legs.flatMap((l) => (l.kind === 'option' ? [l] : []));
const base = {
  symbol: 'QQQ',
  variant: v50,
  template: cds,
  mode: 'paper' as const,
  stopType: 'ALL',
};
check('empty legs throws',
  throws(() => generateManageInstanceId({ ...base, variant: { ...v50, legs: [] } })),
  true);
check('multi-expiry (diagonal) throws',
  throws(() =>
    generateManageInstanceId({
      ...base,
      variant: { ...v50, legs: [{ ...optLegs[0] }, { ...optLegs[1], dte: 45 }] },
    }),
  ),
  true);
check('variant.dte disagreeing with legs throws',
  throws(() => generateManageInstanceId({ ...base, variant: { ...v50, dte: 45 } })),
  true);
check('mismatched template throws',
  throws(() =>
    generateManageInstanceId({ ...base, variant: { ...v50, templateId: 'other' } }),
  ),
  true);
check('dangling templateId without template throws',
  throws(() =>
    generateManageInstanceId({
      symbol: 'QQQ',
      variant: { ...v50, templateId: 'missing' },
      mode: 'paper',
      stopType: 'ALL',
    }),
  ),
  true);
check('hyphenated symbol throws',
  throws(() => generateManageInstanceId({ ...base, symbol: 'QQ-Q' })),
  true);
check('paper + real stop throws',
  throws(() => generateManageInstanceId({ ...base, stopType: 'T8' })),
  true);
check('real + ALL throws',
  throws(() =>
    generateManageInstanceId({ ...base, mode: 'real', stopType: 'ALL' }),
  ),
  true);
check('unseeded stop code throws',
  throws(() =>
    generateManageInstanceId({ ...base, mode: 'real', stopType: 'ZZ9' }),
  ),
  true);
check('prototype-chain stop key throws (constructor leaks via `in`)',
  throws(() =>
    generateManageInstanceId({ ...base, mode: 'real', stopType: 'constructor' }),
  ),
  true);
check('lowercase all still reserved (normalization)',
  throws(() =>
    generateManageInstanceId({ ...base, mode: 'real', stopType: ' all ' }),
  ),
  true);
check('unrecognized mode throws',
  throws(() =>
    generateManageInstanceId({ ...base, mode: 'PAPER' as never, stopType: 'ALL' }),
  ),
  true);
check('non-finite option delta throws',
  throws(() =>
    generateManageInstanceId({
      ...base,
      variant: {
        ...v50,
        legs: [{ ...optLegs[0], targetDelta: NaN }, optLegs[1]],
      },
    }),
  ),
  true);
check('out-of-band but shape-conforming mints (ad hoc is not band-bound)',
  generateManageInstanceId({
    ...base,
    variant: {
      ...v50,
      dte: 60,
      legs: [
        { ...optLegs[0], targetDelta: 0.6, dte: 60 },
        { ...optLegs[1], targetDelta: 0.5, dte: 60 },
      ],
    },
  }),
  'QQQ-CDS-60-60-50-ALL',
);
check('legs not conforming to template throws (put legs under cds)',
  throws(() =>
    generateManageInstanceId({
      ...base,
      variant: {
        ...v50,
        legs: [
          { ...optLegs[0], type: OptionType.PUT, targetDelta: -0.5 },
          { ...optLegs[1], type: OptionType.PUT, targetDelta: -0.4 },
        ],
      },
    }),
  ),
  true);
check('interior-space symbol throws',
  throws(() => generateManageInstanceId({ ...base, symbol: 'QQ Q' })),
  true);

// ── Conformance sanity — seeds still pass their own template gate ────
check(
  'seeds still pass variantMatchesTemplate',
  MANAGE_VARIANTS.every((v) =>
    variantMatchesTemplate(v, getManageTemplate(v.templateId)!),
  ),
  true,
);

if (failures > 0) {
  console.log(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
