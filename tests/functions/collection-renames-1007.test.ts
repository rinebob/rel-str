/**
 * @topic #984 — ST Firestore Reorg (task #1007; mirror specs removed in #1013)
 *
 * Collection-routing coverage:
 * - collections.ts routes account/trade/stats/raw-quote to st-paper-trading
 *   while cohort/analysis (and the now-unread instances anchor) stay on the
 *   legacy root.
 * - The #1007 soak mirrors (portfolioItemsMirror, stBacktest*Mirror) were
 *   undeployed and their sources deleted in #1013 — the source-scan pin in
 *   legacy-roots-cleanup-1013.test.ts asserts they stay gone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PaperTradingKind } from '../../shared/paper-trading-ids';
import {
  paperDocRef,
  paperItemsRef,
  paperTradingDocPathFor,
} from '../../functions/src/paper-trading/collections';

// ── Fake Firestore — docs keyed by path; captures writes ────────────────────

type FakeDoc = { exists: boolean; data: () => Record<string, unknown> | undefined };

function fakeFirestore(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(initial).map(([k, v]) => [k, { ...v }]),
  );
  const collectionCalls: string[] = [];
  const refFor = (path: string) => ({
    get: async (): Promise<FakeDoc> => {
      const d = store.get(path);
      return { exists: d !== undefined, data: () => d };
    },
    set: async (doc: Record<string, unknown>, setOpts?: { merge?: boolean }) => {
      store.set(path, setOpts?.merge === true ? { ...(store.get(path) ?? {}), ...doc } : { ...doc });
    },
    delete: async () => { store.delete(path); },
  });
  const db = {
    doc: (path: string) => refFor(path),
    collection: (name: string) => {
      collectionCalls.push(name);
      return { doc: (id: string) => refFor(`${name}/${id}`) };
    },
  };
  return { db, store, collectionCalls };
}

// ── collections.ts routing ───────────────────────────────────────────────────

describe('path strings through the seam', () => {
  const f = fakeFirestore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = f.db as any;

  for (const [kind, expected] of [
    [PaperTradingKind.ACCOUNT, 'st-paper-trading/accounts/items/acct-u1'],
    [PaperTradingKind.TRADE, 'st-paper-trading/trades/items/t-1'],
    [PaperTradingKind.STATS, 'st-paper-trading/stats/items/stats-all'],
    [PaperTradingKind.RAW_QUOTE, 'st-paper-trading/raw-quotes/items/rq-1'],
    [PaperTradingKind.INSTANCE, 'paper-trading/instances/items/i-1'],
    [PaperTradingKind.COHORT, 'paper-trading/cohorts/items/cohort-1'],
    [PaperTradingKind.ANALYSIS_DATASET, 'paper-trading/analysis-datasets/items/ds-1'],
    [PaperTradingKind.ANALYSIS_SLICE, 'paper-trading/analysis-slices/items/s-1'],
  ] as const) {
    it(`${kind} → ${expected}`, async () => {
      const id = expected.split('/').pop()!;
      await paperDocRef(db, kind, id).set({ probe: true });
      assert.ok(f.store.has(expected), `expected write at ${expected}`);
      assert.equal(paperTradingDocPathFor(kind, id), expected);
    });
  }
});

describe('paperItemsRef routing', () => {
  for (const [kind, expected] of [
    [PaperTradingKind.TRADE, 'st-paper-trading/trades/items'],
    [PaperTradingKind.COHORT, 'paper-trading/cohorts/items'],
  ] as const) {
    it(`${kind} → collection ${expected}`, () => {
      const f = fakeFirestore();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paperItemsRef(f.db as any, kind);
      assert.deepEqual(f.collectionCalls, [expected]);
    });
  }
});
