/**
 * @topic #553 — Paper Trading Infra (task #931)
 *
 * `signalEntriesFromDoc` is the single read boundary for signal-bearing
 * docs (`run-ids`, `signal-history`, `signal-dates`). Prod writers emit
 * literal flattened top-level `signals.{type}` fields — dotted keys
 * survive `set(merge)` verbatim — while some docs carry a nested `signals`
 * map. These specs pin the both-shape normalization every reader needs.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signalEntriesFromDoc } from '../../functions/src/st-cloud-function/signals';

const V1L = 'D_ST_TREND_RIDER_V1_LONG';
const V2S = 'D_ST_TREND_RIDER_V2_SHORT';

const entry = (over: Record<string, unknown> = {}) => ({
  direction: 'LONG',
  status: 'CONFIRMED',
  timeframe: 'D',
  barDate: '2026-10-08',
  marketDate: '2026-10-09',
  indicators: { zone: 2 },
  ...over,
});

describe('signalEntriesFromDoc', () => {
  it('reads flattened signals.* keys (prod writer shape)', () => {
    const doc = { [`signals.${V1L}`]: entry(), other: 1 };
    const out = signalEntriesFromDoc(doc);
    assert.deepEqual(Object.keys(out), [V1L]);
    assert.equal(out[V1L].direction, 'LONG');
  });

  it('reads a nested signals map (signal-dates shape)', () => {
    const doc = { signals: { [V2S]: entry({ direction: 'SHORT' }) } };
    const out = signalEntriesFromDoc(doc);
    assert.deepEqual(Object.keys(out), [V2S]);
  });

  it('merges both shapes and ignores non-entry values', () => {
    const doc = {
      [`signals.${V1L}`]: entry(),
      signals: { [V2S]: entry({ direction: 'SHORT' }) },
      'signals.notAnEntry': null,
    };
    const out = signalEntriesFromDoc(doc);
    assert.deepEqual(Object.keys(out).sort(), [V1L, V2S].sort());
  });

  it('flattened wins when both shapes carry the same signalType', () => {
    const doc = {
      [`signals.${V1L}`]: entry({ direction: 'SHORT' }),
      signals: { [V1L]: entry() },
    };
    const out = signalEntriesFromDoc(doc);
    assert.equal(out[V1L].direction, 'SHORT');
  });

  it('preserves sourceRunId on signal-history entries', () => {
    const doc = { [`signals.${V1L}`]: entry({ sourceRunId: 'run-123' }) };
    const out = signalEntriesFromDoc(doc);
    assert.equal((out[V1L] as { sourceRunId?: string }).sourceRunId, 'run-123');
  });

  it('returns {} when no signal data is present', () => {
    assert.deepEqual(signalEntriesFromDoc({}), {});
    assert.deepEqual(signalEntriesFromDoc({ signals: 'not-a-map' }), {});
  });
});
