import {
  cleanArgsForExecution,
  extractNextCursor,
  formatResultValue,
  isEmptyValue,
  isPlainObject,
  isSymbolField,
  normalizeSymbolValue,
  type ToolArgProperty,
} from './observation-dashboard.model';

describe('Observation dashboard model helpers', () => {
  describe('isEmptyValue', () => {
    it('returns true for empty string, null, undefined, and empty array', () => {
      expect(isEmptyValue('')).toBe(true);
      expect(isEmptyValue(null)).toBe(true);
      expect(isEmptyValue(undefined)).toBe(true);
      expect(isEmptyValue([])).toBe(true);
    });

    it('returns false for non-empty values', () => {
      expect(isEmptyValue('AAPL')).toBe(false);
      expect(isEmptyValue(0)).toBe(false);
      expect(isEmptyValue(false)).toBe(false);
      expect(isEmptyValue(['AAPL'])).toBe(false);
    });
  });

  describe('isPlainObject', () => {
    it('returns true for plain objects', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    it('returns false for non-objects and arrays', () => {
      expect(isPlainObject(null)).toBe(false);
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject('string')).toBe(false);
      expect(isPlainObject(42)).toBe(false);
    });
  });

  describe('extractNextCursor', () => {
    it('extracts cursor from a pagination URL', () => {
      const result = {
        next: 'http://example.com/?cursor=bz0xMCZwPTE0LjAwMDA%3D&state=active',
      };
      expect(extractNextCursor(result)).toBe('bz0xMCZwPTE0LjAwMDA=');
    });

    it('extracts cursor from a nested data.next URL', () => {
      const result = {
        data: {
          next: 'http://example.com/?cursor=page2',
        },
      };
      expect(extractNextCursor(result)).toBe('page2');
    });

    it('returns a plain cursor token', () => {
      expect(extractNextCursor({ cursor: 'page2' })).toBe('page2');
      expect(extractNextCursor({ next_cursor: 'page2' })).toBe('page2');
      expect(extractNextCursor({ next: 'page2' })).toBe('page2');
    });

    it('returns undefined when a URL has no cursor parameter', () => {
      const result = {
        next: 'http://example.com/?state=active',
      };
      expect(extractNextCursor(result)).toBeUndefined();
    });

    it('returns undefined for non-objects', () => {
      expect(extractNextCursor(null)).toBeUndefined();
      expect(extractNextCursor('page2')).toBeUndefined();
      expect(extractNextCursor([])).toBeUndefined();
    });
  });

  describe('isSymbolField', () => {
    it('returns true for known symbol field names', () => {
      expect(isSymbolField('symbol')).toBe(true);
      expect(isSymbolField('symbols')).toBe(true);
      expect(isSymbolField('chain_symbol')).toBe(true);
      expect(isSymbolField('underlying_symbol')).toBe(true);
    });

    it('returns false for non-symbol fields', () => {
      expect(isSymbolField('cursor')).toBe(false);
      expect(isSymbolField('account_number')).toBe(false);
      expect(isSymbolField('strike_price')).toBe(false);
    });
  });

  describe('normalizeSymbolValue', () => {
    it('uppercases string values', () => {
      expect(normalizeSymbolValue('aapl')).toBe('AAPL');
    });

    it('uppercases each string in an array', () => {
      expect(normalizeSymbolValue(['aapl', 'nvda', 123])).toEqual(['AAPL', 'NVDA', 123]);
    });

    it('leaves non-string values unchanged', () => {
      expect(normalizeSymbolValue(123)).toBe(123);
      expect(normalizeSymbolValue(null)).toBe(null);
    });
  });

  describe('cleanArgsForExecution', () => {
    it('uppercases chain_symbol and symbols but leaves other fields unchanged', () => {
      const props: ToolArgProperty[] = [
        { name: 'chain_symbol', type: 'string', required: false, isAccountNumber: false, useRhsAccountNumber: false },
        { name: 'symbols', type: 'string[]', required: false, isAccountNumber: false, useRhsAccountNumber: false },
        { name: 'strike_price', type: 'string', required: false, isAccountNumber: false, useRhsAccountNumber: false },
      ];
      const values = {
        chain_symbol: 'aapl',
        symbols: ['aapl', 'nvda'],
        strike_price: '150.0000',
      };
      const cleaned = cleanArgsForExecution(props, values);
      expect(cleaned['chain_symbol']).toBe('AAPL');
      expect(cleaned['symbols']).toEqual(['AAPL', 'NVDA']);
      expect(cleaned['strike_price']).toBe('150.0000');
    });
  });

  describe('formatResultValue', () => {
    it('adds display_ticker and occ_symbol to option instruments', () => {
      const result = {
        data: {
          results: [
            {
              chain_symbol: 'nvda',
              expiration_date: '2026-07-24',
              type: 'call',
              strike_price: '150.0000',
            },
          ],
        },
      };
      const formatted = formatResultValue(result) as Record<string, unknown>;
      const first = ((formatted['data'] as Record<string, unknown>)['results'] as Record<string, unknown>[])[0];
      expect(first['display_ticker']).toBe('NVDA 2026-07-24 Call $150.00');
      expect(first['occ_symbol']).toBe('NVDA260724C00150000');
    });

    it('leaves non-option objects unchanged', () => {
      const result = { symbol: 'AAPL', price: 150 };
      expect(formatResultValue(result)).toEqual(result);
    });

    it('does not duplicate display fields if already present', () => {
      const result = {
        chain_symbol: 'aapl',
        expiration_date: '2026-07-24',
        type: 'put',
        strike_price: '150.0000',
        display_ticker: 'existing',
      };
      const formatted = formatResultValue(result) as typeof result;
      expect(formatted.display_ticker).toBe('existing');
    });
  });
});
