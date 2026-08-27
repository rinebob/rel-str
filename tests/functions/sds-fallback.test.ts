/**
 * Tests for Task #168 — Fallback timer and open pass timer.
 *
 * Tests the pure functions:
 * - computeOpenPassSlot: 5-minute slot truncation
 * - shouldFallbackRun: race condition check logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeOpenPassSlot } from '../../functions/src/common/pt-date-utils';
import { shouldFallbackRun } from '../../functions/src/symbol-data-sync/sds-fallback-logic';
import { normalizeTrackedSymbols } from '../../functions/src/symbol-data-sync/sds-fallback';

describe('computeOpenPassSlot', () => {
  it('truncates to 5-minute boundary', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T09:32:00-07:00')), '09:30');
  });

  it('returns exact boundary unchanged', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T09:35:00-07:00')), '09:35');
  });

  it('truncates 09:59 to 09:55', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T09:59:00-07:00')), '09:55');
  });

  it('truncates 13:00 to 13:00 (boundary)', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T13:00:00-07:00')), '13:00');
  });

  it('truncates 06:30 to 06:30 (market open boundary)', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T06:30:00-07:00')), '06:30');
  });

  it('truncates 06:31 to 06:30', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T06:31:00-07:00')), '06:30');
  });

  it('truncates 12:59 to 12:55', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T12:59:00-07:00')), '12:55');
  });

  it('pads single-digit hours and minutes', () => {
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T06:32:00-07:00')), '06:30');
    assert.equal(computeOpenPassSlot(new Date('2026-08-22T09:03:00-07:00')), '09:00');
  });
});

describe('shouldFallbackRun', () => {
  const today = '2026-08-22';

  it('returns true when no POST A sequence exists for today', () => {
    assert.equal(shouldFallbackRun([], today), true);
  });

  it('returns false when a processing POST A sequence exists', () => {
    const sequences = [
      { marketDate: today, sequence: 'A', status: 'processing' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), false);
  });

  it('returns false when a completed POST A sequence exists', () => {
    const sequences = [
      { marketDate: today, sequence: 'A', status: 'completed' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), false);
  });

  it('returns false when a forced_complete POST A sequence exists', () => {
    const sequences = [
      { marketDate: today, sequence: 'A', status: 'forced_complete' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), false);
  });

  it('returns true when only POST B sequences exist', () => {
    const sequences = [
      { marketDate: today, sequence: 'B', status: 'processing' },
      { marketDate: today, sequence: 'C', status: 'completed' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), true);
  });

  it('returns true when POST A sequence is from a different marketDate', () => {
    const sequences = [
      { marketDate: '2026-08-21', sequence: 'A', status: 'completed' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), true);
  });

  it('returns false when POST A sequence has completed_but_not_dispatched status', () => {
    // Data was synced but dispatch failed — fallback should NOT re-run
    const sequences = [
      { marketDate: today, sequence: 'A', status: 'completed_but_not_dispatched' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), false);
  });

  it('returns true when POST A sequence has failed status', () => {
    // A failed sequence means data was NOT synced — fallback should re-run
    const sequences = [
      { marketDate: today, sequence: 'A', status: 'failed' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), true);
  });

  it('returns true with mixed statuses when no POST A has active status', () => {
    const sequences = [
      { marketDate: today, sequence: 'A', status: 'failed' },
      { marketDate: today, sequence: 'B', status: 'processing' },
    ];
    assert.equal(shouldFallbackRun(sequences, today), true);
  });
});

describe('normalizeTrackedSymbols', () => {
  it('passes through plain string symbols unchanged', () => {
    assert.deepEqual(normalizeTrackedSymbols(['AAPL', 'MSFT', 'GOOGL']), ['AAPL', 'MSFT', 'GOOGL']);
  });

  it('extracts .symbol from object responses', () => {
    const raw = [{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'GOOGL' }];
    assert.deepEqual(normalizeTrackedSymbols(raw as any), ['AAPL', 'MSFT', 'GOOGL']);
  });

  it('handles mixed string and object responses', () => {
    const raw = ['AAPL', { symbol: 'MSFT' }, 'GOOGL'];
    assert.deepEqual(normalizeTrackedSymbols(raw as any), ['AAPL', 'MSFT', 'GOOGL']);
  });

  it('returns empty array for undefined input', () => {
    assert.deepEqual(normalizeTrackedSymbols(undefined), []);
  });

  it('filters out falsy values', () => {
    const raw = ['AAPL', '', { symbol: '' }, { symbol: 'MSFT' }, null as any];
    assert.deepEqual(normalizeTrackedSymbols(raw as any), ['AAPL', 'MSFT']);
  });
});
