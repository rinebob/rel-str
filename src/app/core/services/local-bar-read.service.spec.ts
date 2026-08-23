/**
 * @topic #159 — Data Pipeline PDR Migration
 * @task #170 — Local bar-read service
 *
 * Unit tests for LocalBarReadService.
 * Firestore is mocked via Jest module mocks.
 */
import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector } from '@angular/core';

// Mock Firebase modules before any imports that trigger Firebase init
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));
jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { LocalBarReadService, type OhlcBar } from './local-bar-read.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

// ── Mock factories ───────────────────────────────────────────────────────────

function mockBar(date: string, overrides: Partial<OhlcBar> = {}): OhlcBar {
  return { d: date, o: 100, h: 110, l: 90, c: 105, v: 1000, ...overrides };
}

function mockDocSnap(data: OhlcBar[] | null) {
  return {
    exists: () => data !== null,
    data: () => ({ bars: data ?? [] }),
  };
}

function mockEmptyDocSnap() {
  return { exists: () => false, data: () => ({}) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LocalBarReadService', () => {
  let service: LocalBarReadService;
  let mockGetDoc: jest.Mock;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        LocalBarReadService,
        { provide: Firestore, useValue: {} },
      ],
    });
    service = TestBed.inject(LocalBarReadService);

    mockGetDoc = getDoc as unknown as jest.Mock;
    mockGetDoc.mockReset();
    (doc as unknown as jest.Mock).mockReturnValue({ path: 'mocked' });
  });

  // ── getDailyBars$ ──────────────────────────────────────────────────────────

  describe('getDailyBars$', () => {
    it('returns bars sorted ascending by date', (done) => {
      const bars = [
        mockBar('2026-06-15'),
        mockBar('2026-01-05'),
        mockBar('2026-03-20'),
      ];
      mockGetDoc.mockResolvedValue(mockDocSnap(bars));

      service.getDailyBars$('SPY', 2026).subscribe(result => {
        expect(result).toHaveLength(3);
        expect(result[0].d).toBe('2026-01-05');
        expect(result[1].d).toBe('2026-03-20');
        expect(result[2].d).toBe('2026-06-15');
        done();
      });
    });

    it('returns empty array when year shard does not exist', (done) => {
      mockGetDoc.mockResolvedValue(mockEmptyDocSnap());

      service.getDailyBars$('SPY', 2026).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array for empty symbol', (done) => {
      service.getDailyBars$('', 2026).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array for invalid year', (done) => {
      service.getDailyBars$('SPY', NaN).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('normalizes symbol to uppercase', (done) => {
      mockGetDoc.mockResolvedValue(mockDocSnap([mockBar('2026-01-01')]));

      service.getDailyBars$('spy', 2026).subscribe(result => {
        expect(result).toHaveLength(1);
        expect(mockGetDoc).toHaveBeenCalled();
        done();
      });
    });

    it('constructs correct Firestore path for daily bars', (done) => {
      mockGetDoc.mockResolvedValue(mockDocSnap([mockBar('2026-01-01')]));

      service.getDailyBars$('SPY', 2026).subscribe(() => {
        expect(doc).toHaveBeenCalledWith(expect.anything(), 'symbol-data', 'SPY', 'daily', '2026');
        done();
      });
    });
  });

  // ── getWeeklyBars$ ─────────────────────────────────────────────────────────

  describe('getWeeklyBars$', () => {
    it('returns weekly bars sorted ascending by date', (done) => {
      const bars = [
        mockBar('2026-06-09'),
        mockBar('2026-01-06'),
        mockBar('2026-03-30'),
      ];
      mockGetDoc.mockResolvedValue(mockDocSnap(bars));

      service.getWeeklyBars$('AAPL').subscribe(result => {
        expect(result).toHaveLength(3);
        expect(result[0].d).toBe('2026-01-06');
        expect(result[2].d).toBe('2026-06-09');
        done();
      });
    });

    it('returns empty array when weekly doc does not exist', (done) => {
      mockGetDoc.mockResolvedValue(mockEmptyDocSnap());

      service.getWeeklyBars$('AAPL').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array for empty symbol', (done) => {
      service.getWeeklyBars$('').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });
  });

  // ── getMonthlyBars$ ────────────────────────────────────────────────────────

  describe('getMonthlyBars$', () => {
    it('returns monthly bars sorted ascending by date', (done) => {
      const bars = [
        mockBar('2026-06-01'),
        mockBar('2026-01-01'),
        mockBar('2026-03-01'),
      ];
      mockGetDoc.mockResolvedValue(mockDocSnap(bars));

      service.getMonthlyBars$('QQQ').subscribe(result => {
        expect(result).toHaveLength(3);
        expect(result[0].d).toBe('2026-01-01');
        expect(result[2].d).toBe('2026-06-01');
        done();
      });
    });

    it('returns empty array when monthly doc does not exist', (done) => {
      mockGetDoc.mockResolvedValue(mockEmptyDocSnap());

      service.getMonthlyBars$('QQQ').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });
  });

  // ── getRecentDailyBars$ ────────────────────────────────────────────────────

  describe('getRecentDailyBars$', () => {
    it('filters to last N days from a single year shard', (done) => {
      const now = new Date();
      const fmtYMD = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const todayStr = fmtYMD(now);
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
      const tenDaysAgoStr = fmtYMD(tenDaysAgo);
      const fortyDaysAgo = new Date(now);
      fortyDaysAgo.setUTCDate(fortyDaysAgo.getUTCDate() - 40);
      const fortyDaysAgoStr = fmtYMD(fortyDaysAgo);

      const bars = [
        mockBar(fortyDaysAgoStr),
        mockBar(tenDaysAgoStr),
        mockBar(todayStr),
      ];
      mockGetDoc.mockResolvedValue(mockDocSnap(bars));

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        expect(result).toHaveLength(2);
        expect(result[0].d).toBe(tenDaysAgoStr);
        expect(result[1].d).toBe(todayStr);
        done();
      });
    });

    it('handles year boundary by reading both year shards', (done) => {
      // Simulate Jan 5, 2027 12:00 UTC (= Jan 5, 2027 04:00 PT) — 30-day window spans Dec 2026 + Jan 2027
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2027, 0, 5, 12)));

      const decBars = [mockBar('2026-12-06'), mockBar('2026-12-20'), mockBar('2026-12-25')];
      const janBars = [mockBar('2027-01-02'), mockBar('2027-01-05')];

      mockGetDoc
        .mockResolvedValueOnce(mockDocSnap(janBars))   // current year (2027)
        .mockResolvedValueOnce(mockDocSnap(decBars));   // previous year (2026)

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        // Cutoff is Dec 6, 2026 PT — all 5 bars should be included (Dec 6 is on the cutoff)
        expect(result).toHaveLength(5);
        expect(result[0].d).toBe('2026-12-06');
        expect(result[4].d).toBe('2027-01-05');

        jest.useRealTimers();
        done();
      });
    });

    it('excludes bars before the cutoff date', (done) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2027, 0, 5, 12)));

      const decBars = [mockBar('2026-12-05'), mockBar('2026-12-06'), mockBar('2026-12-20')];
      const janBars = [mockBar('2027-01-05')];

      mockGetDoc
        .mockResolvedValueOnce(mockDocSnap(janBars))
        .mockResolvedValueOnce(mockDocSnap(decBars));

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        // Cutoff is Dec 6, 2026 PT — Dec 5 excluded, Dec 6 included
        expect(result).toHaveLength(3);
        expect(result[0].d).toBe('2026-12-06');
        expect(result[2].d).toBe('2027-01-05');

        jest.useRealTimers();
        done();
      });
    });

    it('survives partial year shard failure via Promise.allSettled', (done) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2027, 0, 5, 12)));

      const decBars = [mockBar('2026-12-20'), mockBar('2026-12-25')];

      mockGetDoc
        .mockRejectedValueOnce(new Error('2027 shard read failed'))
        .mockResolvedValueOnce(mockDocSnap(decBars));

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        // 2027 shard failed, but 2026 shard data is still returned
        expect(result).toHaveLength(2);
        expect(result[0].d).toBe('2026-12-20');

        jest.useRealTimers();
        done();
      });
    });

    it('returns empty array when no year shards exist', (done) => {
      mockGetDoc.mockResolvedValue(mockEmptyDocSnap());

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('uses PT year at midnight UTC (not UTC year)', (done) => {
      // Jan 1, 2027 00:00 UTC = Dec 31, 2026 16:00 PT (PST, UTC-8)
      // PT year is 2026, so should read from 2026 shard, not 2027
      jest.useFakeTimers();
      jest.setSystemTime(new Date(Date.UTC(2027, 0, 1, 0)));

      const decBars = [mockBar('2026-12-15'), mockBar('2026-12-31')];

      mockGetDoc.mockResolvedValue(mockDocSnap(decBars));

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        // PT date is Dec 31, 2026 — only one year shard (2026) should be read
        // Cutoff is Dec 1, 2026 PT — both bars included
        expect(result).toHaveLength(2);
        expect(result[0].d).toBe('2026-12-15');
        // Verify only one getDoc call (single year shard)
        expect(mockGetDoc).toHaveBeenCalledTimes(1);

        jest.useRealTimers();
        done();
      });
    });

    it('returns empty array for invalid days parameter', (done) => {
      service.getRecentDailyBars$('SPY', 0).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array for negative days', (done) => {
      service.getRecentDailyBars$('SPY', -5).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array for empty symbol', (done) => {
      service.getRecentDailyBars$('', 30).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('getDailyBars$ returns empty array on Firestore error', (done) => {
      mockGetDoc.mockRejectedValue(new Error('Firestore error'));

      service.getDailyBars$('SPY', 2026).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('getWeeklyBars$ returns empty array on Firestore error', (done) => {
      mockGetDoc.mockRejectedValue(new Error('Firestore error'));

      service.getWeeklyBars$('SPY').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('getRecentDailyBars$ returns empty array on Firestore error', (done) => {
      mockGetDoc.mockRejectedValue(new Error('Firestore error'));

      service.getRecentDailyBars$('SPY', 30).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });
  });

  // ── Malformed data handling ────────────────────────────────────────────────

  describe('malformed data handling', () => {
    it('returns empty array when bars field is not an array', (done) => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ bars: 'not an array' }),
      });

      service.getDailyBars$('SPY', 2026).subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array when bars field is null', (done) => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => ({ bars: null }),
      });

      service.getWeeklyBars$('SPY').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('returns empty array when doc data is not an object', (done) => {
      mockGetDoc.mockResolvedValue({
        exists: () => true,
        data: () => 'invalid',
      });

      service.getMonthlyBars$('SPY').subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });
  });
});
