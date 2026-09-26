/**
 * @topic #553 — Paper Trading Infra (task #561)
 *
 * Firestore repository for the `paper-trading/{anchor}/items/{id}` layout.
 * CRUD for all six record kinds plus the single-write embedded mutations the
 * passes use (`appendMark`, `appendFill`, `updateVariantRun`). All functions
 * take `db` as the first parameter so unit tests can inject a fake.
 */

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { buildAccountId } from '@paper-trading/ids';
import {
  isPaperAccount,
  isPaperCohort,
  isPaperStats,
  isPaperStrategyInstance,
  isPaperTrade,
  isRawQuoteDoc,
  PaperTradingKind,
  type ListPaperTradesRequest,
  type PaperAccount,
  type PaperCohort,
  type PaperFill,
  type PaperMark,
  type PaperStats,
  type PaperStrategyInstance,
  type PaperTrade,
  type PaperTradingDoc,
  type RawQuoteDoc,
  type VariantRun,
} from '@paper-trading/contracts';
import { paperDocRef, paperItemsRef } from './collections';
import type { LedgerDeps, LedgerTxn } from './ledger';

// ── Generic get/set per kind ────────────────────────────────────────────────

async function getItem<T extends PaperTradingDoc>(
  db: Firestore,
  kind: PaperTradingKind,
  id: string,
  guard: (d: PaperTradingDoc) => d is T,
): Promise<T | null> {
  const snap = await paperDocRef(db, kind, id).get();
  if (!snap.exists) return null;
  const doc = { id: snap.id, ...(snap.data() as object) } as PaperTradingDoc;
  return guard(doc) ? doc : null;
}

async function setItem<T extends PaperTradingDoc>(
  db: Firestore,
  kind: PaperTradingKind,
  doc: T,
): Promise<void> {
  const { id: _id, ...data } = doc;
  await paperDocRef(db, kind, doc.id).set(data);
}

async function listItems<T extends PaperTradingDoc>(
  db: Firestore,
  kind: PaperTradingKind,
  guard: (d: PaperTradingDoc) => d is T,
): Promise<T[]> {
  const snap = await paperItemsRef(db, kind).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as PaperTradingDoc)
    .filter((d): d is T => guard(d));
}

// ── Accounts ────────────────────────────────────────────────────────────────

export function getAccount(db: Firestore, accountId: string): Promise<PaperAccount | null> {
  return getItem(db, PaperTradingKind.ACCOUNT, accountId, isPaperAccount);
}

export function setAccount(db: Firestore, account: PaperAccount): Promise<void> {
  return setItem(db, PaperTradingKind.ACCOUNT, account);
}

// ── Trades ──────────────────────────────────────────────────────────────────

export function getTrade(db: Firestore, tradeId: string): Promise<PaperTrade | null> {
  return getItem(db, PaperTradingKind.TRADE, tradeId, isPaperTrade);
}

export function setTrade(db: Firestore, trade: PaperTrade): Promise<void> {
  return setItem(db, PaperTradingKind.TRADE, trade);
}

/** All filters in the request are AND-combined; omitted fields match all. */
export async function listTrades(
  db: Firestore,
  filters: ListPaperTradesRequest = {},
): Promise<PaperTrade[]> {
  let query = paperItemsRef(db, PaperTradingKind.TRADE) as FirebaseFirestore.Query;
  const eq = (field: string, value: string) => {
    query = query.where(field, '==', value);
  };
  if (filters.status) eq('status', filters.status);
  if (filters.source) eq('source', filters.source);
  if (filters.strategyInstanceId) eq('strategyInstanceId', filters.strategyInstanceId);
  if (filters.cohortId) eq('cohortId', filters.cohortId);
  if (filters.signalId) eq('signalId', filters.signalId);
  if (filters.symbol) eq('symbol', filters.symbol);
  if (filters.expression) eq('expression', filters.expression);
  if (filters.variantKey) {
    query = query.where('variantKeys', 'array-contains', filters.variantKey);
  }
  const snap = await query.get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as PaperTradingDoc)
    .filter(isPaperTrade);
}

// ── Cohorts / instances / stats / raw quotes ────────────────────────────────

export function getCohort(db: Firestore, cohortId: string): Promise<PaperCohort | null> {
  return getItem(db, PaperTradingKind.COHORT, cohortId, isPaperCohort);
}

export function setCohort(db: Firestore, cohort: PaperCohort): Promise<void> {
  return setItem(db, PaperTradingKind.COHORT, cohort);
}

export function getInstance(
  db: Firestore,
  instanceId: string,
): Promise<PaperStrategyInstance | null> {
  return getItem(db, PaperTradingKind.INSTANCE, instanceId, isPaperStrategyInstance);
}

export function setInstance(db: Firestore, instance: PaperStrategyInstance): Promise<void> {
  return setItem(db, PaperTradingKind.INSTANCE, instance);
}

export function getStats(db: Firestore, statsId: string): Promise<PaperStats | null> {
  return getItem(db, PaperTradingKind.STATS, statsId, isPaperStats);
}

export function setStats(db: Firestore, stats: PaperStats): Promise<void> {
  return setItem(db, PaperTradingKind.STATS, stats);
}

export function getRawQuote(db: Firestore, quoteId: string): Promise<RawQuoteDoc | null> {
  return getItem(db, PaperTradingKind.RAW_QUOTE, quoteId, isRawQuoteDoc);
}

export function setRawQuote(db: Firestore, rawQuote: RawQuoteDoc): Promise<void> {
  return setItem(db, PaperTradingKind.RAW_QUOTE, rawQuote);
}

export function listRawQuotes(db: Firestore): Promise<RawQuoteDoc[]> {
  return listItems(db, PaperTradingKind.RAW_QUOTE, isRawQuoteDoc);
}

// ── Single-write embedded mutations ─────────────────────────────────────────

/** One doc update: `marks.{date}` + `updatedAt`. */
export async function appendMark(
  db: Firestore,
  tradeId: string,
  date: string,
  mark: PaperMark,
  now: string,
): Promise<void> {
  await paperDocRef(db, PaperTradingKind.TRADE, tradeId).update({
    [`marks.${date}`]: mark,
    updatedAt: now,
  });
}

/**
 * Appends a fill inside a transaction (read-modify-write of the `fills`
 * array) so concurrent appends cannot drop each other. One commit per call.
 */
export async function appendFill(
  db: Firestore,
  tradeId: string,
  fill: PaperFill,
  now: string,
): Promise<void> {
  const ref = paperDocRef(db, PaperTradingKind.TRADE, tradeId);
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new Error(`paper trade ${tradeId} not found`);
    }
    const fills = [...((snap.data() as PaperTrade).fills ?? []), fill];
    txn.update(ref, { fills, updatedAt: now });
  });
}

/**
 * Replaces the `VariantRun` matching `run.variantKey` inside the embedded
 * `variantRuns` array (transactional read-modify-write — Firestore cannot
 * address array elements by index).
 */
export async function updateVariantRun(
  db: Firestore,
  tradeId: string,
  run: VariantRun,
  now: string,
): Promise<void> {
  const ref = paperDocRef(db, PaperTradingKind.TRADE, tradeId);
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      throw new Error(`paper trade ${tradeId} not found`);
    }
    const trade = snap.data() as PaperTrade;
    const idx = trade.variantRuns.findIndex((r) => r.variantKey === run.variantKey);
    if (idx === -1) {
      throw new Error(`variant run ${run.variantKey} not found on ${tradeId}`);
    }
    // EXITED is terminal: a stale read must never resurrect a finalized run
    // (eval-pass snapshots trades, then settlement may finalize the run
    // before eval's write lands — the txn re-read here is the guard).
    if (trade.variantRuns[idx].state === 'EXITED') {
      return;
    }
    const variantRuns = [...trade.variantRuns];
    variantRuns[idx] = run;
    // keep the denormalized key list in sync (needed for array-contains queries)
    const variantKeys = [...new Set(variantRuns.map((r) => r.variantKey))];
    txn.update(ref, { variantRuns, variantKeys, updatedAt: now });
  });
}

// ── Trade-id collision ──────────────────────────────────────────────────────

/**
 * Returns `baseId` if free, else `baseId-{timeSuffix}`; if that is also
 * taken, `fallbackSuffix` is tried. Check-then-write is non-atomic (TOCTOU),
 * so callers must be serialized — the ledger's `applyEntryFill` re-checks
 * existence inside its transaction and throws on a stale id, so a lost race
 * fails loudly rather than silently overwriting.
 */
export async function resolveTradeId(
  db: Firestore,
  baseId: string,
  timeSuffix: string,
  fallbackSuffix?: string,
): Promise<string> {
  const ref = (id: string) => paperDocRef(db, PaperTradingKind.TRADE, id);
  if (!(await ref(baseId).get()).exists) {
    return baseId;
  }
  for (const suffix of [timeSuffix, fallbackSuffix].filter((s): s is string => !!s)) {
    const id = `${baseId}-${suffix}`;
    if (!(await ref(id).get()).exists) {
      return id;
    }
  }
  throw new Error(`trade id collision for ${baseId} (${timeSuffix}/${fallbackSuffix})`);
}

// ── Firestore-backed ledger deps ────────────────────────────────────────────

/**
 * Wire `ledger.applyFill` to Firestore. The whole apply runs inside one
 * `runTransaction`: account/trade reads (which include the entry-id
 * collision check) and both doc writes commit atomically — a concurrent
 * mark/fill touching the same docs forces a retry instead of a silent
 * overwrite.
 */
export function ledgerDeps(db: Firestore): LedgerDeps {
  return {
    transact: (work) =>
      db.runTransaction(async (txn: Transaction) => {
        const getDoc = async <T extends PaperTradingDoc>(
          kind: PaperTradingKind,
          id: string,
          guard: (d: PaperTradingDoc) => d is T,
        ): Promise<T | null> => {
          const snap = await txn.get(paperDocRef(db, kind, id));
          if (!snap.exists) return null;
          const doc = { id: snap.id, ...(snap.data() as object) } as PaperTradingDoc;
          return guard(doc) ? doc : null;
        };

        const ctx: LedgerTxn = {
          getAccount: (userId) =>
            getDoc(PaperTradingKind.ACCOUNT, buildAccountId(userId), isPaperAccount),
          getTrade: (tradeId) => getDoc(PaperTradingKind.TRADE, tradeId, isPaperTrade),
          write: (plan) => {
            const accountRef = paperDocRef(db, PaperTradingKind.ACCOUNT, plan.accountId);
            const tradeRef = paperDocRef(db, PaperTradingKind.TRADE, plan.tradeId);
            const { id: _a, ...accountData } = plan.account;
            const { id: _t, ...tradeData } = plan.trade;
            txn.set(accountRef, accountData);
            txn.set(tradeRef, tradeData);
          },
        };
        return work(ctx);
      }),
  };
}

