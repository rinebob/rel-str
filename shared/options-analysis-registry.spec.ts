/**
 * @topic #1238 — Options Backtest, Thread #1266 (Backtest Analytics)
 * @task #1367 — SHARED: Exit registry + analysis contracts
 *
 * Registry tests: seeded entries resolve, unknown ids miss, ids are unique,
 * and each kind's curated literals are well-formed (literal-data guards —
 * a curated entry could carry a bad pct/price/dte literal without a type
 * error, per the options-replay-templates precedent).
 */

import {
  EXIT_STRATEGIES,
  EXIT_REGISTRY_VERSION,
  getExitStrategy,
} from './options-analysis-registry';
import type { ExitStrategyDef } from './options-analysis-registry';

const byKind = <K extends ExitStrategyDef['kind']>(
  kind: K,
): Extract<ExitStrategyDef, { kind: K }>[] =>
  EXIT_STRATEGIES.filter(
    (x): x is Extract<ExitStrategyDef, { kind: K }> => x.kind === kind,
  );

describe('options-analysis-registry', () => {
  describe('EXIT_STRATEGIES', () => {
    it('is non-empty and seeded with the provisional set', () => {
      expect(EXIT_STRATEGIES.length).toBeGreaterThanOrEqual(6);
      expect(EXIT_STRATEGIES.map((e) => e.exitId)).toEqual(
        expect.arrayContaining([
          'target-90',
          'price-100',
          'price-50',
          'stop-200',
          'dte-21',
          'expiry',
        ]),
      );
    });

    it('has no duplicate ids', () => {
      const ids = EXIT_STRATEGIES.map((e) => e.exitId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('exitIds are doc-key safe (no separators that break path composition)', () => {
      // exitId composes {contractListDocId}_{exitId} doc ids — '/' would
      // produce a nested path; '_' would make suffix parsing ambiguous.
      for (const e of EXIT_STRATEGIES) {
        expect(e.exitId).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      }
    });

    it('every entry has a label and unique order', () => {
      const orders = EXIT_STRATEGIES.map((e) => e.order);
      expect(new Set(orders).size).toBe(orders.length);
      for (const e of EXIT_STRATEGIES) {
        expect(e.exitId.length).toBeGreaterThan(0);
        expect(e.label.length).toBeGreaterThan(0);
      }
    });

    it('every kind is exercised by ≥1 seed', () => {
      const kinds = new Set(EXIT_STRATEGIES.map((e) => e.kind));
      expect(kinds).toEqual(
        new Set([
          'target-pct-premium',
          'absolute-price',
          'stop-pct-premium',
          'dte-time',
          'hold-to-expiry',
        ]),
      );
    });

    it('target-pct-premium entries carry pct in (0,100]', () => {
      for (const e of byKind('target-pct-premium')) {
        expect(e.params.pct).toBeGreaterThan(0);
        expect(e.params.pct).toBeLessThanOrEqual(100);
      }
    });

    it('absolute-price entries carry a positive price', () => {
      for (const e of byKind('absolute-price')) {
        expect(e.params.price).toBeGreaterThan(0);
      }
    });

    it('stop-pct-premium entries carry pct > 100', () => {
      for (const e of byKind('stop-pct-premium')) {
        expect(e.params.pct).toBeGreaterThan(100);
      }
    });

    it('dte-time entries carry a positive integer dte', () => {
      for (const e of byKind('dte-time')) {
        expect(Number.isInteger(e.params.dte)).toBe(true);
        expect(e.params.dte).toBeGreaterThan(0);
      }
    });
  });

  describe('EXIT_REGISTRY_VERSION', () => {
    it('is a positive integer', () => {
      expect(Number.isInteger(EXIT_REGISTRY_VERSION)).toBe(true);
      expect(EXIT_REGISTRY_VERSION).toBeGreaterThan(0);
    });
  });

  describe('getExitStrategy', () => {
    it('resolves every seeded id', () => {
      for (const e of EXIT_STRATEGIES) {
        expect(getExitStrategy(e.exitId)).toBe(e);
      }
    });

    it('returns undefined on miss', () => {
      expect(getExitStrategy('nope')).toBeUndefined();
    });
  });
});
