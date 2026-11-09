/**
 * @task #1444 — stBacktestStrategies auth guard
 *
 * Read-only strategy discovery callable — public-invoker with no
 * request.auth check. Guard must fire before the registry list.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleStBacktestStrategies } from '../../../functions/src/st-cloud-function/backtest/backtest-strategies-callable';
import type { StrategyMetadata } from '../../../functions/src/st-cloud-function/strategies/base-strategy';

const code = (e: unknown) => (e as { code?: string }).code;

function request(data: unknown) {
  return { data, auth: { uid: 'u1' } } as Parameters<typeof handleStBacktestStrategies>[0];
}

/** auth:undefined — Firebase treats the call as unauthenticated. */
function unauthRequest(data: unknown) {
  return { data, auth: undefined } as Parameters<typeof handleStBacktestStrategies>[0];
}

describe('stBacktestStrategies — auth guard (#1444)', () => {
  it('unauthenticated → unauthenticated, zero deps touched', async () => {
    let listed = 0;
    const deps = {
      listStrategies: (): StrategyMetadata[] => {
        listed++;
        return [];
      },
    };
    const err = await handleStBacktestStrategies(unauthRequest({}), deps).catch((e) => e);
    assert.equal(code(err), 'unauthenticated');
    assert.equal(listed, 0);
  });
});

describe('stBacktestStrategies — wiring', () => {
  it('returns the registry metadata list', async () => {
    const deps = {
      listStrategies: (): StrategyMetadata[] => [
        {
          id: 'st-trend-rider',
          name: 'ST Trend Rider',
          description: 'd',
          category: 'trend',
          defaultConfig: {},
          minBarsRequired: 50,
          supportedTimeframes: ['D', 'W'],
          version: '1.0.0',
          author: 'test',
        },
      ],
    };
    const res = await handleStBacktestStrategies(request({}), deps);
    assert.equal(res.strategies.length, 1);
    assert.equal(res.strategies[0].id, 'st-trend-rider');
  });
});
