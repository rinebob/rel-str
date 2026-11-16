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
} from './options-replay-templates';

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

    it('has no duplicate ids across shapes and variants', () => {
      const ids = [
        ...REPLAY_TEMPLATE_SHAPES.map((s) => s.id),
        ...REPLAY_VARIANTS.map((v) => v.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every shape carries display fields and ≥1 non-empty-role leg', () => {
      for (const shape of REPLAY_TEMPLATE_SHAPES) {
        expect(shape.name.length).toBeGreaterThan(0);
        expect(shape.description.length).toBeGreaterThan(0);
        expect(shape.legs.length).toBeGreaterThan(0);
        for (const leg of shape.legs) {
          expect(leg.role.length).toBeGreaterThan(0);
        }
      }
    });

    it('option legs carry type + bands; stock legs carry neither', () => {
      for (const shape of REPLAY_TEMPLATE_SHAPES) {
        for (const leg of shape.legs) {
          // The kind discriminant itself must be a real value — a mistyped
          // literal ('optin') would otherwise fall into the stock branch
          // and satisfy the absence checks vacuously.
          expect(['option', 'stock']).toContain(leg.kind);
          expect(Object.values(TradeSide)).toContain(leg.side);
          if (leg.kind === 'option') {
            expect(Object.values(OptionType)).toContain(leg.type);
            expect(leg.deltaBand).toHaveLength(2);
            expect(leg.dteBand).toBeDefined();
            // Band sanity beyond membership: non-empty, no duplicates.
            expect(leg.dteBand.length).toBeGreaterThan(0);
            expect(new Set(leg.dteBand).size).toBe(leg.dteBand.length);
          } else {
            // The union makes these unrepresentable at type level — the
            // runtime `in` checks are the surviving guard for literals
            // that bypass authoring (JSON paste-back, `as` casts).
            expect('type' in leg).toBe(false);
            expect('deltaBand' in leg).toBe(false);
            expect('dteBand' in leg).toBe(false);
          }
        }
      }
    });

    it('shape legs carry bands — never concrete targetDelta/dte', () => {
      // The defining semantic of a shape: bounds for the FE dials, no values.
      for (const shape of REPLAY_TEMPLATE_SHAPES) {
        for (const leg of shape.legs) {
          expect('targetDelta' in leg).toBe(false);
          expect('dte' in leg).toBe(false);
        }
      }
    });

    it('every band falls on the pick-doc grid', () => {
      for (const shape of REPLAY_TEMPLATE_SHAPES) {
        for (const leg of shape.legs) {
          if (leg.kind !== 'option') continue;
          for (const bound of leg.deltaBand) {
            expect(bound % PICK_GRID_DELTA_STEP).toBe(0);
            expect(bound).toBeGreaterThanOrEqual(PICK_GRID_DELTA_BAND[0]);
            expect(bound).toBeLessThanOrEqual(PICK_GRID_DELTA_BAND[1]);
          }
          expect(leg.deltaBand[0]).toBeLessThanOrEqual(leg.deltaBand[1]);
          for (const dte of leg.dteBand) {
            expect(PICK_GRID_DTES).toContain(dte);
          }
        }
      }
    });
  });

  describe('REPLAY_VARIANTS (#1492)', () => {
    it('migrates all four legacy templates verbatim as 1-leg variants', () => {
      const ids = REPLAY_VARIANTS.map((v) => v.id);
      expect(ids).toEqual(['csp-45-20', 'csp-30-30', 'lc-30-20', 'lc-45-15']);
      for (const v of REPLAY_VARIANTS) {
        expect(v.legs).toHaveLength(1);
        expect(v.legs[0].kind).toBe('option');
      }
    });

    it('every variant carries display fields', () => {
      for (const v of REPLAY_VARIANTS) {
        expect(v.name.length).toBeGreaterThan(0);
        expect(v.description.length).toBeGreaterThan(0);
      }
    });

    it('every variant leg is well-formed for its kind', () => {
      for (const v of REPLAY_VARIANTS) {
        expect(v.legs.length).toBeGreaterThan(0);
        for (const leg of v.legs) {
          expect(['option', 'stock']).toContain(leg.kind);
          expect(Object.values(TradeSide)).toContain(leg.side);
          if (leg.kind === 'option') {
            expect(Object.values(OptionType)).toContain(leg.type);
            expect(Number.isFinite(leg.targetDelta)).toBe(true);
            expect(Number.isInteger(leg.dte)).toBe(true);
            expect(leg.dte).toBeGreaterThan(0);
          } else {
            expect('type' in leg).toBe(false);
            expect('targetDelta' in leg).toBe(false);
            expect('dte' in leg).toBe(false);
          }
        }
      }
    });

    it('every variant option leg is on-grid with sign matching its type', () => {
      // Registry-data validation (distinct from #1494's validator function):
      // a malformed entry — dte: 32, put with +0.2 — must fail here, not at
      // a live run. `pickDocDeltaPct` convention: round(|\Delta|×100).
      for (const v of REPLAY_VARIANTS) {
        for (const leg of v.legs) {
          if (leg.kind !== 'option') continue;
          const mag = Math.round(Math.abs(leg.targetDelta) * 100);
          expect(mag % PICK_GRID_DELTA_STEP).toBe(0);
          expect(mag).toBeGreaterThanOrEqual(PICK_GRID_DELTA_BAND[0]);
          expect(mag).toBeLessThanOrEqual(PICK_GRID_DELTA_BAND[1]);
          expect(PICK_GRID_DTES).toContain(leg.dte);
          if (leg.type === OptionType.PUT) {
            expect(leg.targetDelta).toBeLessThan(0);
          } else if (leg.type === OptionType.CALL) {
            expect(leg.targetDelta).toBeGreaterThan(0);
          } else {
            throw new Error(`variant ${v.id} leg type is neither PUT nor CALL`);
          }
        }
      }
    });

    it('REPLAY_TEMPLATES derives exactly the single-option-leg variants', () => {
      // Once #1495 lands multi-leg variants, they must NOT leak onto the
      // legacy surface — a ReplayTemplate is a single coordinate + side.
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
      // the first non-legacy variant #1495 adds.
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

    it('every variant structure resolves to a known shape (or is custom/absent)', () => {
      // Curated data — a typo'd shape id is a data bug, not a provenance
      // hint: FAIL here even though the audit keeps this WARN-level.
      for (const v of REPLAY_VARIANTS) {
        if (v.structure === undefined || v.structure === 'custom') continue;
        expect(getTemplateShape(v.structure)?.id).toBe(v.structure);
      }
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
});
