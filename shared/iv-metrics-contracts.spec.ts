/**
 * Unit tests for the IV metrics shared contracts — request/response/row
 * types for SA's partnerIvMetricsV2 and partnerIvRankV2 endpoints.
 *
 * Pure-type module: assertions pin the compile-time shape (typed fixtures,
 * @ts-expect-error negatives) with runtime checks on fixture values. The
 * import goes through the `@iv-metrics/contracts` alias so this spec also
 * proves the jest moduleNameMapper registration.
 */

import {
  GetIvMetricsRequest,
  GetIvRankRequest,
  IV_RANK_WINDOWS,
  IvMetricField,
  IvMetricsRequest,
  IvMetricsResponse,
  IvMetricsRow,
  IvRankDirection,
  IvRankRequest,
  IvRankResponse,
  IvRankRow,
  IvRankSortField,
  IvRankWindow,
} from '@iv-metrics/contracts';

describe('iv-metrics-contracts', () => {
  describe('IvRankWindow / field-name unions', () => {
    it('pins IV_RANK_WINDOWS to all four documented windows', () => {
      const windows: readonly IvRankWindow[] = IV_RANK_WINDOWS;
      expect(windows).toEqual([30, 60, 180, 360]);
    });

    it('accepts all twelve sort-field names derived from the windows', () => {
      const fields: IvRankSortField[] = [
        'ivRank30', 'ivRank60', 'ivRank180', 'ivRank360',
        'ivPct30', 'ivPct60', 'ivPct180', 'ivPct360',
        'ivN30', 'ivN60', 'ivN180', 'ivN360',
      ];
      expect(fields).toHaveLength(12);
    });

    it('rejects a sort-field name outside the documented windows', () => {
      // @ts-expect-error — window 7 is not a documented rank window
      const bad: IvRankSortField = 'ivRank7';
      void bad;
    });
  });

  describe('IvMetricField', () => {
    it('accepts every documented requestable field', () => {
      const fields: IvMetricField[] = [
        'iv30', 'iv30Method', 'iv30Contracts',
        'ivRank30', 'ivRank60', 'ivRank180', 'ivRank360',
        'ivPct30', 'ivPct60', 'ivPct180', 'ivPct360',
        'ivN30', 'ivN60', 'ivN180', 'ivN360',
      ];
      expect(fields).toHaveLength(15);
    });

    it('rejects date as a requestable metric (always present, not a whitelist member)', () => {
      // @ts-expect-error — 'date' is always emitted, never a metrics whitelist member
      const bad: IvMetricField = 'date';
      void bad;
    });
  });

  describe('IvMetricsRequest', () => {
    it('accepts a full request with metrics whitelist', () => {
      const req: IvMetricsRequest = {
        symbol: 'SPY',
        from: '2025-01-01',
        to: '2025-12-31',
        metrics: ['iv30', 'ivRank360', 'ivN360'],
      };
      expect(req.metrics).toContain('ivRank360');
    });

    it('accepts a request without metrics (omitted → all fields)', () => {
      const req: IvMetricsRequest = { symbol: 'QQQ', from: '2026-01-01', to: '2026-01-31' };
      expect(req.metrics).toBeUndefined();
    });
  });

  describe('IvMetricsRow', () => {
    it('accepts a row mirroring the discovery-doc example', () => {
      const row: IvMetricsRow = {
        date: '2026-10-30',
        iv30: 0.2456,
        ivRank360: 82.7,
        ivN360: 147,
      };
      expect(row.iv30).toBeCloseTo(0.2456);
      expect(row.ivRank360).toBeCloseTo(82.7);
    });

    it('treats every metric field as optional (absent key = no data)', () => {
      const row: IvMetricsRow = { date: '2026-10-31' };
      expect(row.iv30).toBeUndefined();
      expect(row.ivN360).toBeUndefined();
    });

    it('restricts iv30Method to the documented literals', () => {
      const interpolated: IvMetricsRow = { date: '2026-10-30', iv30Method: 'interpolated' };
      const nearest: IvMetricsRow = { date: '2026-10-30', iv30Method: 'nearest' };
      // @ts-expect-error — 'exact' is not a documented iv30Method
      const bad: IvMetricsRow = { date: '2026-10-30', iv30Method: 'exact' };
      expect(interpolated.iv30Method).toBe('interpolated');
      expect(nearest.iv30Method).toBe('nearest');
      void bad;
    });

    it('requires date on every row', () => {
      // @ts-expect-error — date is always present on a metrics row
      const bad: IvMetricsRow = { iv30: 0.2 };
      void bad;
    });
  });

  describe('IvMetricsResponse', () => {
    it('accepts a response with an optional metrics echo', () => {
      const res: IvMetricsResponse = {
        ok: true,
        symbol: 'SPY',
        from: '2026-01-01',
        to: '2026-10-30',
        metrics: ['iv30', 'ivRank360'],
        rows: [{ date: '2026-10-30', iv30: 0.2456, ivRank360: 82.7 }],
        timestamp: '2026-11-25T00:00:00Z',
        processingTimeMs: 42,
      };
      expect(res.rows).toHaveLength(1);
      expect(res.metrics).toContain('iv30');
    });

    it('allows metrics echo to be absent when not requested', () => {
      const res: IvMetricsResponse = {
        ok: true,
        symbol: 'SPY',
        from: '2026-01-01',
        to: '2026-10-30',
        rows: [],
        timestamp: '2026-11-25T00:00:00Z',
        processingTimeMs: 12,
      };
      expect(res.metrics).toBeUndefined();
    });
  });

  describe('IvRankRequest', () => {
    it('accepts a fully-empty request (whole-table default)', () => {
      const req: IvRankRequest = {};
      expect(req.sort).toBeUndefined();
      expect(req.dir).toBeUndefined();
      expect(req.minN).toBeUndefined();
    });

    it('accepts sort + dir + minN together', () => {
      const req: IvRankRequest = { sort: 'ivRank360', dir: 'desc', minN: 30 };
      expect(req.sort).toBe('ivRank360');
      expect(req.minN).toBe(30);
    });

    it('restricts dir to the documented literals', () => {
      const asc: IvRankDirection = 'asc';
      const desc: IvRankDirection = 'desc';
      // @ts-expect-error — 'up' is not a documented direction
      const bad: IvRankDirection = 'up';
      expect([asc, desc]).toEqual(['asc', 'desc']);
      void bad;
    });
  });

  describe('IvRankRow', () => {
    it('accepts a fully-populated rank row', () => {
      const row: IvRankRow = {
        symbol: 'QQQ',
        asOfDate: '2026-10-30',
        ivRank30: 82.7,
        ivRank60: 82.7,
        ivRank180: 82.7,
        ivRank360: 82.7,
        ivN30: 30,
        ivN60: 60,
        ivN180: 180,
        ivN360: 147,
        updatedAt: '2026-10-30T21:05:00Z',
      };
      expect(row.symbol).toBe('QQQ');
      expect(row.ivN360).toBe(147);
    });

    it('accepts updatedAt: null', () => {
      const row: IvRankRow = {
        symbol: 'AAPL',
        asOfDate: '2026-10-30',
        ivN30: 0,
        ivN60: 0,
        ivN180: 0,
        ivN360: 0,
        updatedAt: null,
      };
      expect(row.updatedAt).toBeNull();
    });

    it('requires all four ivN{W} fields (always emitted)', () => {
      // @ts-expect-error — ivN360 is required on a rank row
      const bad: IvRankRow = {
        symbol: 'AAPL',
        asOfDate: '2026-10-30',
        ivN30: 1,
        ivN60: 1,
        ivN180: 1,
        updatedAt: null,
      };
      void bad;
    });
  });

  describe('IvRankResponse', () => {
    it('accepts a whole-table response', () => {
      const res: IvRankResponse = {
        ok: true,
        count: 130,
        rows: [],
        timestamp: '2026-11-25T00:00:00Z',
        processingTimeMs: 88,
      };
      expect(res.count).toBe(130);
      expect(res.sort).toBeUndefined();
    });
  });

  describe('callable request aliases', () => {
    it('GetIvMetricsRequest mirrors IvMetricsRequest', () => {
      const req: GetIvMetricsRequest = { symbol: 'SPY', from: '2026-01-01', to: '2026-10-30' };
      expect(req.symbol).toBe('SPY');
    });

    it('GetIvRankRequest mirrors IvRankRequest', () => {
      const req: GetIvRankRequest = { minN: 10 };
      expect(req.minN).toBe(10);
    });
  });
});
