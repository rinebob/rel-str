/**
 * Unit tests for the variant-builder composition helpers (#1504) — band →
 * picker options, magnitude → signed delta, dialed/scratch → VariantLeg[].
 */
import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { TemplateShape } from '@options-replay/templates';
import {
  REPLAY_TEMPLATE_SHAPES,
  getReplayVariant,
  validateVariantLegs,
} from '@options-replay/templates';
import {
  composeShapeLegs,
  composeScratchLegs,
  defaultDeltaForBand,
  defaultDialedForShape,
  deltaOptionsForBand,
  signedTargetDelta,
  variantToJsonBlock,
} from './variant-builder.utils';

const PUT_CREDIT_SPREAD: TemplateShape = {
  id: 'test-pcs',
  name: 'Put credit spread',
  description: 'short put + long put, same expiry',
  structure: 'vertical-credit',
  legs: [
    { role: 'short', kind: 'option', type: OptionType.PUT, side: TradeSide.SHORT, deltaBand: [15, 30], dteBand: [30, 45] },
    { role: 'long', kind: 'option', type: OptionType.PUT, side: TradeSide.LONG, deltaBand: [5, 20], dteBand: [30, 45] },
  ],
};

const COVERED: TemplateShape = {
  id: 'test-covered',
  name: 'Covered call',
  description: 'long shares + short call',
  structure: 'covered-call',
  legs: [
    { role: 'stock', kind: 'stock', side: TradeSide.LONG },
    { role: 'short', kind: 'option', type: OptionType.CALL, side: TradeSide.SHORT, deltaBand: [15, 35], dteBand: [30, 45] },
  ],
};

describe('deltaOptionsForBand', () => {
  it('returns grid magnitudes inside the band, step 5', () => {
    expect(deltaOptionsForBand([15, 35])).toEqual([15, 20, 25, 30, 35]);
  });

  it('inclusive of band edges', () => {
    expect(deltaOptionsForBand([5, 10])).toEqual([5, 10]);
  });

  it('empty when the band holds no grid value', () => {
    expect(deltaOptionsForBand([51, 54])).toEqual([]);
  });
});

describe('signedTargetDelta', () => {
  it('signs a magnitude by option type', () => {
    expect(signedTargetDelta(OptionType.PUT, 20)).toBeCloseTo(-0.2);
    expect(signedTargetDelta(OptionType.CALL, 20)).toBeCloseTo(0.2);
  });
});

describe('defaultDeltaForBand', () => {
  it('picks the grid value closest to the band midpoint', () => {
    expect(defaultDeltaForBand([15, 35])).toBe(25);
    expect(defaultDeltaForBand([15, 30])).toBe(20); // midpoint 22.5 → nearer of 20/25
  });
});

describe('defaultDialedForShape', () => {
  it('seeds one pick per option leg and null for stock legs', () => {
    const dialed = defaultDialedForShape(COVERED);
    expect(dialed).toHaveLength(2);
    expect(dialed[0]).toBeNull();
    expect(dialed[1]).toEqual({ deltaMag: 25, dte: 30 });
  });
});

describe('composeShapeLegs', () => {
  it('resolves dialed option legs to signed concrete legs', () => {
    const legs = composeShapeLegs(PUT_CREDIT_SPREAD, [
      { deltaMag: 20, dte: 45 },
      { deltaMag: 10, dte: 45 },
    ]);
    expect(legs).toEqual([
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT },
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.1, dte: 45, side: TradeSide.LONG },
    ]);
    expect(validateVariantLegs(legs)).toEqual([]);
  });

  it('passes stock legs through untouched', () => {
    const legs = composeShapeLegs(COVERED, [null, { deltaMag: 30, dte: 30 }]);
    expect(legs[0]).toEqual({ kind: 'stock', side: TradeSide.LONG });
    expect(legs[1]).toEqual({ kind: 'option', type: OptionType.CALL, targetDelta: 0.3, dte: 30, side: TradeSide.SHORT });
  });
});

describe('composeScratchLegs', () => {
  it('converts scratch rows the same way', () => {
    const legs = composeScratchLegs([
      { kind: 'stock', type: OptionType.PUT, side: TradeSide.LONG, deltaMag: 20, dte: 45 },
      { kind: 'option', type: OptionType.PUT, side: TradeSide.SHORT, deltaMag: 25, dte: 30 },
    ]);
    expect(legs).toEqual([
      { kind: 'stock', side: TradeSide.LONG },
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.25, dte: 30, side: TradeSide.SHORT },
    ]);
  });
});

describe('registry round-trip', () => {
  it('dialing every seeded shape to defaults yields valid legs', () => {
    // Every seeded shape's default picks must compose to valid legs — the
    // builder never emits an off-grid coordinate from a shape.
    for (const shape of REPLAY_TEMPLATE_SHAPES) {
      const errs = validateVariantLegs(composeShapeLegs(shape, defaultDialedForShape(shape)));
      expect(errs).toEqual([]);
    }
  });
});

describe('variantToJsonBlock', () => {
  it('emits the paste-ready ReplayVariant fields', () => {
    const variant = getReplayVariant('csp-45-20')!;
    const block = variantToJsonBlock({
      id: 'my-copy',
      name: variant.name,
      description: variant.description,
      structure: variant.structure ?? 'custom',
      legs: variant.legs,
    });
    expect(block).toEqual({
      id: 'my-copy',
      name: '45DTE 20Δ put (CSP)',
      description: variant.description,
      structure: 'short-put',
      legs: variant.legs,
    });
    expect(validateVariantLegs(block.legs)).toEqual([]);
  });
});
