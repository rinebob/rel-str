/**
 * @topic #553 — Paper Trading Infra (task #917)
 *
 * Auto-paper ingest pass gates: config doc presence/enabled and the
 * live-market-date check — the work (selection, quotes, fills) lands in
 * #918. These tests pin the gate contract that keeps historical/replay
 * runs and disabled deployments from touching quotes or trades.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_PAPER_DEFAULT_SIGNAL_TYPES,
  resolveAutoPaperScope,
  runAutoPaperIngestPass,
  type AutoPaperIngestDeps,
} from '../../../functions/src/paper-trading/passes/auto-paper-ingest-pass';
import type { AutoPaperConfig } from '../../../functions/src/common/st-collections';

const TODAY = '2026-10-08';

function depsWith(config: AutoPaperConfig | null, todayPT = TODAY): AutoPaperIngestDeps {
  return {
    loadConfig: async () => config,
    todayPT: () => todayPT,
  };
}

const ENABLED: AutoPaperConfig = { enabled: true, lists: ['PRIMARY'] };

describe('runAutoPaperIngestPass gates', () => {
  it('skips cleanly when the config doc is missing', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith(null),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing-config');
    assert.equal(result.scope, undefined);
  });

  it('skips cleanly when disabled', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith({ enabled: false, lists: ['PRIMARY'] }),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'disabled');
  });

  it('skips historical/replay runs (marketDate ≠ today PT)', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: '2020-01-02' },
      depsWith(ENABLED),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'historical-run');
  });

  it('skips when the payload has no marketDate', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1' },
      depsWith(ENABLED),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'historical-run');
  });

  it('skips an enabled config with an empty lists scope', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith({ enabled: true, lists: [] }),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'empty-scope');
  });

  it('skips a malformed config whose lists field is not an array', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith({ enabled: true } as AutoPaperConfig),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'empty-scope');
  });

  it('passes the gates on a live-date enabled config', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith(ENABLED),
    );
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.scope?.lists, ['PRIMARY']);
    assert.equal(result.scope?.global, false);
  });
});

describe('resolveAutoPaperScope', () => {
  it("treats lists: ['*'] as global capture", () => {
    const scope = resolveAutoPaperScope({ enabled: true, lists: ['*'] });
    assert.equal(scope.global, true);
    assert.deepEqual(scope.lists, []);
  });

  it("drops '*' from the list set when mixed with named lists", () => {
    const scope = resolveAutoPaperScope({ enabled: true, lists: ['PRIMARY', '*'] });
    assert.equal(scope.global, true);
    assert.deepEqual(scope.lists, ['PRIMARY']);
  });

  it('defaults signalTypes to the four trend-rider daily types', () => {
    const scope = resolveAutoPaperScope(ENABLED);
    assert.deepEqual(scope.signalTypes, [...AUTO_PAPER_DEFAULT_SIGNAL_TYPES]);
    assert.deepEqual(AUTO_PAPER_DEFAULT_SIGNAL_TYPES, [
      'D_ST_TREND_RIDER_V1_LONG',
      'D_ST_TREND_RIDER_V1_SHORT',
      'D_ST_TREND_RIDER_V2_LONG',
      'D_ST_TREND_RIDER_V2_SHORT',
    ]);
  });

  it('honors a config signalTypes override', () => {
    const scope = resolveAutoPaperScope({
      enabled: true,
      lists: ['PRIMARY'],
      signalTypes: ['D_ST_TREND_RIDER_V1_LONG'],
    });
    assert.deepEqual(scope.signalTypes, ['D_ST_TREND_RIDER_V1_LONG']);
  });
});
