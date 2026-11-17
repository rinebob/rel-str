/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1542 — SHARED: Manage instance ID generator
 *
 * ID grammar: {SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}, ALL-CAPS, hyphen-
 * delimited — the id is the dedup key, so segments must never carry '-'.
 * ΔLEGS enumerates leg deltas (rounded |Δ|*100) in template-defined
 * order — '50-40' — with 'STK' for stock legs; STOP is 'ALL' or a
 * STOP_CODES key; ad hoc variants ('custom' templateId) emit 'CUSTOM'.
 */

import {
  getManageTemplate,
  getManageVariant,
  MANAGE_CUSTOM_TEMPLATE_ID,
} from './manage-variant-catalog';
import {
  generateManageInstanceId,
  STOP_CODES,
} from './manage-instance-id';
import { TradeSide } from './common';
import { OptionType } from './options-common';
import type { ManageVariant, VariantLeg } from './manage-variant-contracts';

const cds = () => getManageTemplate('cds')!;
const v50 = () => getManageVariant('cds-30-50-40')!;

function variant(legs: VariantLeg[], over: Partial<ManageVariant> = {}): ManageVariant {
  return { ...v50(), ...over, legs };
}

describe('generateManageInstanceId', () => {
  it('builds the full grammar in ALL-CAPS', () => {
    const id = generateManageInstanceId({
      symbol: 'qqq',
      variant: v50(),
      template: cds(),
      mode: 'paper',
      stopType: 'ALL',
    });
    expect(id).toBe('QQQ-CDS-30-50-40-ALL');
    expect(id).toBe(id.toUpperCase());
  });

  it('joins leg deltas in template-defined order (multi-leg ΔLEGS)', () => {
    const id = generateManageInstanceId({
      symbol: 'SPY',
      variant: getManageVariant('cds-45-40-30')!,
      template: cds(),
      mode: 'paper',
      stopType: 'ALL',
    });
    // legs[0] is the 40Δ long call, legs[1] the 30Δ short — ΔLEGS follows
    // template order, not sorted order.
    expect(id).toBe('SPY-CDS-45-40-30-ALL');
  });

  it('emits a seeded real stop code for real mode', () => {
    const id = generateManageInstanceId({
      symbol: 'QQQ',
      variant: v50(),
      template: cds(),
      mode: 'real',
      stopType: 'T8',
    });
    expect(id).toBe('QQQ-CDS-30-50-40-T8');
  });

  it('normalizes symbol case and stop-code case/padding', () => {
    const id = generateManageInstanceId({
      symbol: ' qqq ',
      variant: v50(),
      template: cds(),
      mode: 'real',
      stopType: ' t8 ',
    });
    expect(id).toBe('QQQ-CDS-30-50-40-T8');
  });

  it('emits CUSTOM for an ad hoc variant (custom templateId)', () => {
    const adhoc = variant(v50().legs, { templateId: MANAGE_CUSTOM_TEMPLATE_ID });
    const id = generateManageInstanceId({
      symbol: 'QQQ',
      variant: adhoc,
      mode: 'paper',
      stopType: 'ALL',
    });
    expect(id).toBe('QQQ-CUSTOM-30-50-40-ALL');
  });

  it('emits STK for stock legs in ΔLEGS', () => {
    // Ad hoc variant — the seeded cds template has no stock-leg slot, so
    // a stock-legged variant can't be passed with a conforming template.
    const adhoc = variant(
      [{ kind: 'stock', side: TradeSide.LONG }, v50().legs[0]],
      { templateId: MANAGE_CUSTOM_TEMPLATE_ID },
    );
    const id = generateManageInstanceId({
      symbol: 'QQQ',
      variant: adhoc,
      mode: 'paper',
      stopType: 'ALL',
    });
    expect(id).toBe('QQQ-CUSTOM-30-STK-50-ALL');
  });

  it('throws on empty legs (AC: empty-leg throw)', () => {
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: variant([]),
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow();
  });

  it('throws when legs disagree on expiry (diagonal — grammar carries one DTE)', () => {
    const optLegs = v50().legs.filter((l) => l.kind === 'option');
    const diagonal = variant([{ ...optLegs[0] }, { ...optLegs[1], dte: 45 }]);
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: diagonal,
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow(/expiry|dte/i);
  });

  it('throws when variant.dte disagrees with the legs', () => {
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: variant(v50().legs, { dte: 45 }),
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow();
  });

  it('throws when the passed template mismatches variant.templateId', () => {
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: variant(v50().legs, { templateId: 'other' }),
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow();
  });

  it('throws on a dangling non-custom templateId with no template passed', () => {
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: variant(v50().legs, { templateId: 'missing' }),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow();
  });

  it('throws on hyphenated or empty symbol/stop segments', () => {
    for (const [symbol, stopType] of [
      ['QQ-Q', 'T8'],
      [' ', 'T8'],
      ['QQQ', 'T-8'],
    ]) {
      expect(() =>
        generateManageInstanceId({
          symbol,
          variant: v50(),
          template: cds(),
          mode: 'real',
          stopType,
        }),
      ).toThrow();
    }
  });

  it('rejects paper+real stop combos the mode invariant forbids', () => {
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v50(),
        template: cds(),
        mode: 'paper',
        stopType: 'T8',
      }),
    ).toThrow();
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v50(),
        template: cds(),
        mode: 'real',
        stopType: 'ALL',
      }),
    ).toThrow();
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v50(),
        template: cds(),
        mode: 'real',
        stopType: 'all',
      }),
    ).toThrow();
  });

  it('rejects an unrecognized mode (compile-time union is not a runtime gate)', () => {
    for (const mode of ['PAPER', 'paper ', 'live', '']) {
      expect(() =>
        generateManageInstanceId({
          symbol: 'QQQ',
          variant: v50(),
          template: cds(),
          mode: mode as never,
          stopType: 'ALL',
        }),
      ).toThrow(/InstanceMode/);
    }
  });

  it('rejects non-finite or out-of-domain option-leg deltas', () => {
    const optLegs = v50().legs.filter((l) => l.kind === 'option');
    for (const targetDelta of [NaN, Infinity, -Infinity, 0, 1.5]) {
      // Ad hoc path — a template would reject out-of-band deltas at the
      // conformance gate before ΔLEGS encoding is reached.
      const adhoc = variant(
        [{ ...optLegs[0], targetDelta }, optLegs[1]],
        { templateId: MANAGE_CUSTOM_TEMPLATE_ID },
      );
      expect(() =>
        generateManageInstanceId({
          symbol: 'QQQ',
          variant: adhoc,
          mode: 'paper',
          stopType: 'ALL',
        }),
      ).toThrow(/targetDelta/);
    }
  });

  it('rejects legs that do not conform to the passed template', () => {
    const optLegs = v50().legs.filter((l) => l.kind === 'option');
    // Put legs under the 'cds' (call spread) template — same |Δ|s would
    // mint a byte-identical id without the conformance gate.
    const puts = variant([
      { ...optLegs[0], type: OptionType.PUT, targetDelta: -0.5 },
      { ...optLegs[1], type: OptionType.PUT, targetDelta: -0.4 },
    ]);
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: puts,
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow(/conform/);
    // Three legs under a two-slot template.
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: variant([optLegs[0], optLegs[1], optLegs[0]]),
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow(/conform/);
  });

  it('mints out-of-band ad hoc variants — bands are policy, shape is identity', () => {
    // Ad hoc = template shape + user-chosen delta/dte. A 60Δ/50Δ pair is
    // outside the seeded cds bands (35-55/25-45) but structurally still a
    // call debit spread — it must mint, not throw.
    const optLegs = v50().legs.filter((l) => l.kind === 'option');
    const wide = variant(
      [
        { ...optLegs[0], targetDelta: 0.6, dte: 60 },
        { ...optLegs[1], targetDelta: 0.5, dte: 60 },
      ],
      { dte: 60 },
    );
    const id = generateManageInstanceId({
      symbol: 'QQQ',
      variant: wide,
      template: cds(),
      mode: 'paper',
      stopType: 'ALL',
    });
    expect(id).toBe('QQQ-CDS-60-60-50-ALL');
  });

  it('rejects template + custom-variant pairings', () => {
    const adhoc = variant(v50().legs, { templateId: MANAGE_CUSTOM_TEMPLATE_ID });
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: adhoc,
        template: cds(),
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow();
  });

  it('rejects segment characters outside the grammar charset', () => {
    for (const symbol of ['QQ Q', 'A/B', 'Q+Q']) {
      expect(() =>
        generateManageInstanceId({
          symbol,
          variant: v50(),
          template: cds(),
          mode: 'paper',
          stopType: 'ALL',
        }),
      ).toThrow();
    }
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v50(),
        template: { ...cds(), code: 'Cds' },
        mode: 'paper',
        stopType: 'ALL',
      }),
    ).toThrow();
  });

  it('encodes >2-leg variants arity-generically (synthetic iron condor)', () => {
    // No IC template is seeded — the ad hoc path exercises the 4-piece
    // ΔLEGS encoding a real IC variant will emit under its own code.
    const optLegs = v50().legs.filter((l) => l.kind === 'option');
    const ic = variant(
      [
        { ...optLegs[0], targetDelta: 0.1, dte: 45 },
        { ...optLegs[0], targetDelta: 0.3, dte: 45 },
        { ...optLegs[1], targetDelta: 0.3, dte: 45 },
        { ...optLegs[1], targetDelta: 0.1, dte: 45 },
      ],
      { templateId: MANAGE_CUSTOM_TEMPLATE_ID, dte: 45 },
    );
    const id = generateManageInstanceId({
      symbol: 'SPY',
      variant: ic,
      mode: 'paper',
      stopType: 'ALL',
    });
    expect(id).toBe('SPY-CUSTOM-45-10-30-30-10-ALL');
  });

  it('accepts dotted tickers (BRK.B-class symbols)', () => {
    const id = generateManageInstanceId({
      symbol: 'brk.b',
      variant: v50(),
      template: cds(),
      mode: 'paper',
      stopType: 'ALL',
    });
    expect(id).toBe('BRK.B-CDS-30-50-40-ALL');
  });

  it('rejects an unseeded stop code (STOP_CODES is the vocabulary)', () => {
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v50(),
        template: cds(),
        mode: 'real',
        stopType: 'ZZ9',
      }),
    ).toThrow();
  });

  it('rejects prototype-chain keys (`in` would leak Object.prototype)', () => {
    for (const stopType of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(() =>
        generateManageInstanceId({
          symbol: 'QQQ',
          variant: v50(),
          template: cds(),
          mode: 'real',
          stopType,
        }),
      ).toThrow();
    }
  });
});

describe('STOP_CODES', () => {
  it('is seeded with ALL plus placeholder real codes', () => {
    expect(STOP_CODES['ALL']).toBeDefined();
    expect(Object.keys(STOP_CODES).length).toBeGreaterThan(1);
    expect(STOP_CODES['T8']).toBeDefined();
  });

  it('keys are ALL-CAPS alphanumeric (no hyphens)', () => {
    for (const k of Object.keys(STOP_CODES)) {
      expect(k).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it('is frozen — the seeded vocabulary is not self-extendable', () => {
    expect(() => {
      (STOP_CODES as Record<string, string>)['ZZ9'] = 'injected';
    }).toThrow();
    expect(Object.prototype.hasOwnProperty.call(STOP_CODES, 'ZZ9')).toBe(false);
    expect(() =>
      generateManageInstanceId({
        symbol: 'QQQ',
        variant: v50(),
        template: cds(),
        mode: 'real',
        stopType: 'ZZ9',
      }),
    ).toThrow();
  });
});
