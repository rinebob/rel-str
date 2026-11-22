/**
 * #1650 — BE Task: signal-review callables (Thread #1117).
 *
 * Verifies `handleGetSignalReviewBundle` + `handleGetSignalReviewQueue`
 * end-to-end through the real handlers:
 *
 * DRY stage — fixture deps:
 *   1. occurrence reshaping (barDate→signalBarDate etc.) + occurrenceId
 *   2. ledger join via signalDedupeKey — checked + tradeId + tradeStatus
 *   3. swapped-layout trap: a trade signalId in stSignalOccurrenceId order
 *      must NOT check the occurrence
 *   4. scoped join: accept-flow decisionId signalIds do NOT check
 *   5. read-then-stamp: previousOpenedAt is the pre-stamp value; the
 *      stamp fires exactly once — even on an empty occurrence log
 *   6. stamp failure → internal; invalid symbol → invalid-argument
 *   7. queue: PRIMARY ∪ SECONDARY dedupe + date/stamp merges; missing
 *      ownerUid → failed-precondition (never a silent user pick)
 *
 * LIVE stage (`--live`, needs ADC + GOOGLE_CLOUD_PROJECT=rel-str):
 *   8. prod deps: ownerUid resolves, queue returns real list members
 *   9. prod deps: a real symbol's bundle returns daily occurrences
 *      newest-first and stamps st-config/signalReview (designed write)
 *
 *   cd functions
 *   npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts [--live]
 */

import { getFirestore } from 'firebase-admin/firestore';
import {
  handleGetSignalReviewBundle,
  handleGetSignalReviewQueue,
  signalReviewProdDeps,
  type SignalReviewDeps,
} from '../../src/paper-trading/signal-review-callables';
import { signalDedupeKey } from '../../../shared/paper-trading-ids';
import { stSignalOccurrenceId } from '../../../shared/st-ids';
import { PaperTradeStatus } from '../../../shared/paper-trading-contracts';
import type { PaperTrade } from '../../../shared/paper-trading-contracts';
import type { StSignal } from '../../../shared/st-signals';
import { TradeSide } from '../../../shared/common';

const LIVE = process.argv.includes('--live');
const AUTH = { auth: { uid: 'verify-1650' } };
const NOW = new Date('2026-11-22T18:00:00Z');
const NOW_ISO = NOW.toISOString();

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function codeIs(err: unknown, code: string) {
  return (err as { code?: string }).code === code;
}

function sig(overrides: Partial<StSignal> = {}): StSignal {
  return {
    symbol: 'AAPL',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    barDate: '2024-03-11',
    marketDate: '2024-03-12',
    direction: TradeSide.LONG,
    timeframe: 'D',
    indicators: { sma20: 172.4 },
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

function trade(id: string, signalId: string): JoinedTrade {
  return { id, signalId, status: PaperTradeStatus.OPEN };
}

interface Fx {
  occurrences?: StSignal[];
  trades?: JoinedTrade[];
  members?: Record<string, string[]>;
  dates?: Record<string, string>;
  state?: { lastOpenedAt: Record<string, string> };
  ownerUid?: string | null;
  stampError?: Error;
}

function fx(o: Fx) {
  const stamps: { symbol: string; at: string }[] = [];
  const deps: SignalReviewDeps = {
    listOccurrences: async () => o.occurrences ?? [],
    listSignalTrades: async () => o.trades ?? [],
    listMembers: async (k) => o.members?.[k] ?? [],
    getSymbolSignalDates: async () => new Map(Object.entries(o.dates ?? {})),
    getReviewState: async () => o.state ?? { lastOpenedAt: {} },
    getOwnerUid: async () => (o.ownerUid === undefined ? 'u1' : o.ownerUid),
    stampOpened: async (symbol, at) => {
      if (o.stampError) throw o.stampError;
      stamps.push({ symbol, at });
    },
    now: () => NOW,
  };
  return { deps, stamps };
}

async function dry() {
  console.log('— bundle: mapping + join —');
  {
    const { deps } = fx({
      occurrences: [sig()],
      trades: [trade('t1', signalDedupeKey('AAPL', 'D_ST_TREND_RIDER_V1_LONG', '2024-03-11'))],
    });
    const res = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: 'aapl' } }, deps);
    const row = res.occurrences[0];
    check(
      'occurrence reshaped to the review row (occurrenceId + renamed fields)',
      row.occurrenceId === 'AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG' &&
        row.signalBarDate === '2024-03-11' &&
        row.signalTimeframe === 'D' &&
        row.signalStatus === 'CONFIRMED' &&
        row.signalIndicators.sma20 === 172.4,
      JSON.stringify(row),
    );
    check(
      'dedupe-key match → checked + tradeId + tradeStatus',
      row.checked === true && row.tradeId === 't1' && row.tradeStatus === PaperTradeStatus.OPEN,
    );
    check('symbol normalized to uppercase', res.symbol === 'AAPL');
  }

  console.log('— bundle: join hazards —');
  {
    const { deps } = fx({
      occurrences: [sig()],
      trades: [
        trade('wrong', stSignalOccurrenceId('AAPL', '2024-03-11', 'D_ST_TREND_RIDER_V1_LONG')),
        trade('accept', 'run-9_AAPL_D_D_ST_TREND_RIDER_V1_LONG'),
      ],
    });
    const res = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: 'AAPL' } }, deps);
    check(
      'swapped-layout signalId does NOT check (occurrence-id order ≠ dedupe key)',
      res.occurrences[0].checked === false,
    );
  }

  console.log('— bundle: stamp semantics —');
  {
    const { deps, stamps } = fx({
      occurrences: [sig()],
      state: { lastOpenedAt: { AAPL: '2026-11-01T00:00:00Z' } },
    });
    const res = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: 'AAPL' } }, deps);
    check(
      'previousOpenedAt is the pre-stamp value; openedAt is the new stamp',
      res.previousOpenedAt === '2026-11-01T00:00:00Z' && res.openedAt === NOW_ISO,
    );
    check('stamp fired exactly once', stamps.length === 1 && stamps[0].symbol === 'AAPL');
  }
  {
    const { deps, stamps } = fx({ occurrences: [] });
    const res = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: 'ZZZZ' } }, deps);
    check(
      'first visit → previousOpenedAt null; empty log still stamps',
      res.previousOpenedAt === null && res.occurrences.length === 0 && stamps.length === 1,
    );
  }
  {
    const { deps } = fx({ stampError: new Error('firestore down') });
    const err = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: 'AAPL' } }, deps)
      .then(() => null)
      .catch((e) => e);
    check('stamp failure → internal', codeIs(err, 'internal'));
    const bad = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: '  ' } }, deps)
      .then(() => null)
      .catch((e) => e);
    check('empty symbol → invalid-argument', codeIs(bad, 'invalid-argument'));
  }

  console.log('— bundle: ordering + daily filter —');
  {
    const { deps } = fx({
      occurrences: [
        sig({ barDate: '2024-03-11' }),
        sig({ barDate: '2024-06-20' }),
        sig({ timeframe: 'W' }),
      ],
    });
    const res = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: 'AAPL' } }, deps);
    check(
      'newest-first; weekly rows dropped',
      res.occurrences.length === 2 &&
        res.occurrences[0].signalBarDate === '2024-06-20' &&
        res.occurrences[1].signalBarDate === '2024-03-11',
    );
  }

  console.log('— queue —');
  {
    const { deps } = fx({
      members: { PRIMARY: ['AAPL', 'MSFT'], SECONDARY: ['MSFT', 'QQQ'] },
      dates: { AAPL: '2026-11-20' },
      state: { lastOpenedAt: { QQQ: '2026-11-21T15:00:00Z' } },
    });
    const res = await handleGetSignalReviewQueue({ ...AUTH, data: {} }, deps);
    const bySym = new Map(res.rows.map((r) => [r.symbol, r]));
    check(
      'PRIMARY ∪ SECONDARY deduped — all members appear',
      res.rows.length === 3 && ['AAPL', 'MSFT', 'QQQ'].every((s) => bySym.has(s)),
    );
    check(
      'lastDailySignalDate merged; absent for unsignaled members',
      bySym.get('AAPL')?.lastDailySignalDate === '2026-11-20' &&
        bySym.get('MSFT')?.lastDailySignalDate === undefined,
    );
    check(
      'lastOpenedAt merged; absent until first visit',
      bySym.get('QQQ')?.lastOpenedAt === '2026-11-21T15:00:00Z' &&
        bySym.get('AAPL')?.lastOpenedAt === undefined,
    );
  }
  {
    const { deps } = fx({ ownerUid: null });
    const err = await handleGetSignalReviewQueue({ ...AUTH, data: {} }, deps)
      .then(() => null)
      .catch((e) => e);
    check('missing ownerUid → failed-precondition (no silent user pick)', codeIs(err, 'failed-precondition'));
  }
}

async function live() {
  console.log('LIVE — real Firestore (st-signals / st-symbol-lists / st-config)');
  getFirestore(); // ensure ADC app is up
  const deps = signalReviewProdDeps();

  const ownerUid = await deps.getOwnerUid();
  check('st-config/autoPaper.ownerUid resolves', typeof ownerUid === 'string' && ownerUid.length > 0,
    String(ownerUid));
  if (!ownerUid) return;

  const queue = await handleGetSignalReviewQueue({ ...AUTH, data: {} }, deps);
  check('queue returns real list members', queue.rows.length > 0, `${queue.rows.length} rows`);
  const target = queue.rows.find((r) => r.lastDailySignalDate) ?? queue.rows[0];
  if (!target) return;

  const bundle = await handleGetSignalReviewBundle({ ...AUTH, data: { symbol: target.symbol } }, deps);
  check(`bundle for ${target.symbol} returned`, bundle.symbol === target.symbol);
  check(
    'occurrences are daily + newest-first',
    bundle.occurrences.every((o) => o.signalTimeframe === 'D') &&
      bundle.occurrences.every(
        (o, i, a) => i === 0 || a[i - 1].signalBarDate >= o.signalBarDate,
      ),
    `${bundle.occurrences.length} occurrences`,
  );
  check(
    'checked rows carry tradeId + tradeStatus',
    bundle.occurrences.every((o) => !o.checked || (o.tradeId !== undefined && o.tradeStatus !== undefined)),
  );
  const state = await deps.getReviewState();
  check(
    'stamp landed on st-config/signalReview',
    state.lastOpenedAt?.[target.symbol] === bundle.openedAt,
    JSON.stringify(state.lastOpenedAt?.[target.symbol]),
  );
}

dry()
  .then(() => (LIVE ? live() : Promise.resolve()))
  .then(() => {
    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('verify crashed:', err);
    process.exit(1);
  });
