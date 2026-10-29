/**
 * @topic #984 — ST Firestore Reorg (tasks #1000/#1019)
 *
 * SignalDateWriter
 *
 * Encapsulates all Firestore writes for detected signals: the canonical
 * `st-signals` occurrence docs (sole signal record since #1019 retired the
 * legacy run-ids/signal-history subcollection writes) and the per-symbol
 * gate-date fields on `st-symbols`. Writes for different bar dates run in
 * parallel; writes to the same doc are kept as a single batched update.
 */
import { db as defaultDb, FieldValue } from '../firebase-admin-init';
import {
  ST_SYMBOLS_ROOT,
  ST_SIGNALS_ROOT,
} from '../common/st-collections';
import { stSignalOccurrenceId } from '@st/ids';
import { normalizeStSignalDirection } from '@st/signals';
import { StSignalEntry } from './signals';

/** Minimal FieldValue surface the writer uses — injectable for tests. */
export interface SignalDateWriterFieldValue {
  serverTimestamp(): unknown;
  arrayUnion(...items: unknown[]): unknown;
}

/** Optional dependency overrides — tests inject a fake db + sentinel FieldValue. */
export interface SignalDateWriterDeps {
  db?: FirebaseFirestore.Firestore;
  fieldValue?: SignalDateWriterFieldValue;
}

export class SignalDateWriter {
  private readonly symbol: string;
  private readonly symbolRef: FirebaseFirestore.DocumentReference;
  private readonly db: FirebaseFirestore.Firestore;
  private readonly fv: SignalDateWriterFieldValue;

  /**
   * Create a writer bound to a specific symbol.
   * @param symbol Symbol ticker to which all writes are scoped — normalized
   *   to uppercase once so st-symbols doc paths and canonical
   *   st-signals doc ids can't diverge on case.
   * @param deps Optional db/FieldValue overrides (tests inject fakes).
   */
  constructor(symbol: string, deps: SignalDateWriterDeps = {}) {
    this.symbol = symbol.toUpperCase();
    this.db = deps.db ?? defaultDb;
    this.fv = deps.fieldValue ?? FieldValue;
    this.symbolRef = this.db.collection(ST_SYMBOLS_ROOT).doc(this.symbol);
  }

  /**
   * Persist all signal entries for a single bar date atomically:
   *   - upsert the canonical st-signals occurrence docs
   *   - merge-update the symbol gate dates
   *
   * All writes are queued in one Firestore batch and committed together so
   * successful writes stay consistent. Since #1019 st-signals is the sole
   * signal record — the write is fail-HARD: any error propagates and the
   * batch is never committed, so a bad entry can never produce a symbol
   * with a gate date but no signal doc.
   *
   * Returns the number of entries persisted.
   */
  async persistBarDate(
    runId: string,
    marketDate: string,
    entries: StSignalEntry[]
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const batch = this.db.batch();

    this.updateGateDates(batch, entries);
    await this.writeStSignalDocs(batch, runId, marketDate, entries);

    await batch.commit();
    return entries.length;
  }

  /**
   * Upsert canonical st-signals occurrence docs — one doc per
   * {symbol, barDate, signalType}, shared by intraday, post, and nightly
   * rediscovery (#984).
   *
   * Always-written: identity + payload fields (direction normalized to
   * TradeSide), `status` (already barStatus-resolved upstream), `runIds`
   * arrayUnion, `updatedAt`. Create-only: `marketDate`, `sourceRunId`,
   * `ticketIds`/`positionGroupIds` (initialized empty for later
   * arrayUnion), `createdAt` — a merge write can't express set-if-absent,
   * so each ref is read once up front; a nightly rerun never clobbers the
   * first-detection provenance.
   *
   * Check-then-write is non-atomic (TOCTOU): two runs racing the same
   * occurrence could both take the create branch, and the later commit's
   * marketDate/sourceRunId wins. Callers are effectively serialized per
   * symbol (one run pipeline, disjoint barDate groups per parallel call)
   * — a transaction isn't warranted at this concurrency level.
   */
  private async writeStSignalDocs(
    batch: FirebaseFirestore.WriteBatch,
    runId: string,
    marketDate: string,
    entries: StSignalEntry[]
  ): Promise<void> {
    if (entries.length === 0) return;
    const col = this.db.collection(ST_SIGNALS_ROOT);
    await Promise.all(entries.map(async (entry) => {
      const data = await this.buildStSignalData(col, runId, marketDate, entry);
      batch.set(data.docRef, data.fields, { merge: true });
    }));
  }

  /**
   * Read the current occurrence doc and assemble its merge payload.
   * Throws on malformed id segments or a failed existence read — st-signals
   * is the sole signal record, so an unwritable entry must fail the batch
   * rather than be silently dropped.
   */
  private async buildStSignalData(
    col: FirebaseFirestore.CollectionReference,
    runId: string,
    marketDate: string,
    entry: StSignalEntry
  ): Promise<{ docRef: FirebaseFirestore.DocumentReference; fields: Record<string, unknown> }> {
    const docRef = col.doc(stSignalOccurrenceId(this.symbol, entry.barDate, entry.signalType));
    const snap = await docRef.get();
    const fields: Record<string, unknown> = {
      symbol: this.symbol,
      signalType: entry.signalType,
      barDate: entry.barDate,
      direction: normalizeStSignalDirection(entry.direction),
      timeframe: entry.timeframe,
      indicators: entry.indicators ?? {},
      status: entry.status,
      runIds: this.fv.arrayUnion(runId),
      updatedAt: this.fv.serverTimestamp(),
    };
    if (!snap.exists) {
      Object.assign(fields, {
        marketDate,
        sourceRunId: runId,
        ticketIds: [],
        positionGroupIds: [],
        createdAt: this.fv.serverTimestamp(),
      });
    }
    return { docRef, fields };
  }

  /**
   * Update the symbol doc's last signal date/direction fields based on the
   * highest-priority entries written for this bar date.
   */
  private updateGateDates(batch: FirebaseFirestore.WriteBatch, entries: StSignalEntry[]): void {
    const updates: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.timeframe === 'W') {
        updates['lastWeeklySignalDate'] = entry.barDate;
        updates['lastWeeklySignalDirection'] = entry.direction;
      } else {
        updates['lastDailySignalDate'] = entry.barDate;
        updates['lastDailySignalDirection'] = entry.direction;
      }
    }
    if (Object.keys(updates).length === 0) return;
    batch.set(this.symbolRef, updates, { merge: true });
  }
}
