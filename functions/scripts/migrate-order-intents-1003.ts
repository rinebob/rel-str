/**
 * One-shot migration: legacy `savant-trader/data/order-intents` →
 * canonical `st-order-tickets` (task #1003, IMPL-BE §order-intents).
 *
 * Per legacy doc:
 *   - map via `legacyIntentToTicket` (shared with the soak mirror —
 *     same shape either way): source→origin.type, status:'paper'→
 *     mode:'paper', refId/accountNumber/userId/lineage/tracking preserved
 *   - paper tickets settle their state from the linked trade
 *     (`trade.ticket.refId` → `paperTradeStateSettle`) per the #999
 *     mapper contract: open → stays 'submitted', closed → terminal
 *   - write `st-order-tickets/{liv|pap}_{intentId}` with set(merge) —
 *     rerunnable; `suppressTerminalRegression` guards a settled doc
 *     against a rerun's non-terminal re-map
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-order-intents-1003.ts [--id <intentId>]   # dry-run
 *   npx tsx scripts/migrate-order-intents-1003.ts --apply [--id ...]  # write
 *
 *   --apply   perform writes (default is a dry-run — same convention as
 *             migrate-options-strategy-to-paper.ts)
 *   --id      migrate a single legacy intent doc
 *
 * Requires Application Default Credentials (writes st-order-tickets).
 * Run OUTSIDE live-run windows — the orderIntentsMirror trigger keeps
 * canonical docs current for legacy writes, but a one-shot batch
 * shouldn't race the noon fill pass.
 */
import { db } from '../src/firebase-admin-init';
import {
  ST_ORDER_INTENTS_COLLECTION,
  ST_ORDER_TICKETS_ROOT,
} from '../src/common/st-collections';
import { EQUITY_TRADE_DESC, PaperTradingKind, paperTradingItemsPath } from '@paper-trading/ids';
import { stTicketId } from '@st/ids';
import {
  deepEqual,
  legacyIntentToTicket,
  paperTradeStateSettle,
  suppressTerminalRegression,
} from '../src/order-tickets/legacy-order-intents';
import type { StOrderTicket, StTicketFillSummary, StTicketState } from '@st/order-tickets';
import type { PaperTrade } from '@paper-trading/contracts';

const BATCH_LIMIT = 400;

interface MigrateStats {
  created: number;
  updated: number;
  unchanged: number;
  malformed: number;
  failed: number;
  paperSettled: number;
  /** Opposite-prefix canonical docs removed after a legacy mode flip. */
  orphans: number;
}

/** refId → linked-trade settle data for paper tickets (one scan per run).
 *  The trade's entry fill is the order's fill — carried through so a
 *  settled 'filled' ticket satisfies the canonical audit's fillSummary. */
interface TradeSettle {
  status: string;
  entryFill?: { price: number; quantity: number; date?: string };
}

interface TradeRefIndex {
  /** refId → settle from the equity (order-execution) trade only. */
  byRef: Map<string, TradeSettle>;
  /** refIds with trades but no equity execution child. */
  nonEqOnly: Set<string>;
}

async function loadTradeRefIndex(
  firestore: FirebaseFirestore.Firestore,
): Promise<TradeRefIndex> {
  const snap = await firestore.collection(paperTradingItemsPath(PaperTradingKind.TRADE)).get();
  const byRef = new Map<string, TradeSettle>();
  const seen = new Set<string>();
  for (const doc of snap.docs) {
    // Stored docs spread dims flat — `expression`/`ticket` are top-level
    // PaperTrade members (`dims` only exists on writer input params).
    const t = doc.data() as Pick<PaperTrade, 'expression' | 'ticket' | 'status' | 'fills'>;
    const refId = t.ticket?.refId;
    if (!refId || typeof t.status !== 'string') continue;
    seen.add(refId);
    // Every cohort trade shares the ticket's refId — only the equity trade
    // is the order's execution child; expression trades are downstream
    // intents (PENDING is not the order's state). Without an EQ trade the
    // intent's settle is indeterminate — flag it instead of guessing.
    if (t.expression !== EQUITY_TRADE_DESC) continue;
    const entry = (t.fills ?? []).find((f) => f.role === 'entry');
    byRef.set(refId, {
      status: t.status,
      entryFill: entry ? { price: entry.price, quantity: entry.quantity, date: entry.date } : undefined,
    });
  }
  const nonEqOnly = new Set([...seen].filter((r) => !byRef.has(r)));
  return { byRef, nonEqOnly };
}

/** Field-level diff over the mapped doc keys — lets reruns count true
 *  no-ops as `unchanged` instead of rewriting identical docs. */
function mappedDocEquals(
  mapped: Record<string, unknown>,
  existing: FirebaseFirestore.DocumentData,
): boolean {
  return Object.entries(mapped).every(([k, v]) => deepEqual(existing[k], v));
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--apply');
  const idArg = process.argv.findIndex((a) => a === '--id');
  const onlyId = idArg >= 0 ? process.argv[idArg + 1] : undefined;
  if (idArg >= 0 && (!onlyId || onlyId.startsWith('--'))) {
    console.error('--id requires a value');
    process.exit(1);
  }

  const intentsCol = db.collection(ST_ORDER_INTENTS_COLLECTION);
  const ticketsCol = db.collection(ST_ORDER_TICKETS_ROOT);

  const intentSnap = onlyId
    ? { docs: [await intentsCol.doc(onlyId).get()].filter((d) => d.exists) }
    : await intentsCol.get();

  const refIndex = await loadTradeRefIndex(db);
  console.log(
    `order-intents migration — ${intentSnap.docs.length} intent doc(s), ` +
    `${refIndex.byRef.size} trade refId link(s)${dryRun ? ' [DRY RUN]' : ''}\n`,
  );

  const stats: MigrateStats = {
    created: 0, updated: 0, unchanged: 0, malformed: 0, failed: 0, paperSettled: 0,
    orphans: 0,
  };
  const malformedLines: string[] = [];
  const warningLines: string[] = [];

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };

  for (const doc of intentSnap.docs) {
    try {
      const legacy = doc.data() as Record<string, unknown>;

      // Paper settle: state + fill come from the linked trade when one exists.
      let settledState: StTicketState | undefined;
      let settledFill: StTicketFillSummary | undefined;
      const refId = typeof legacy.refId === 'string' ? legacy.refId : undefined;
      if (legacy.status === 'paper' && refId) {
        const settle = refIndex.byRef.get(refId);
        settledState = settle ? paperTradeStateSettle(settle.status) : undefined;
        if (settledState === 'filled' && settle?.entryFill) {
          // Fill exists → carry it even when the trade's fill lacks a date
          // (mapper doctrine: filledAt falls back to the doc's clock).
          const fillDate = settle.entryFill.date
            ?? (typeof legacy.updatedAt === 'string' ? legacy.updatedAt : undefined)
            ?? (typeof legacy.createdAt === 'string' ? legacy.createdAt : undefined);
          if (fillDate) {
            settledFill = {
              averagePrice: settle.entryFill.price,
              filledQty: settle.entryFill.quantity,
              filledAt: fillDate,
            };
          }
        }
        if (settle) stats.paperSettled++;
        else if (refIndex.nonEqOnly.has(refId)) {
          warningLines.push(`${doc.id}: linked trades exist but no EQ execution child — state stays 'submitted'`);
        } else {
          warningLines.push(`${doc.id}: paper intent has no linked trade — state stays 'submitted'`);
        }
      }

      const mapped = legacyIntentToTicket(doc.id, legacy, { settledState, settledFill });
      for (const w of mapped.warnings ?? []) warningLines.push(`${doc.id}: ${w}`);
      if (!mapped.ticket) {
        stats.malformed++;
        malformedLines.push(`${doc.id}: ${(mapped.malformed ?? []).join('; ')}`);
        continue;
      }
      const ticket = mapped.ticket;

      const existingSnap = await ticketsCol.doc(ticket.id).get();
      const existing = existingSnap.data() as StOrderTicket | undefined;
      const writeDoc = suppressTerminalRegression(existing?.state, { ...ticket });
      // Mirror may have stamped a newer updatedAt than the legacy doc
      // carries — never regress the canonical record's clock (same rule
      // as the mirror's transaction).
      if (
        typeof existing?.updatedAt === 'string'
        && typeof writeDoc.updatedAt === 'string'
        && existing.updatedAt > writeDoc.updatedAt
      ) {
        writeDoc.updatedAt = existing.updatedAt;
      }

      let writeDocNeeded: boolean;
      if (!existingSnap.exists) {
        stats.created++;
        writeDocNeeded = true;
      } else if (mappedDocEquals(writeDoc, existing!)) {
        stats.unchanged++;
        writeDocNeeded = false;
      } else {
        stats.updated++;
        writeDocNeeded = true;
      }
      // Opposite-prefix orphan: if this intent was ever mirrored/migrated
      // under the other mode (a status flip re-mints the prefix), drop it.
      const otherId = ticket.mode === 'live'
        ? stTicketId('paper', doc.id)
        : stTicketId('live', doc.id);
      const hasOther = (await ticketsCol.doc(otherId).get()).exists;
      if (hasOther) {
        stats.orphans++;
        warningLines.push(`${doc.id}: ${dryRun ? 'would remove' : 'removed'} opposite-prefix orphan ${otherId}`);
      }
      if (!dryRun) {
        if (writeDocNeeded) {
          batch.set(ticketsCol.doc(ticket.id), writeDoc, { merge: true });
          pending++;
        }
        if (hasOther) {
          batch.delete(ticketsCol.doc(otherId));
          pending++;
        }
        if (pending >= BATCH_LIMIT) await flush();
      }
    } catch (err) {
      stats.failed++;
      malformedLines.push(
        `${doc.id}: FAILED — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  await flush();

  console.log(
    `TOTAL — ${dryRun ? 'would create' : 'created'}=${stats.created} ` +
    `updated=${stats.updated} unchanged=${stats.unchanged} ` +
    `orphans=${stats.orphans} ` +
    `paperSettled=${stats.paperSettled} malformed=${stats.malformed} failed=${stats.failed}`,
  );
  for (const w of warningLines.slice(0, 50)) console.log(`  WARN ${w}`);
  for (const m of malformedLines.slice(0, 50)) console.log(`  MALFORMED ${m}`);
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
