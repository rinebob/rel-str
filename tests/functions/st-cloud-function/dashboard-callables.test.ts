/**
 * @task #1444 — stGetSymbolsWithSignals / stGetSymbolSignalHistory auth guards
 *
 * Both callables shipped invoker:'public' with no request.auth check — the
 * guard must fire inside the testable core, before validation or any dep.
 * Light wiring tests prove the (request, deps) extraction preserved behavior.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleStGetSymbolsWithSignals,
  handleStGetSymbolSignalHistory,
  type StDashboardDeps,
} from '../../../functions/src/st-cloud-function/dashboard-callables';
import type { StSignal } from '@st/signals';
import { TradeSide } from '../../../shared/common';

const code = (e: unknown) => (e as { code?: string }).code;

const mkReq = (data: unknown, authed: boolean) => ({
  data,
  auth: authed ? { uid: 'u1' } : undefined,
});

function request(data: unknown) {
  return mkReq(data, true) as Parameters<typeof handleStGetSymbolsWithSignals>[0];
}

/** auth:undefined — Firebase treats the call as unauthenticated. */
function unauthRequest(data: unknown) {
  return mkReq(data, false) as Parameters<typeof handleStGetSymbolsWithSignals>[0];
}

function historyRequest(data: unknown) {
  return mkReq(data, true) as Parameters<typeof handleStGetSymbolSignalHistory>[0];
}

/** auth:undefined — Firebase treats the call as unauthenticated. */
function unauthHistoryRequest(data: unknown) {
  return mkReq(data, false) as Parameters<typeof handleStGetSymbolSignalHistory>[0];
}

function signal(overrides: Partial<StSignal> = {}): StSignal {
  return {
    symbol: 'QQQ',
    signalType: 'pullback',
    barDate: '2026-11-06',
    marketDate: '2026-11-06',
    direction: TradeSide.LONG,
    timeframe: 'D',
    indicators: {},
    status: 'CONFIRMED',
    sourceRunId: 'run-1',
    runIds: ['run-1'],
    ticketIds: [],
    positionGroupIds: [],
    createdAt: '2026-11-06T00:00:00Z',
    updatedAt: '2026-11-06T00:00:00Z',
    ...overrides,
  };
}

/** Deps that record every call — an empty `calls` proves the guard ran first. */
function makeDeps(overrides: Partial<StDashboardDeps> = {}) {
  const calls: string[] = [];
  const deps: StDashboardDeps = {
    async signalsByRunId() {
      calls.push('signalsByRunId');
      return [signal(), signal({ symbol: 'SPY' })];
    },
    async enabledSymbolProfiles() {
      calls.push('enabledSymbolProfiles');
      return [
        { id: 'QQQ', data: () => ({ symbol: 'QQQ', name: 'Invesco QQQ' }) },
        { id: 'SPY', data: () => ({ symbol: 'SPY' }) },
      ];
    },
    async signalsBySymbol() {
      calls.push('signalsBySymbol');
      return [
        { id: 'a', signal: signal({ barDate: '2026-11-05' }) },
        { id: 'b', signal: signal({ barDate: '2026-11-06' }) },
      ];
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('stGetSymbolsWithSignals — auth guard (#1444)', () => {
  it('unauthenticated → unauthenticated, zero deps touched', async () => {
    const { deps, calls } = makeDeps();
    const err = await handleStGetSymbolsWithSignals(
      unauthRequest({ runId: 'r1', timeframe: 'D' }),
      deps,
    ).catch((e) => e);
    assert.equal(code(err), 'unauthenticated');
    assert.deepEqual(calls, []);
  });
});

describe('stGetSymbolsWithSignals — wiring', () => {
  it('missing runId/timeframe → invalid-argument before any dep', async () => {
    const { deps, calls } = makeDeps();
    const err = await handleStGetSymbolsWithSignals(request({}), deps).catch((e) => e);
    assert.equal(code(err), 'invalid-argument');
    assert.deepEqual(calls, []);
  });

  it('maps runId-matched signals to enabled symbol profiles', async () => {
    const { deps } = makeDeps();
    const res = await handleStGetSymbolsWithSignals(
      request({ runId: 'r1', timeframe: 'D' }),
      deps,
    );
    assert.deepEqual(res.symbols.map((s) => s.symbol).sort(), ['QQQ', 'SPY']);
    assert.equal(res.symbols.find((s) => s.symbol === 'QQQ')?.name, 'Invesco QQQ');
  });

  it('no matching signals → empty list without a profile fetch', async () => {
    const { deps, calls } = makeDeps({
      signalsByRunId: async () => {
        calls.push('signalsByRunId');
        return [];
      },
    });
    const res = await handleStGetSymbolsWithSignals(
      request({ runId: 'r1', timeframe: 'D' }),
      deps,
    );
    assert.deepEqual(res.symbols, []);
    assert.deepEqual(calls, ['signalsByRunId']);
  });
});

describe('stGetSymbolSignalHistory — auth guard (#1444)', () => {
  it('unauthenticated → unauthenticated, zero deps touched', async () => {
    const { deps, calls } = makeDeps();
    const err = await handleStGetSymbolSignalHistory(
      unauthHistoryRequest({ symbol: 'QQQ', timeframe: 'D' }),
      deps,
    ).catch((e) => e);
    assert.equal(code(err), 'unauthenticated');
    assert.deepEqual(calls, []);
  });
});

describe('stGetSymbolSignalHistory — wiring', () => {
  it('missing symbol → invalid-argument before any dep', async () => {
    const { deps, calls } = makeDeps();
    const err = await handleStGetSymbolSignalHistory(historyRequest({}), deps).catch((e) => e);
    assert.equal(code(err), 'invalid-argument');
    assert.deepEqual(calls, []);
  });

  it('maps docs to SignalItems sorted newest-first', async () => {
    const { deps } = makeDeps();
    const res = await handleStGetSymbolSignalHistory(
      historyRequest({ symbol: 'QQQ', timeframe: 'D' }),
      deps,
    );
    assert.equal(res.signals.length, 2);
    assert.equal(res.signals[0].id, 'b');
    assert.equal(res.signals[0].barDate, '2026-11-06');
    assert.equal(res.signals[0].runId, 'run-1');
  });
});
