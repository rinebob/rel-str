/**
 * @topic #553 — Paper Trading Infra (task #1650)
 *
 * `getSignalReviewQueue` + `getSignalReviewBundle` — the pane-facing
 * read surface for Thread #1117 signal-selection review.
 *
 * Bundle: `st-signals` occurrences (daily only, newest-first) reshaped to
 * `SignalReviewOccurrence` and joined to `source=SIGNAL` ledger trades via
 * `signalDedupeKey` — `checked` means **curation-mint membership** (the
 * scoped semantic decided at the #1649 review gate: accept-flow trades
 * stamped `canonicalOccurrenceDecisionId` carry no barDate and join as
 * `checked:false`; they can't be unchecked through the pane anyway).
 * The same read then stamps `st-config/signalReview.lastOpenedAt[symbol]`,
 * returning the pre-stamp value as `previousOpenedAt`.
 *
 * Queue: `st-config/autoPaper.ownerUid` resolves the list-owner; the
 * universe is PRIMARY ∪ SECONDARY membership (deduped), merged with
 * `st-symbols.lastDailySignalDate` + the review-state open stamps.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import {
  PaperTradeStatus,
  type PaperTrade,
  type GetSignalReviewBundleRequest,
  type SignalReviewOccurrence,
} from '../../../shared/paper-trading-contracts';
import { signalDedupeKey } from '../../../shared/paper-trading-ids';
import { stSignalOccurrenceId } from '../../../shared/st-ids';
import type { StSignal } from '../../../shared/st-signals';
import {
  handleGetSignalReviewBundle,
  handleGetSignalReviewQueue,
  type SignalReviewDeps,
} from '../../../functions/src/paper-trading/signal-review-callables';

const NOW = new Date('2026-11-22T18:00:00Z');
const NOW_ISO = NOW.toISOString();
const AUTH = { auth: { uid: 'user-1' } };

/** HttpsError carries its callable code on `.code` — assert the shape
 *  without importing firebase-functions (sibling spec convention). */
const hasCode = (err: unknown, code: string) =>
  (err as { code?: string }).code === code;

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<StSignal> = {}): StSignal {
  return {
    symbol: 'AAPL',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    barDate: '2024-03-11',
    marketDate: '2024-03-12',
    direction: TradeSide.LONG,
    timeframe: 'D',
    indicators: { sma20: 172.4, strength: 0.83 },
    status: 'CONFIRMED',
    sourceRunId: 'run-1',
    runIds: ['run-1'],
    ticketIds: [],
    positionGroupIds: [],
    createdAt: '2024-03-12T00:00:00Z',
    updatedAt: '2024-03-12T00:00:00Z',
    ...overrides,
  };
}

type JoinedTrade = Pick<PaperTrade, 'id' | 'signalId' | 'status'>;

function makeTrade(id: string, signalId: string): JoinedTrade {
  return { id, signalId, status: PaperTradeStatus.OPEN };
}

interface DepOverrides {
  occurrences?: StSignal[];
  trades?: JoinedTrade[];
  members?: Record<string, string[]>;
  signalDates?: Record<string, string>;
  reviewState?: { lastOpenedAt: Record<string, string> };
  ownerUid?: string | null;
  stampError?: Error;
}

function makeDeps(overrides: DepOverrides = {}) {
  const calls = { stamps: [] as { symbol: string; at: string }[] };
  const deps: SignalReviewDeps = {
    listOccurrences: async () => overrides.occurrences ?? [],
    listSignalTrades: async () => overrides.trades ?? [],
    listMembers: async (listKey) => overrides.members?.[listKey] ?? [],
    getSymbolSignalDates: async () => new Map(Object.entries(overrides.signalDates ?? {})),
    getReviewState: async () => overrides.reviewState ?? { lastOpenedAt: {} },
    getOwnerUid: async () => overrides.ownerUid === undefined ? 'user-1' : overrides.ownerUid,
    stampOpened: async (symbol, at) => {
      if (overrides.stampError) throw overrides.stampError;
      calls.stamps.push({ symbol, at });
    },
    now: () => NOW,
  };
  return { deps, calls };
}

// `unknown` param feeds deliberate invalid inputs through the typed
// boundary — the cast marks the seam, the handler validates at runtime.
const bundleReq = (symbol: unknown) =>
  ({ ...AUTH, data: { symbol } as GetSignalReviewBundleRequest });
const queueReq = () => ({ ...AUTH, data: {} });

// ── handleGetSignalReviewBundle ────────────────────────────────────────────

describe('handleGetSignalReviewBundle — occurrence mapping + join', () => {
  it('maps a D occurrence to the review row shape', async () => {
    const occ = makeSignal();
    const { deps } = makeDeps({ occurrences: [occ] });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.symbol, 'AAPL');
    assert.equal(res.occurrences.length, 1);
    const row = res.occurrences[0];
    assert.equal(row.occurrenceId, 'AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG');
    assert.equal(row.symbol, 'AAPL');
    assert.equal(row.signalType, 'D_ST_TREND_RIDER_V1_LONG');
    assert.equal(row.signalBarDate, '2024-03-11');
    assert.equal(row.signalTimeframe, 'D');
    assert.equal(row.direction, TradeSide.LONG);
    assert.equal(row.signalStatus, 'CONFIRMED');
    assert.deepEqual(row.signalIndicators, { sma20: 172.4, strength: 0.83 });
    assert.equal(row.sourceRunId, 'run-1');
    assert.equal(row.checked, false);
    assert.equal(row.tradeId, undefined);
    assert.equal(row.tradeStatus, undefined);
  });

  it('checks an occurrence whose dedupe key matches a trade signalId', async () => {
    const occ = makeSignal();
    const key = signalDedupeKey('AAPL', 'D_ST_TREND_RIDER_V1_LONG', '2024-03-11');
    const { deps } = makeDeps({
      occurrences: [occ],
      trades: [makeTrade('240311-sig-AAPL-EQV1L', key)],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    const row = res.occurrences[0];
    assert.equal(row.checked, true);
    // checked:true ⇒ tradeId + tradeStatus paired (handler-side pin)
    assert.equal(row.tradeId, '240311-sig-AAPL-EQV1L');
    assert.equal(row.tradeStatus, PaperTradeStatus.OPEN);
  });

  it('does not check an occurrence for a trade on a different occurrence', async () => {
    const occ = makeSignal();
    const otherKey = signalDedupeKey('AAPL', 'D_ST_TREND_RIDER_V1_LONG', '2024-03-12');
    const { deps } = makeDeps({
      occurrences: [occ],
      trades: [makeTrade('240312-sig-AAPL-EQV1L', otherKey)],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.occurrences[0].checked, false);
  });

  it('swapped-key regression — a trade signalId in occurrence-id layout must NOT match', async () => {
    const occ = makeSignal();
    // stSignalOccurrenceId layout is {SYM}_{barDate}_{type} — the WRONG order
    // for the join key. A trade stamped with that string is not a match.
    const wrongLayout = stSignalOccurrenceId('AAPL', '2024-03-11', 'D_ST_TREND_RIDER_V1_LONG');
    const { deps } = makeDeps({
      occurrences: [occ],
      trades: [makeTrade('t-wrong', wrongLayout)],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.occurrences[0].checked, false);
  });

  it('scoped join: accept-flow trades (canonicalOccurrenceDecisionId signalId) do NOT check', async () => {
    const occ = makeSignal();
    // Accept-flow stamp: {runId}_{SYM}_{tf}_{type} — no barDate, can't
    // back-map. checked stays false even though the trade is a ledger member.
    const decisionId = 'run-9_AAPL_D_D_ST_TREND_RIDER_V1_LONG';
    const { deps } = makeDeps({
      occurrences: [occ],
      trades: [makeTrade('accept-1', decisionId)],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.occurrences[0].checked, false);
  });

  it('returns occurrences newest-first', async () => {
    const { deps } = makeDeps({
      occurrences: [
        makeSignal({ barDate: '2024-03-11' }),
        makeSignal({ barDate: '2024-06-20' }),
        makeSignal({ barDate: '2024-01-05' }),
      ],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.deepEqual(
      res.occurrences.map((o) => o.signalBarDate),
      ['2024-06-20', '2024-03-11', '2024-01-05'],
    );
  });

  it("normalizes legacy uppercase 'LONG'/'SHORT' direction docs", async () => {
    // Legacy corpus docs persist 'LONG' (raw string), not TradeSide —
    // the cast marks the legacy shape the corpus actually contains.
    const { deps } = makeDeps({
      occurrences: [makeSignal({ direction: 'LONG' as TradeSide })],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.occurrences[0].direction, TradeSide.LONG);
  });

  it('drops non-daily occurrences defensively (mint allowlist is daily)', async () => {
    const { deps } = makeDeps({
      occurrences: [
        makeSignal({ timeframe: 'W' }),
        makeSignal({ barDate: '2024-03-12' }),
      ],
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.occurrences.length, 1);
    assert.equal(res.occurrences[0].signalTimeframe, 'D');
  });
});

describe('handleGetSignalReviewBundle — review-state stamp semantics', () => {
  it('returns the pre-stamp value as previousOpenedAt and stamps openedAt', async () => {
    const { deps, calls } = makeDeps({
      occurrences: [makeSignal()],
      reviewState: { lastOpenedAt: { AAPL: '2026-11-01T00:00:00Z' } },
    });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.previousOpenedAt, '2026-11-01T00:00:00Z');
    assert.equal(res.openedAt, NOW_ISO);
    assert.deepEqual(calls.stamps, [{ symbol: 'AAPL', at: NOW_ISO }]);
  });

  it('first visit → previousOpenedAt null, still stamps', async () => {
    const { deps, calls } = makeDeps({ occurrences: [makeSignal()] });
    const res = await handleGetSignalReviewBundle(bundleReq('AAPL'), deps);
    assert.equal(res.previousOpenedAt, null);
    assert.equal(res.openedAt, NOW_ISO);
    assert.equal(calls.stamps.length, 1);
  });

  it('empty occurrence log still stamps (an empty visit is still a visit)', async () => {
    const { deps, calls } = makeDeps({ occurrences: [] });
    const res = await handleGetSignalReviewBundle(bundleReq('ZZZZ'), deps);
    assert.deepEqual(res.occurrences, []);
    assert.equal(calls.stamps.length, 1);
    assert.equal(calls.stamps[0].symbol, 'ZZZZ');
  });

  it('stamp write failure → internal (no silent unstamped serve)', async () => {
    const { deps } = makeDeps({
      occurrences: [makeSignal()],
      stampError: new Error('firestore down'),
    });
    await assert.rejects(
      () => handleGetSignalReviewBundle(bundleReq('AAPL'), deps),
      (err: unknown) => hasCode(err, 'internal')
    );
  });

  it('non-string / empty symbol → invalid-argument', async () => {
    const { deps } = makeDeps();
    for (const bad of [undefined, '', '   ', 42]) {
      await assert.rejects(
        () => handleGetSignalReviewBundle(bundleReq(bad), deps),
        (err: unknown) => hasCode(err, 'invalid-argument')
      );
    }
  });

  it('unauthenticated request → unauthenticated', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      () => handleGetSignalReviewBundle({ data: { symbol: 'AAPL' } }, deps),
      (err: unknown) => hasCode(err, 'unauthenticated')
    );
  });
});

// ── handleGetSignalReviewQueue ─────────────────────────────────────────────

describe('handleGetSignalReviewQueue', () => {
  it('unions PRIMARY + SECONDARY membership deduped', async () => {
    const { deps } = makeDeps({
      members: { PRIMARY: ['AAPL', 'MSFT'], SECONDARY: ['MSFT', 'ZZZZ'] },
    });
    const res = await handleGetSignalReviewQueue(queueReq(), deps);
    const symbols = res.rows.map((r) => r.symbol).sort();
    assert.deepEqual(symbols, ['AAPL', 'MSFT', 'ZZZZ']);
  });

  it('merges lastDailySignalDate; members with no symbol doc still appear', async () => {
    const { deps } = makeDeps({
      members: { PRIMARY: ['AAPL', 'QQQ'] },
      signalDates: { AAPL: '2026-11-20' },
    });
    const res = await handleGetSignalReviewQueue(queueReq(), deps);
    const aapl = res.rows.find((r) => r.symbol === 'AAPL')!;
    const qqq = res.rows.find((r) => r.symbol === 'QQQ')!;
    assert.equal(aapl.lastDailySignalDate, '2026-11-20');
    assert.equal(qqq.lastDailySignalDate, undefined);
  });

  it('merges lastOpenedAt from the review-state map', async () => {
    const { deps } = makeDeps({
      members: { PRIMARY: ['AAPL', 'QQQ'] },
      reviewState: { lastOpenedAt: { AAPL: '2026-11-21T15:00:00Z' } },
    });
    const res = await handleGetSignalReviewQueue(queueReq(), deps);
    const aapl = res.rows.find((r) => r.symbol === 'AAPL')!;
    const qqq = res.rows.find((r) => r.symbol === 'QQQ')!;
    assert.equal(aapl.lastOpenedAt, '2026-11-21T15:00:00Z');
    assert.equal(qqq.lastOpenedAt, undefined);
  });

  it('missing ownerUid → failed-precondition (never a silent user pick)', async () => {
    const { deps } = makeDeps({ ownerUid: null });
    await assert.rejects(
      () => handleGetSignalReviewQueue(queueReq(), deps),
      (err: unknown) => hasCode(err, 'failed-precondition')
    );
  });

  it('unauthenticated request → unauthenticated', async () => {
    const { deps } = makeDeps();
    await assert.rejects(
      () => handleGetSignalReviewQueue({ data: {} }, deps),
      (err: unknown) => hasCode(err, 'unauthenticated')
    );
  });
});
