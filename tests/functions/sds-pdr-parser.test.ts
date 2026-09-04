/**
 * Unit tests for SDS PDR parser — pure functions for parsing PDR messages.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolvePdrContext,
  resolveSequence,
  computeSequenceRunId,
  resolveSymbolSet,
} from '../../functions/src/symbol-data-sync/sds-pdr-parser';

describe('resolvePdrContext', () => {
  it('parses POST A DAILY message', () => {
    const attributes = {
      runId: '2026-01-24-FRI-A-DAILY-LIVE-POST-1335',
      phase: 'post',
      marketDate: '2026-01-24',
      runType: 'ts-post-all-intervals',
      interval: 'daily',
      successes: '756',
      permanentFailures: '0',
    };
    const payload = {
      runId: '2026-01-24-FRI-A-DAILY-LIVE-POST-1335',
      phase: 'post',
      intervals: ['daily'],
      marketDate: '2026-01-24',
      excludeSymbols: ['AAPL', 'MSFT'],
      runStatus: 'completed',
    };

    const ctx = resolvePdrContext(attributes, payload);

    assert.equal(ctx.runType, 'ts-post-all-intervals');
    assert.equal(ctx.phase, 'post');
    assert.equal(ctx.runId, '2026-01-24-FRI-A-DAILY-LIVE-POST-1335');
    assert.equal(ctx.marketDate, '2026-01-24');
    assert.equal(ctx.interval, 'DAILY');
    assert.equal(ctx.sequence, 'A');
    assert.deepEqual(ctx.excludeSymbols, ['AAPL', 'MSFT']);
    assert.equal(ctx.includeSymbols, undefined);
  });

  it('parses POST B WEEKLY message with includeSymbols', () => {
    const attributes = {
      runId: '2026-01-24-FRI-B-WEEKLY-LIVE-POST-1800',
      phase: 'post',
      marketDate: '2026-01-24',
      runType: 'ts-post-all-intervals',
      interval: 'weekly',
      successes: '2',
      permanentFailures: '0',
    };
    const payload = {
      runId: '2026-01-24-FRI-B-WEEKLY-LIVE-POST-1800',
      phase: 'post',
      intervals: ['weekly'],
      marketDate: '2026-01-24',
      includeSymbols: ['AAPL', 'MSFT'],
      runStatus: 'completed',
    };

    const ctx = resolvePdrContext(attributes, payload);

    assert.equal(ctx.interval, 'WEEKLY');
    assert.equal(ctx.sequence, 'B');
    assert.equal(ctx.excludeSymbols, undefined);
    assert.deepEqual(ctx.includeSymbols, ['AAPL', 'MSFT']);
  });

  it('parses intraday PRE message', () => {
    const attributes = {
      runId: '2026-01-24-FRI-LIVE-0800',
      phase: 'pre',
      marketDate: '2026-01-24',
      runType: 'intraday-snapshot',
      clockPt: '0800',
      successes: '758',
      permanentFailures: '0',
    };
    const payload = {
      runId: '2026-01-24-FRI-LIVE-0800',
      phase: 'pre',
      intervals: ['intraday'],
      marketDate: '2026-01-24',
      runStatus: 'completed',
    };

    const ctx = resolvePdrContext(attributes, payload);

    assert.equal(ctx.runType, 'intraday-snapshot');
    assert.equal(ctx.phase, 'pre');
    assert.equal(ctx.interval, 'intraday');
    assert.equal(ctx.sequence, undefined);
    assert.equal(ctx.excludeSymbols, undefined);
    assert.equal(ctx.includeSymbols, undefined);
  });

  it('parses POST C MONTHLY with permanentFailures', () => {
    const attributes = {
      runId: '2026-01-25-SAT-C-MONTHLY-LIVE-POST-0400',
      phase: 'post',
      marketDate: '2026-01-24',
      runType: 'ts-post-all-intervals',
      interval: 'monthly',
      successes: '1',
      permanentFailures: '1',
    };
    const payload = {
      runId: '2026-01-25-SAT-C-MONTHLY-LIVE-POST-0400',
      phase: 'post',
      intervals: ['monthly'],
      marketDate: '2026-01-24',
      includeSymbols: ['TSLA'],
      runStatus: 'completed_with_errors',
    };

    const ctx = resolvePdrContext(attributes, payload);

    assert.equal(ctx.interval, 'MONTHLY');
    assert.equal(ctx.sequence, 'C');
    assert.deepEqual(ctx.includeSymbols, ['TSLA']);
  });
});

describe('resolveSequence', () => {
  it('extracts A from POST A runId', () => {
    assert.equal(resolveSequence('2026-01-24-FRI-A-DAILY-LIVE-POST-1335'), 'A');
  });

  it('extracts B from POST B runId', () => {
    assert.equal(resolveSequence('2026-01-24-FRI-B-WEEKLY-LIVE-POST-1800'), 'B');
  });

  it('extracts C from POST C runId', () => {
    assert.equal(resolveSequence('2026-01-25-SAT-C-MONTHLY-LIVE-POST-0400'), 'C');
  });

  it('returns undefined for intraday runId', () => {
    assert.equal(resolveSequence('2026-01-24-FRI-LIVE-0800'), undefined);
  });
});

describe('computeSequenceRunId', () => {
  it('derives sequence ID from POST A DAILY runId', () => {
    assert.equal(
      computeSequenceRunId('2026-01-24-FRI-A-DAILY-LIVE-POST-1335', '2026-01-24'),
      '2026-01-24-POST-A',
    );
  });

  it('derives sequence ID from POST B WEEKLY runId', () => {
    assert.equal(
      computeSequenceRunId('2026-01-24-FRI-B-WEEKLY-LIVE-POST-1800', '2026-01-24'),
      '2026-01-24-POST-B',
    );
  });

  it('derives sequence ID from POST C MONTHLY runId (next-day run, same marketDate)', () => {
    assert.equal(
      computeSequenceRunId('2026-01-25-SAT-C-MONTHLY-LIVE-POST-0400', '2026-01-24'),
      '2026-01-24-POST-C',
    );
  });

  it('returns undefined for intraday runId', () => {
    assert.equal(computeSequenceRunId('2026-01-24-FRI-LIVE-0800', '2026-01-24'), undefined);
  });
});

describe('resolveSymbolSet', () => {
  const trackedSymbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'];

  it('POST A: all tracked minus excludeSymbols', () => {
    const ctx = resolvePdrContext(
      {
        runId: '2026-01-24-FRI-A-DAILY-LIVE-POST-1335',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { excludeSymbols: ['AAPL', 'MSFT'] },
    );
    assert.deepEqual(resolveSymbolSet(ctx, trackedSymbols), ['GOOGL', 'TSLA', 'NVDA']);
  });

  it('POST B: only includeSymbols', () => {
    const ctx = resolvePdrContext(
      {
        runId: '2026-01-24-FRI-B-DAILY-LIVE-POST-1800',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { includeSymbols: ['AAPL', 'TSLA'] },
    );
    assert.deepEqual(resolveSymbolSet(ctx, trackedSymbols), ['AAPL', 'TSLA']);
  });

  it('POST B with empty includeSymbols: returns empty', () => {
    const ctx = resolvePdrContext(
      {
        runId: '2026-01-24-FRI-B-DAILY-LIVE-POST-1800',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      { includeSymbols: [] },
    );
    assert.deepEqual(resolveSymbolSet(ctx, trackedSymbols), []);
  });

  it('POST B with missing includeSymbols: returns empty', () => {
    const ctx = resolvePdrContext(
      {
        runId: '2026-01-24-FRI-B-DAILY-LIVE-POST-1800',
        phase: 'post',
        marketDate: '2026-01-24',
        runType: 'ts-post-all-intervals',
        interval: 'daily',
      },
      {},
    );
    assert.deepEqual(resolveSymbolSet(ctx, trackedSymbols), []);
  });

  it('intraday PRE: all tracked symbols', () => {
    const ctx = resolvePdrContext(
      {
        runId: '2026-01-24-FRI-LIVE-0800',
        phase: 'pre',
        marketDate: '2026-01-24',
        runType: 'intraday-snapshot',
        clockPt: '0800',
      },
      {},
    );
    assert.deepEqual(resolveSymbolSet(ctx, trackedSymbols), trackedSymbols);
  });
});
