/**
 * @topic #1238 — Options Backtest, Thread #1240 (Selection Replay)
 * @task #1276 — SHARED: Template registry + collections/rules/indexes
 * @task #1492 — SHARED: Template-shape + named-variant registries
 *
 * Registry tests: seeded entries resolve, unknown ids miss, every template
 * carries a well-formed PickDocCoordinate (delta sign matches option type,
 * positive DTE), and ids are unique. #1492 adds the two-registry model —
 * `REPLAY_TEMPLATE_SHAPES` (generic legs + bands) and `REPLAY_VARIANTS`
 * (concrete named legs) — with `REPLAY_TEMPLATES`/`getReplayTemplate` as
 * the legacy read surface derived from the 1-leg variants.
 * @task #1494 — `validateVariantRegistry` runs over the real registries so
 * data drift fails this suite, not a live run.
 * @task #1495 — SHARED: Seed named variants from catalog (curated-set
 * coverage/band/example pins).
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import {
  legToPickDocCoordinate,
  PICK_GRID_DELTA_BAND,
  PICK_GRID_DELTA_STEP,
  PICK_GRID_DTES,
} from './options-replay-contracts';
import {
  getReplayTemplate,
  getReplayVariant,
  getTemplateShape,
  REPLAY_TEMPLATE_SHAPES,
  REPLAY_TEMPLATES,
  REPLAY_VARIANTS,
  validateVariantRegistry,
  type TemplateShape,
} from './options-replay-templates';
import type { OptionLeg, ReplayVariant, StockLeg, VariantLeg } from './options-replay-contracts';

describe('options-replay-templates', () => {
  describe('REPLAY_TEMPLATES', () => {
    it('is non-empty and seeded with the CSP family', () => {
      expect(REPLAY_TEMPLATES.length).toBeGreaterThanOrEqual(2);
      expect(REPLAY_TEMPLATES.map((t) => t.id)).toEqual(
        expect.arrayContaining(['csp-45-20', 'csp-30-30']),
      );
    });

    it('has no duplicate ids', () => {
      const ids = REPLAY_TEMPLATES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every entry has a well-formed coordinate + display fields', () => {
      // Literal-data guards — a curated entry could carry an empty string or a
      // bad dte/delta literal without a type error.
      for (const t of REPLAY_TEMPLATES) {
        expect(t.id.length).toBeGreaterThan(0);
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.description.length).toBeGreaterThan(0);
        expect(Number.isInteger(t.coordinate.expiry.dte)).toBe(true);
        expect(t.coordinate.expiry.dte).toBeGreaterThan(0);
      }
    });

    it('targetDelta magnitude is in (0,1) and signed by option type', () => {
      for (const t of REPLAY_TEMPLATES) {
        const { type, targetDelta } = t.coordinate;
        expect(Math.abs(targetDelta)).toBeGreaterThan(0);
        expect(Math.abs(targetDelta)).toBeLessThan(1);
        if (type === OptionType.PUT) {
          expect(targetDelta).toBeLessThan(0);
        } else {
          expect(targetDelta).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('getReplayTemplate', () => {
    it('returns the seeded entry on hit', () => {
      expect(getReplayTemplate('csp-45-20')).toMatchObject({
        side: TradeSide.SHORT,
        coordinate: {
          type: OptionType.PUT,
          targetDelta: -0.2,
          expiry: { mode: 'nearestDte', dte: 45 },
        },
      });
    });

    it('returns undefined on miss', () => {
      expect(getReplayTemplate('nope')).toBeUndefined();
      expect(getReplayTemplate('')).toBeUndefined();
    });

    it('round-trips every seeded id', () => {
      for (const t of REPLAY_TEMPLATES) {
        expect(getReplayTemplate(t.id)).toBe(t);
      }
    });
  });

  describe('REPLAY_TEMPLATE_SHAPES (#1492)', () => {
    it('seeds every catalog family', () => {
      const ids = REPLAY_TEMPLATE_SHAPES.map((s) => s.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'short-put', 'long-call', 'long-put', 'short-call',
          'put-credit-spread', 'call-credit-spread',
          'put-debit-spread', 'call-debit-spread',
          'iron-condor', 'iron-butterfly',
          'call-calendar', 'put-calendar',
          'call-diagonal', 'put-diagonal',
          'long-straddle', 'long-strangle', 'short-strangle',
          'covered-call',
        ]),
      );
    });

    // Data-validation coverage (dup ids, per-kind fields, bands-on-grid,
    // no concrete values on shape legs) lives in ONE place — the
    // `validateVariantRegistry()` drift-guard test at the bottom of this
    // file. Hand-rolled copies were deleted so a rule change can't drift
    // between this spec and the validator.
  });

  describe('REPLAY_VARIANTS (#1492/#1495)', () => {
    it('keeps the four legacy templates first, verbatim as 1-leg variants', () => {
      const legacy = REPLAY_VARIANTS.slice(0, 4);
      expect(legacy.map((v) => v.id)).toEqual(['csp-45-20', 'csp-30-30', 'lc-30-20', 'lc-45-15']);
      for (const v of legacy) {
        expect(v.legs).toHaveLength(1);
        expect(v.legs[0].kind).toBe('option');
      }
    });

    it('REPLAY_TEMPLATES derives exactly the single-option-leg variants', () => {
      // Multi-leg variants (#1495) must NOT leak onto the legacy surface —
      // a ReplayTemplate is a single coordinate + side.
      const derivable = REPLAY_VARIANTS.filter(
        (v) => v.legs.length === 1 && v.legs[0].kind === 'option',
      );
      expect(REPLAY_TEMPLATES.map((t) => t.id)).toEqual(derivable.map((v) => v.id));
    });

    it('the pick-doc grid constants pin the catalog menu', () => {
      // Literal tripwire — band checks validate *against* these consts,
      // so a typo inside them is circular-validated without this pin.
      expect(PICK_GRID_DTES).toEqual([7, 14, 21, 30, 45, 60, 90, 120, 180, 365]);
      expect(PICK_GRID_DELTA_STEP).toBe(5);
      expect(PICK_GRID_DELTA_BAND).toEqual([5, 95]);
    });

    it('each variant leg derives the legacy coordinate + side + display fields', () => {
      // Migration parity: the variant must reproduce exactly what the
      // legacy ReplayTemplate carried — coordinate, side, name, description.
      const expected: Record<string, { side: TradeSide; type: OptionType; targetDelta: number; dte: number; name: string; description: string }> = {
        'csp-45-20': { side: TradeSide.SHORT, type: OptionType.PUT, targetDelta: -0.2, dte: 45, name: '45DTE 20Δ put (CSP)', description: 'Sell one 45DTE 20-delta put each trading day — cash-secured-put ladder.' },
        'csp-30-30': { side: TradeSide.SHORT, type: OptionType.PUT, targetDelta: -0.3, dte: 30, name: '30DTE 30Δ put (CSP)', description: 'Sell one 30DTE 30-delta put each trading day — closer cash-secured-put ladder.' },
        'lc-30-20': { side: TradeSide.LONG, type: OptionType.CALL, targetDelta: 0.2, dte: 30, name: '30DTE 20Δ call (LC)', description: 'Buy one 30DTE 20-delta call each trading day — long-call ladder.' },
        'lc-45-15': { side: TradeSide.LONG, type: OptionType.CALL, targetDelta: 0.15, dte: 45, name: '45DTE 15Δ call (LC)', description: 'Buy one 45DTE 15-delta call each trading day — long-call ladder.' },
      };
      // Iterate the EXPECTED ids, not the registry — the audit does the
      // same. The other direction would crash opaquely (undefined.name) on
      // a multi-leg variant (#1495 added stock + multi-leg legs).
      for (const [id, exp] of Object.entries(expected)) {
        const v = getReplayVariant(id);
        if (!v) throw new Error(`variant ${id} missing`);
        expect(v.name).toBe(exp.name);
        expect(v.description).toBe(exp.description);
        expect(v.legs).toHaveLength(1);
        const leg = v.legs[0];
        if (leg.kind !== 'option') throw new Error(`variant ${v.id} leg is not an option leg`);
        expect(leg.side).toBe(exp.side);
        expect(legToPickDocCoordinate(leg)).toEqual({
          type: exp.type,
          targetDelta: exp.targetDelta,
          expiry: { mode: 'nearestDte', dte: exp.dte },
        });
      }
    });

    it('seeds the curated common-case set — one variant per base template', () => {
      // #1495 acceptance: every base template is pickable. `structure`
      // back-references the shape; a shape with no variant is a gap in the
      // curated set, not a validator violation.
      for (const shape of REPLAY_TEMPLATE_SHAPES) {
        const seeded = REPLAY_VARIANTS.filter((v) => v.structure === shape.id);
        expect(seeded.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('every seeded option leg sits INSIDE its shape\'s bands', () => {
      // Curated-set invariant — stricter than the validator (which allows
      // on-grid/off-band as a legal custom point). Position-matched: leg i
      // of the variant sits in leg i of the shape (roles repeat, so index
      // is the identity).
      for (const v of REPLAY_VARIANTS) {
        const shape = REPLAY_TEMPLATE_SHAPES.find((s) => s.id === v.structure);
        if (!shape) throw new Error(`variant ${v.id} has no shape — curated set requires a resolvable structure`);
        if (v.legs.length !== shape.legs.length) {
          throw new Error(`variant ${v.id} has ${v.legs.length} legs, shape ${shape.id} has ${shape.legs.length}`);
        }
        for (const [i, leg] of v.legs.entries()) {
          const slot = shape.legs[i];
          expect(leg.kind).toBe(slot.kind);
          expect(leg.side).toBe(slot.side);
          if (leg.kind === 'option' && slot.kind === 'option') {
            expect(leg.type).toBe(slot.type);
            const mag = Math.round(Math.abs(leg.targetDelta) * 100);
            expect(mag).toBeGreaterThanOrEqual(slot.deltaBand[0]);
            expect(mag).toBeLessThanOrEqual(slot.deltaBand[1]);
            expect(slot.dteBand).toContain(leg.dte);
          }
        }
      }
    });

    it('pins the catalog example variants verbatim', () => {
      // The CATALOG doc's four concrete points — drift here means the
      // seeded menu stopped matching the agreed examples.
      const pcs = getReplayVariant('pcs-45-20-5');
      expect(pcs?.name).toBe('45DTE 20/5Δ put credit spread');
      expect(pcs?.legs).toEqual([
        { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT },
        { kind: 'option', type: OptionType.PUT, targetDelta: -0.05, dte: 45, side: TradeSide.LONG },
      ]);
      const leap = getReplayVariant('lc-365-75');
      expect(leap?.name).toBe('365DTE 75Δ call (LEAP)');
      expect(leap?.legs).toEqual([
        { kind: 'option', type: OptionType.CALL, targetDelta: 0.75, dte: 365, side: TradeSide.LONG },
      ]);
      const cal = getReplayVariant('ccal-30-60-20');
      expect(cal?.name).toBe('30→60DTE 20Δ call calendar');
      expect(cal?.legs).toEqual([
        { kind: 'option', type: OptionType.CALL, targetDelta: 0.2, dte: 30, side: TradeSide.SHORT },
        { kind: 'option', type: OptionType.CALL, targetDelta: 0.2, dte: 60, side: TradeSide.LONG },
      ]);
      const cov = getReplayVariant('cov-45-20');
      expect(cov?.name).toBe('45DTE 20Δ covered call');
      expect(cov?.legs).toEqual([
        { kind: 'stock', side: TradeSide.LONG },
        { kind: 'option', type: OptionType.CALL, targetDelta: 0.2, dte: 45, side: TradeSide.SHORT },
      ]);
    });
  });

  describe('getReplayVariant / getTemplateShape', () => {
    it('resolves all four legacy ids via getReplayVariant', () => {
      for (const id of ['csp-45-20', 'csp-30-30', 'lc-30-20', 'lc-45-15']) {
        expect(getReplayVariant(id)?.id).toBe(id);
      }
      expect(getReplayVariant('nope')).toBeUndefined();
      expect(getReplayVariant('')).toBeUndefined();
    });

    it('resolves every seeded shape via getTemplateShape', () => {
      for (const s of REPLAY_TEMPLATE_SHAPES) {
        expect(getTemplateShape(s.id)).toBe(s);
      }
      expect(getTemplateShape('nope')).toBeUndefined();
      expect(getTemplateShape('')).toBeUndefined();
    });
  });

  describe('validateVariantRegistry (#1494)', () => {
    // Fixture helpers — malformed entries need `as` casts precisely because
    // the type system prevents them; the validator guards the runtime data
    // (JSON paste-back, hand-edited literals), not the compile-time shapes.
    const optLeg = (over: Partial<OptionLeg> = {}): OptionLeg =>
      ({ kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT, ...over }) as OptionLeg;
    const stkLeg = (over: Partial<StockLeg> = {}): StockLeg =>
      ({ kind: 'stock', side: TradeSide.LONG, ...over }) as StockLeg;
    const variant = (id: string, legs: readonly VariantLeg[]): ReplayVariant =>
      ({ id, name: id, description: id, legs });

    it('returns empty for the shipped registries', () => {
      // THE drift guard — any malformed edit to REPLAY_TEMPLATE_SHAPES or
      // REPLAY_VARIANTS fails here.
      expect(validateVariantRegistry()).toEqual([]);
    });

    it('flags a duplicate id across shapes and variants', () => {
      const dup = variant('short-put', [optLeg()]);
      const errs = validateVariantRegistry(undefined, [dup]);
      expect(errs.some((e) => e.includes('duplicate') && e.includes('short-put'))).toBe(true);
    });

    it('flags a duplicate id within one registry', () => {
      const errs = validateVariantRegistry(undefined, [
        variant('v', [optLeg()]),
        variant('v', [optLeg({ type: OptionType.CALL, targetDelta: 0.2 })]),
      ]);
      expect(errs.some((e) => e.includes('duplicate') && e.includes('v'))).toBe(true);
    });

    it('flags an off-grid targetDelta', () => {
      const errs = validateVariantRegistry([], [variant('bad', [optLeg({ targetDelta: -0.22 })])]);
      expect(errs.some((e) => e.includes('bad') && e.includes('-0.22') && e.includes('grid'))).toBe(true);
    });

    it('flags an out-of-band |Δ| even when it is a step multiple', () => {
      // CALL + positive Δ isolates the band check — a put would also trip
      // sign parity and conflate the two classes.
      const errs = validateVariantRegistry([], [
        variant('bad', [optLeg({ type: OptionType.CALL, targetDelta: 1.0 })]),
      ]);
      expect(errs.some((e) => e.includes('bad') && e.includes('grid'))).toBe(true);
    });

    it('round-then-check is deliberate: -0.249 resolves to the 25Δ cell', () => {
      // pickDocDeltaPct derives the wire key the same way — |Δ|×100 rounded.
      // A leg at -0.249 lands on the 25 cell; flagging it would diverge
      // from the grid the pick docs actually key on.
      const errs = validateVariantRegistry([], [variant('ok', [optLeg({ targetDelta: -0.249 })])]);
      expect(errs).toEqual([]);
    });

    it('flags an off-grid dte', () => {
      const errs = validateVariantRegistry([], [variant('bad', [optLeg({ dte: 40 })])]);
      expect(errs.some((e) => e.includes('bad') && e.includes('40') && /dte/i.test(e))).toBe(true);
    });

    it('flags a sign/type mismatch (put with positive Δ)', () => {
      const errs = validateVariantRegistry([], [variant('bad', [optLeg({ targetDelta: 0.2 })])]);
      expect(errs.some((e) => e.includes('bad') && /sign|put|negative/i.test(e))).toBe(true);
    });

    it('flags option legs missing required fields — pinned per class', () => {
      const cases: [OptionLeg, RegExp][] = [
        [{ kind: 'option', targetDelta: -0.2, dte: 45, side: TradeSide.SHORT } as OptionLeg, /type/],
        [{ kind: 'option', type: OptionType.PUT, dte: 45, side: TradeSide.SHORT } as OptionLeg, /targetDelta/],
        [{ kind: 'option', type: OptionType.PUT, targetDelta: -0.2, side: TradeSide.SHORT } as OptionLeg, /dte/i],
        [{ kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45 } as OptionLeg, /side/],
      ];
      for (const [leg, re] of cases) {
        const errs = validateVariantRegistry([], [variant('bad', [leg])]);
        expect(errs.some((e) => e.includes('bad') && re.test(e))).toBe(true);
      }
    });

    it('flags non-finite targetDelta (NaN/Infinity) as missing/invalid', () => {
      for (const d of [NaN, Infinity]) {
        const errs = validateVariantRegistry([], [variant('bad', [optLeg({ targetDelta: d })])]);
        expect(errs.some((e) => e.includes('bad') && /missing\/invalid targetDelta/.test(e))).toBe(true);
      }
    });

    it('flags sign parity in both directions', () => {
      const putPositive = validateVariantRegistry([], [
        variant('p', [optLeg({ type: OptionType.PUT, targetDelta: 0.2 })]),
      ]);
      expect(putPositive.some((e) => e.includes('p') && /non-negative/.test(e))).toBe(true);
      const callNegative = validateVariantRegistry([], [
        variant('c', [optLeg({ type: OptionType.CALL, targetDelta: -0.2 })]),
      ]);
      expect(callNegative.some((e) => e.includes('c') && /non-positive/.test(e))).toBe(true);
    });

    it('flags a stock leg carrying option fields', () => {
      const dirty = { kind: 'stock', side: TradeSide.LONG, targetDelta: 1, dte: 45, type: OptionType.CALL } as unknown as StockLeg;
      const errs = validateVariantRegistry([], [variant('bad', [dirty])]);
      expect(errs.some((e) => e.includes('bad') && /stock/.test(e))).toBe(true);
    });

    it('flags an unknown leg kind', () => {
      const weird = { kind: 'future', side: TradeSide.LONG } as unknown as VariantLeg;
      const errs = validateVariantRegistry([], [variant('bad', [weird])]);
      expect(errs.some((e) => e.includes('bad') && e.includes('future'))).toBe(true);
    });

    it('does not crash on a null leg — reports a violation instead', () => {
      // The dup-leg pass runs over every leg, including ones the field
      // checks already flagged; a null must not TypeError mid-collection.
      const errs = validateVariantRegistry([], [
        variant('bad', [null as unknown as VariantLeg, optLeg()]),
      ]);
      expect(errs.some((e) => e.includes('bad') && /not an object/.test(e))).toBe(true);
    });

    it('flags a variant with no legs', () => {
      const errs = validateVariantRegistry([], [variant('bad', [])]);
      expect(errs.some((e) => e.includes('bad') && /leg/i.test(e))).toBe(true);
    });

    it('flags duplicate legs within a variant (same type+Δ+DTE+side)', () => {
      const leg = optLeg();
      const errs = validateVariantRegistry([], [variant('bad', [leg, { ...leg }])]);
      expect(errs.some((e) => e.includes('bad') && /duplicate/i.test(e))).toBe(true);
    });

    it('does NOT flag same-coordinate legs with different sides', () => {
      // A long 20Δ put and a short 20Δ put are distinct legs.
      const errs = validateVariantRegistry([], [
        variant('ok', [optLeg({ side: TradeSide.LONG }), optLeg({ side: TradeSide.SHORT })]),
      ]);
      expect(errs).toEqual([]);
    });

    it('accepts a stock-only variant — structural validity, not spread realism', () => {
      const errs = validateVariantRegistry([], [variant('shares', [stkLeg()])]);
      expect(errs).toEqual([]);
    });

    it('flags a shape option leg with an off-grid band or empty dteBand', () => {
      const badShape: TemplateShape = {
        id: 's1', name: 's1', description: 's1', structure: 'single',
        legs: [{ role: 'short', kind: 'option', type: OptionType.PUT, side: TradeSide.SHORT, deltaBand: [12, 30], dteBand: [30, 45] }],
      };
      const emptyBand: TemplateShape = {
        id: 's2', name: 's2', description: 's2', structure: 'single',
        legs: [{ role: 'short', kind: 'option', type: OptionType.PUT, side: TradeSide.SHORT, deltaBand: [15, 30], dteBand: [] }],
      };
      const inverted: TemplateShape = {
        id: 's3', name: 's3', description: 's3', structure: 'single',
        legs: [{ role: 'short', kind: 'option', type: OptionType.PUT, side: TradeSide.SHORT, deltaBand: [35, 15], dteBand: [30] }],
      };
      expect(validateVariantRegistry([badShape], []).some((e) => e.includes('s1'))).toBe(true);
      expect(validateVariantRegistry([emptyBand], []).some((e) => e.includes('s2'))).toBe(true);
      expect(validateVariantRegistry([inverted], []).some((e) => e.includes('s3'))).toBe(true);
    });

    it('flags a shape with no legs', () => {
      const s: TemplateShape = { id: 's', name: 's', description: 's', structure: 'custom', legs: [] };
      expect(validateVariantRegistry([s], []).some((e) => e.includes('s') && /leg/i.test(e))).toBe(true);
    });

    it('flags a shape leg carrying concrete targetDelta/dte', () => {
      const s: TemplateShape = {
        id: 's', name: 's', description: 's', structure: 'single',
        legs: [{ role: 'short', kind: 'option', type: OptionType.PUT, side: TradeSide.SHORT, deltaBand: [15, 30], dteBand: [30], targetDelta: -0.2 } as never],
      };
      expect(validateVariantRegistry([s], []).some((e) => e.includes('s') && /concrete/.test(e))).toBe(true);
    });

    it('flags a missing/empty id with its registry index', () => {
      const errs = validateVariantRegistry([], [variant('', [optLeg()])]);
      expect(errs.some((e) => e.includes('variant[0]') && /missing\/empty id/.test(e))).toBe(true);
    });

    it('flags non-array legs', () => {
      const v = { id: 'bad', name: 'b', description: 'b', legs: {} } as unknown as ReplayVariant;
      expect(validateVariantRegistry([], [v]).some((e) => e.includes('bad') && /≥1 leg/.test(e))).toBe(true);
    });

    it('flags a variant structure that resolves to no shape', () => {
      const v = { ...variant('bad', [optLeg()]), structure: 'short-putt' };
      const errs = validateVariantRegistry(REPLAY_TEMPLATE_SHAPES, [v]);
      expect(errs.some((e) => e.includes('bad') && /resolves to no shape/.test(e))).toBe(true);
      // …but 'custom' and a real shape id are legal
      expect(validateVariantRegistry(REPLAY_TEMPLATE_SHAPES, [{ ...v, structure: 'custom' }])).toEqual([]);
      expect(validateVariantRegistry(REPLAY_TEMPLATE_SHAPES, [{ ...v, structure: 'short-put' }])).toEqual([]);
    });

    it('flags a shape structure that is not a TemplateStructure member', () => {
      const s: TemplateShape = {
        id: 's', name: 's', description: 's', structure: 'vertikal' as never,
        legs: [{ role: 'x', kind: 'stock', side: TradeSide.LONG }],
      };
      expect(validateVariantRegistry([s], []).some((e) => e.includes('s') && /TemplateStructure/.test(e))).toBe(true);
    });

    it('flags missing/empty name and description', () => {
      const errs = validateVariantRegistry([], [
        { id: 'bad', name: '', description: 'x', legs: [optLeg()] },
      ]);
      expect(errs.some((e) => e.includes('bad') && /name/.test(e))).toBe(true);
    });

    it('flags shape-domain fields pasted onto variant legs', () => {
      const withRole = { ...optLeg(), role: 'short' } as OptionLeg;
      const withBand = { ...stkLeg(), deltaBand: [15, 30] } as unknown as StockLeg;
      const errs = validateVariantRegistry([], [variant('bad', [withRole, withBand])]);
      expect(errs.some((e) => e.includes('bad') && /shape field 'role'/.test(e))).toBe(true);
      expect(errs.some((e) => e.includes('bad') && /deltaBand/.test(e))).toBe(true);
    });

    it('survives non-array registry arguments — collects, never throws', () => {
      const errs = validateVariantRegistry(null as never, 'x' as never);
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /not an array/.test(e))).toBe(true);
    });
  });
});
