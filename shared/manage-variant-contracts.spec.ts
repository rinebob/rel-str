/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1538 — SHARED: Manage instance + variant contracts (run-state, stop-type)
 *
 * Fixture-shape tests for the manage-domain template/variant contracts.
 * Vocabulary per CONTEXT.md: a Manage Template is the spread *shape* (leg
 * roles + delta/DTE bands, no concrete coordinates); a Manage Variant is
 * the concrete instantiation — every option leg pinned to Δ/DTE.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import type { OptionLeg, VariantLeg } from './options-replay-contracts';
import {
  ManageTemplate,
  ManageTemplateLeg,
  ManageVariant,
} from './manage-variant-contracts';

describe('manage-variant-contracts', () => {
  describe('ManageTemplateLeg', () => {
    it('option leg carries role + type + side + delta/DTE bands — no concrete coordinate', () => {
      const leg: ManageTemplateLeg = {
        kind: 'option',
        role: 'long',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        deltaMin: 0.35,
        deltaMax: 0.55,
        dteMin: 25,
        dteMax: 35,
      };
      expect(leg.kind).toBe('option');
      // @ts-expect-error — a template leg is a shape: no pinned delta
      expect(leg.targetDelta).toBeUndefined();
      // @ts-expect-error — a template leg is a shape: no pinned dte
      expect(leg.dte).toBeUndefined();
    });

    it('stock leg carries role + side only — no bands', () => {
      const leg: ManageTemplateLeg = {
        kind: 'stock',
        role: 'shares',
        side: TradeSide.LONG,
      };
      expect(leg.kind).toBe('stock');
      // @ts-expect-error — stock legs have no option band fields
      expect(leg.deltaMin).toBeUndefined();
    });
  });

  describe('ManageTemplate', () => {
    it('carries the ALL-CAPS code used as the instance-ID spread segment', () => {
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
      expect(template.code).toBe('CDS');
      expect(template.legs).toHaveLength(2);
    });
  });

  describe('ManageVariant', () => {
    const legs: VariantLeg[] = [
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.4, dte: 30, side: TradeSide.SHORT },
    ];

    it('pins every option leg to a concrete Δ/DTE — the named "50-40 30" recipe', () => {
      const variant: ManageVariant = {
        id: 'cds-30-50-40',
        name: 'call debit spread 50-40 30',
        templateId: 'cds',
        dte: 30,
        legs,
      };
      expect(variant.templateId).toBe('cds');
      expect(variant.dte).toBe(30);
      const optionLegs = variant.legs.filter((l): l is OptionLeg => l.kind === 'option');
      expect(optionLegs.map((l) => l.targetDelta)).toEqual([0.5, 0.4]);
    });

    it('legs reuse the canonical VariantLeg union — stock legs allowed (e.g., covered-call hybrids)', () => {
      const variant: ManageVariant = {
        id: 'cc-30-30',
        name: 'covered call 30 30',
        templateId: 'cc',
        dte: 30,
        legs: [
          { kind: 'stock', side: TradeSide.LONG },
          { kind: 'option', type: OptionType.CALL, targetDelta: 0.3, dte: 30, side: TradeSide.SHORT },
        ],
      };
      expect(variant.legs[0].kind).toBe('stock');
    });
  });
});
