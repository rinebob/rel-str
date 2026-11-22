/**
 * @topic #553 — Paper Trading Infra (task #1650)
 *
 * `getSignalReviewQueue` + `getSignalReviewBundle` — the pane-facing
 * read surface for the Thread #1117 signal-selection review.
 *
 * Bundle: `st-signals` occurrences for one symbol (daily only,
 * newest-first) reshaped to `SignalReviewOccurrence` and joined to
 * `source=SIGNAL` ledger trades via `signalDedupeKey`. `checked` means
 * **curation-mint membership** — the scoped semantic decided at the
 * #1649 review gate: accept-flow trades stamped
 * `canonicalOccurrenceDecisionId` carry no barDate and join as
 * `checked:false` (they were never pane-checkable anyway). The same
 * read then stamps `st-config/signalReview.lastOpenedAt[symbol]`,
 * returning the pre-stamp value as `previousOpenedAt` — the divider
 * anchor for this render.
 *
 * Queue: `st-config/autoPaper.ownerUid` resolves which user's
 * `{uid}_PRIMARY` / `{uid}_SECONDARY` list docs define the review
 * universe; each member merges `st-symbols.lastDailySignalDate` and its
 * review-state open stamp. Members with zero signals still appear —
 * the queue is driven by list membership, not occurrence existence.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db as adminDb } from '../firebase-admin-init';
import {
  AUTO_PAPER_CONFIG_DOC,
  SIGNAL_REVIEW_CONFIG_DOC,
  ST_SIGNALS_ROOT,
  ST_SYMBOLS_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  stConfigDocPath,
  type AutoPaperConfig,
  type StSymbol,
} from '../common/st-collections';
import {
  PaperTradeSource,
  type GetSignalReviewBundleRequest,
  type GetSignalReviewBundleResponse,
  type GetSignalReviewQueueRequest,
  type GetSignalReviewQueueResponse,
  type SignalReviewOccurrence,
  type SignalReviewQueueRow,
  type SignalReviewStateDoc,
  type PaperTrade,
} from '@paper-trading/contracts';
import { signalDedupeKey } from '@paper-trading/ids';
import { stSignalOccurrenceId } from '@st/ids';
import { normalizeStSignalDirection, type StSignal } from '@st/signals';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './engine/options-strategy-cors';
import { listTrades } from './repository';

const REVIEW_LIST_KEYS = ['PRIMARY', 'SECONDARY'] as const;
type ReviewListKey = (typeof REVIEW_LIST_KEYS)[number];

// ── Deps ──────────────────────────────────────────────────────────────────

export interface SignalReviewDeps {
  /** st-signals docs for the symbol (prod wiring filters timeframe 'D'). */
  listOccurrences(symbol: string): Promise<StSignal[]>;
  /** Ledger trades for the symbol (prod wiring filters source=SIGNAL) —
   *  narrowed to the fields the join reads. */
  listSignalTrades(
    symbol: string,
  ): Promise<Array<Pick<PaperTrade, 'id' | 'signalId' | 'status'>>>;
  /** st-symbol-lists/{ownerUid}_{listKey}.symbols — [] when the doc is absent. */
  listMembers(listKey: ReviewListKey, ownerUid: string): Promise<string[]>;
  /** st-symbols.lastDailySignalDate per member — absent entries omitted. */
  getSymbolSignalDates(symbols: string[]): Promise<Map<string, string>>;
  /** st-config/signalReview — absent doc → empty map. */
  getReviewState(): Promise<SignalReviewStateDoc>;
  /** st-config/autoPaper.ownerUid — null when the config/field is absent. */
  getOwnerUid(): Promise<string | null>;
  /** Merge-write lastOpenedAt[symbol] = at on the review-state doc. */
  stampOpened(symbol: string, at: string): Promise<void>;
  now(): Date;
}

// ── Bundle handler ────────────────────────────────────────────────────────

interface BundleRequestLike {
  data: GetSignalReviewBundleRequest;
  auth?: { uid: string } | null;
}

export async function handleGetSignalReviewBundle(
  request: BundleRequestLike,
  deps: SignalReviewDeps,
): Promise<GetSignalReviewBundleResponse> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be signed in to read a signal-review bundle');
  }
  const raw = request.data?.symbol;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpsError('invalid-argument', 'symbol must be a non-empty string');
  }
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    throw new HttpsError('invalid-argument', `symbol '${symbol}' is not a ticker shape`);
  }

  const [occurrences, trades, state] = await Promise.all([
    deps.listOccurrences(symbol),
    deps.listSignalTrades(symbol),
    deps.getReviewState(),
  ]);
  const previousOpenedAt = state.lastOpenedAt?.[symbol] ?? null;

  // Ledger join: signalDedupeKey → claiming trade. checked:true implies
  // tradeId present; tradeStatus follows the trade doc's status.
  const claimed = new Map<string, Pick<PaperTrade, 'id' | 'signalId' | 'status'>>();
  for (const t of trades) {
    if (t.signalId) claimed.set(t.signalId, t);
  }

  const rows: SignalReviewOccurrence[] = occurrences
    .filter((o) => o.timeframe === 'D')
    .sort((a, b) => b.barDate.localeCompare(a.barDate))
    .flatMap((o) => {
      // Legacy corpus docs persist 'LONG'/'SHORT' — normalize; a doc whose
      // direction can't be normalized can't be represented in the contract.
      const direction = normalizeStSignalDirection(o.direction);
      if (!direction) return [];
      const trade = claimed.get(signalDedupeKey(o.symbol, o.signalType, o.barDate));
      return [{
        occurrenceId: stSignalOccurrenceId(o.symbol, o.barDate, o.signalType),
        symbol: o.symbol,
        signalType: o.signalType,
        signalBarDate: o.barDate,
        signalTimeframe: o.timeframe,
        direction,
        signalStatus: o.status,
        signalIndicators: o.indicators,
        sourceRunId: o.sourceRunId,
        checked: trade !== undefined,
        ...(trade ? { tradeId: trade.id, tradeStatus: trade.status } : {}),
      }];
    });

  // Stamp last — a failed read must not consume the divider (a throw
  // above would otherwise advance lastOpenedAt past signals never
  // rendered). previousOpenedAt is still the genuinely pre-stamp value:
  // state was read before any write on this doc.
  const openedAt = deps.now().toISOString();
  try {
    await deps.stampOpened(symbol, openedAt);
  } catch (err) {
    throw new HttpsError(
      'internal',
      `review-state stamp failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { symbol, previousOpenedAt, openedAt, occurrences: rows };
}

// ── Queue handler ─────────────────────────────────────────────────────────

interface QueueRequestLike {
  data: GetSignalReviewQueueRequest;
  auth?: { uid: string } | null;
}

export async function handleGetSignalReviewQueue(
  request: QueueRequestLike,
  deps: SignalReviewDeps,
): Promise<GetSignalReviewQueueResponse> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be signed in to read the signal-review queue');
  }
  const ownerUid = await deps.getOwnerUid();
  if (!ownerUid) {
    throw new HttpsError(
      'failed-precondition',
      'st-config/autoPaper.ownerUid is unset — the review list-owner cannot be resolved; set ownerUid on the autoPaper config',
    );
  }

  const memberLists = await Promise.all(
    REVIEW_LIST_KEYS.map((key) => deps.listMembers(key, ownerUid)),
  );
  const members = [...new Set(memberLists.flat().map((s) => s.trim().toUpperCase()))];

  const [dates, state] = await Promise.all([
    deps.getSymbolSignalDates(members),
    deps.getReviewState(),
  ]);

  const rows: SignalReviewQueueRow[] = members
    .sort()
    .map((symbol) => ({
      symbol,
      ...(dates.get(symbol) ? { lastDailySignalDate: dates.get(symbol) } : {}),
      ...(state.lastOpenedAt?.[symbol] ? { lastOpenedAt: state.lastOpenedAt[symbol] } : {}),
    }));
  return { rows };
}

// ── Production wiring ─────────────────────────────────────────────────────

/** Firestore `in` query ceiling — 30 values per chunk. */
const IN_QUERY_CHUNK = 30;

export function signalReviewProdDeps(): SignalReviewDeps {
  const db = adminDb;
  return {
    listOccurrences: async (symbol) => {
      // symbol== + orderBy barDate desc rides the existing
      // (symbol ASC, barDate DESC) composite index; the handler drops
      // non-daily rows — a timeframe== predicate would force a new index.
      const snap = await db
        .collection(ST_SIGNALS_ROOT)
        .where('symbol', '==', symbol)
        .orderBy('barDate', 'desc')
        .get();
      return snap.docs.map((d) => d.data() as StSignal);
    },
    listSignalTrades: (symbol) =>
      listTrades(db, { symbol, source: PaperTradeSource.SIGNAL }),
    listMembers: async (listKey, ownerUid) => {
      const doc = await db
        .collection(ST_SYMBOL_LISTS_ROOT)
        .doc(`${ownerUid}_${listKey}`)
        .get();
      return (doc.data()?.symbols ?? []) as string[];
    },
    getSymbolSignalDates: async (symbols) => {
      const dates = new Map<string, string>();
      for (let i = 0; i < symbols.length; i += IN_QUERY_CHUNK) {
        const chunk = symbols.slice(i, i + IN_QUERY_CHUNK);
        const snap = await db
          .collection(ST_SYMBOLS_ROOT)
          .where('symbol', 'in', chunk)
          .get();
        for (const d of snap.docs) {
          const v = (d.data() as StSymbol).lastDailySignalDate;
          if (v) dates.set(d.id, v);
        }
      }
      return dates;
    },
    getReviewState: async () => {
      const doc = await db
        .doc(stConfigDocPath(SIGNAL_REVIEW_CONFIG_DOC))
        .get();
      return doc.exists
        ? (doc.data() as SignalReviewStateDoc)
        : { lastOpenedAt: {} };
    },
    getOwnerUid: async () => {
      const doc = await db.doc(stConfigDocPath(AUTO_PAPER_CONFIG_DOC)).get();
      return (doc.data() as AutoPaperConfig | undefined)?.ownerUid ?? null;
    },
    stampOpened: async (symbol, at) => {
      await db
        .doc(stConfigDocPath(SIGNAL_REVIEW_CONFIG_DOC))
        .set({ lastOpenedAt: { [symbol]: at } }, { merge: true });
    },
    now: () => new Date(),
  };
}

// ── onCall wrappers ───────────────────────────────────────────────────────

export const getSignalReviewBundle = onCall<
  GetSignalReviewBundleRequest,
  Promise<GetSignalReviewBundleResponse>
>(
  { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 60 },
  (request) =>
    handleGetSignalReviewBundle(request, signalReviewProdDeps()).catch((err) => {
      // Sibling convention: non-HttpsError escapes re-mapped to internal.
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }),
);

export const getSignalReviewQueue = onCall<
  GetSignalReviewQueueRequest,
  Promise<GetSignalReviewQueueResponse>
>(
  { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS, memory: '256MiB', timeoutSeconds: 60 },
  (request) =>
    handleGetSignalReviewQueue(request, signalReviewProdDeps()).catch((err) => {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
    }),
);
