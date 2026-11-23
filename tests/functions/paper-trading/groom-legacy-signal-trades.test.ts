/**
 * @topic #553 — Paper Trading Infra (task #1651)
 *
 * `groom-legacy-signal-trades` — the one-shot wipe of `source=SIGNAL`
 * trades left by the retired auto-ingest. The script scans the signal-
 * source trades, pre-classifies each doc against the same refusal set
 * `deleteTradeCascade` enforces inside its transaction (cohortId /
 * positionGroupId / ticket → accept-flow, skipped + reported, never
 * force-deleted), and drives the prod cascade in
 * `DELETE_PAPER_TRADES_MAX_ITEMS` batches. The default census-only run
 * deletes nothing; `--apply` deletes; a re-run is a no-op report.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeleteTradeCascadeOutcome } from '../../../functions/src/paper-trading/repository';
import { PaperTradeStatus } from '../../../shared/paper-trading-contracts';
import {
  runGroomSignalTrades,
  type GroomSignalTradeRow,
  type GroomSignalTradesDeps,
} from '../../../functions/scripts/groom-legacy-signal-trades';

function row(
  id: string,
  extra: Partial<Omit<GroomSignalTradeRow, 'id'>> = {},
): GroomSignalTradeRow {
  return { id, status: PaperTradeStatus.OPEN, ...extra };
}

function deps(
  rows: GroomSignalTradeRow[],
  outcomes: Record<string, DeleteTradeCascadeOutcome | Error> = {},
) {
  const deleteCalls: string[] = [];
  const deps: GroomSignalTradesDeps = {
    listSignalTrades: async () => rows,
    deleteTrade: async (tradeId) => {
      deleteCalls.push(tradeId);
      const o = outcomes[tradeId] ?? 'deleted';
      if (o instanceof Error) throw o;
      return o;
    },
  };
  return { deps, deleteCalls };
}

describe('groom-legacy-signal-trades — eligibility parity (#1651)', () => {
  it('eligible signal trades are deleted; marker-carrying trades are skipped + reported, never deleted', async () => {
    const { deps: d, deleteCalls } = deps([
      row('sig-a'),
      row('with-cohort', { cohortId: 'cohort-1' }),
      row('with-group', { positionGroupId: 'grp-1' }),
      row('with-ticket', {
        ticket: { refId: 'r1', acceptedAt: '2026-11-01T00:00:00Z' },
      }),
      row('sig-b'),
    ]);
    const census = await runGroomSignalTrades(d, { apply: true });
    assert.deepEqual(deleteCalls, ['sig-a', 'sig-b']);
    assert.deepEqual(census.deleted, ['sig-a', 'sig-b']);
    assert.deepEqual(census.skippedAcceptFlow, [
      'with-cohort',
      'with-group',
      'with-ticket',
    ]);
  });

  it('a census-only run (no --apply) reports and deletes nobody', async () => {
    const { deps: d, deleteCalls } = deps([
      row('sig-a'),
      row('with-cohort', { cohortId: 'cohort-1' }),
    ]);
    const census = await runGroomSignalTrades(d, { apply: false });
    assert.equal(deleteCalls.length, 0);
    assert.equal(census.scanned, 2);
    assert.deepEqual(census.eligible, ['sig-a']);
    assert.deepEqual(census.skippedAcceptFlow, ['with-cohort']);
    assert.deepEqual(census.deleted, []);
  });

  it('batches apply deletes at the configured size — every eligible id is visited', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`sig-${i}`));
    const { deps: d, deleteCalls } = deps(rows);
    const census = await runGroomSignalTrades(d, { apply: true, batchSize: 2 });
    assert.equal(deleteCalls.length, 5);
    assert.deepEqual(census.deleted, rows.map((r) => r.id));
  });

  it('a non-positive batchSize clamps to 1 instead of spinning', async () => {
    const { deps: d, deleteCalls } = deps([row('sig-a'), row('sig-b')]);
    const census = await runGroomSignalTrades(d, { apply: true, batchSize: 0 });
    assert.equal(deleteCalls.length, 2);
    assert.deepEqual(census.deleted, ['sig-a', 'sig-b']);
  });

  it('cascade outcomes bucket: notFound / accept-flow / non-signal / throw → failed', async () => {
    const { deps: d } = deps(
      [row('a'), row('b'), row('c'), row('dd'), row('e')],
      {
        b: 'notFound',
        c: 'accept-flow',
        dd: 'non-signal',
        e: new Error('txn exploded'),
      },
    );
    const census = await runGroomSignalTrades(d, { apply: true });
    assert.deepEqual(census.deleted, ['a']);
    assert.deepEqual(census.notFound, ['b']);
    assert.deepEqual(census.cascadeRefused.acceptFlow, ['c']);
    assert.deepEqual(census.cascadeRefused.nonSignal, ['dd']);
    assert.deepEqual(census.failed, [
      { tradeId: 'e', error: 'txn exploded' },
    ]);
  });

  it('re-run after apply is a no-op report — remaining scan holds only the skipped set', async () => {
    // Post-wipe prod state: the source==SIGNAL query returns only the
    // accept-flow rows the wipe refused.
    const { deps: d, deleteCalls } = deps([
      row('with-group', { positionGroupId: 'grp-1' }),
    ]);
    const census = await runGroomSignalTrades(d, { apply: true });
    assert.equal(deleteCalls.length, 0);
    assert.equal(census.scanned, 1);
    assert.deepEqual(census.eligible, []);
    assert.deepEqual(census.deleted, []);
    assert.deepEqual(census.skippedAcceptFlow, ['with-group']);
  });
});
