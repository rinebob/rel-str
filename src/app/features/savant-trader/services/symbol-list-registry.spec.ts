/** @topic #1098 — RH Scanner | @task #1306
 *  Canonical-symbol boundary for the list registry — the read side must
 *  hand consumers one spelling (trim + uppercase, deduped) or read/write
 *  paths disagree on variant spellings stored by backend writers
 *  (#1306 review, MAJOR). */
import { toDef, fallbackDefs } from './symbol-list-registry';
import {
  normalizeListSymbols,
  SYSTEM_LIST_KEYS,
} from '../common/symbol-list-defs';

describe('symbol-list-registry — canonical symbols', () => {
  describe('normalizeListSymbols', () => {
    it('trims, uppercases, dedupes, and drops non-strings/empties', () => {
      expect(
        normalizeListSymbols([
          ' aapl ',
          'AAPL',
          'msft',
          '',
          '   ',
          42 as unknown as string,
          null as unknown as string,
        ]),
      ).toEqual(['AAPL', 'MSFT']);
    });

    it('returns [] for non-array input', () => {
      expect(normalizeListSymbols(undefined)).toEqual([]);
      expect(normalizeListSymbols('AAPL')).toEqual([]);
      expect(normalizeListSymbols(null)).toEqual([]);
    });
  });

  describe('toDef', () => {
    it('normalizes stored symbols to the canonical spelling', () => {
      const def = toDef({
        key: 'PRIMARY',
        label: 'Primary',
        order: 1,
        role: 'exclusive',
        symbols: [' aapl ', 'AAPL', 'msft'],
      });
      expect(def.symbols).toEqual(['AAPL', 'MSFT']);
    });

    it('a missing or non-array symbols field yields []', () => {
      expect(toDef({ key: 'X' }).symbols).toEqual([]);
      expect(toDef({ key: 'X', symbols: 'nope' }).symbols).toEqual([]);
    });
  });

  describe('fallbackDefs', () => {
    const u = 'user1';

    it('normalizes registry-doc symbols', () => {
      const defs = fallbackDefs(u, [
        {
          id: `${u}_PRIMARY`,
          data: {
            key: 'PRIMARY',
            label: 'Primary',
            order: 1,
            role: 'exclusive',
            symbols: ['aapl ', ' AAPL'],
          },
        },
      ]);
      expect(defs.find((d) => d.key === 'PRIMARY')?.symbols).toEqual(['AAPL']);
    });

    it('normalizes legacy-doc symbols merged into a system list', () => {
      const defs = fallbackDefs(u, [
        {
          id: 'PRIMARY', // bare-name legacy doc — no key field
          data: { name: 'PRIMARY', symbols: ['aapl', ' msft '] },
        },
      ]);
      expect(defs.find((d) => d.key === 'PRIMARY')?.symbols).toEqual([
        'AAPL',
        'MSFT',
      ]);
    });

    it('same-key docs merge canonically — no duplicate spellings survive', () => {
      const defs = fallbackDefs(u, [
        {
          id: `${u}_PRIMARY`,
          data: { key: 'PRIMARY', role: 'exclusive', symbols: ['aapl '] },
        },
        {
          id: `${u}_PRIMARY_dup`,
          data: { key: 'PRIMARY', role: 'exclusive', symbols: ['AAPL', 'msft'] },
        },
      ]);
      const primary = defs.find((d) => d.key === 'PRIMARY');
      expect(primary?.symbols).toEqual(['AAPL', 'MSFT']);
    });

    it('materializes missing system lists', () => {
      const defs = fallbackDefs(u, []);
      for (const key of Object.values(SYSTEM_LIST_KEYS)) {
        expect(defs.some((d) => d.key === key)).toBe(true);
      }
    });
  });
});
