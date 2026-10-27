/**
 * @topic #1238 — Options Backtest, Thread #1240 (Selection Replay)
 * @task #1276 — SHARED: Template registry + collections/rules/indexes
 *
 * Registry tests: seeded entries resolve, unknown ids miss, every template
 * carries a well-formed PickDocCoordinate (delta sign matches option type,
 * positive DTE), and ids are unique.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import { getReplayTemplate, REPLAY_TEMPLATES } from './options-replay-templates';

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
});
