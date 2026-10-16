/**
 * @topic #984 — ST Firestore Reorg (task #1000)
 *
 * SignalDateWriter
 *
 * Encapsulates all Firestore writes to the per-symbol run-ids and signal-history
 * subcollections, the per-symbol gate-date fields, and — during the #984
 * dual-write window — the flat `st-signals` occurrence docs that supersede
 * both legacy paths. Writes for different bar dates and doc types run in
 * parallel; writes to the same doc are kept as a single batched update.
 */
import { logger as defaultLogger } from 'firebase-functions/v2';
import { db as defaultDb, FieldValue } from '../firebase-admin-init';
import {
  ST_SYMBOLS_COLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_SIGNAL_HISTORY_SUBCOLLECTION,
  ST_SIGNALS_ROOT,
} from '../common/st-collections';
import { stSignalOccurrenceId } from '@st/ids';
import { normalizeStSignalDirection } from '@st/signals';
import {
  StRunIdDoc,
  StSignalHistoryDoc,
  StSignalEntry,
} from './signals';
import { StTriggeredBy } from '../common/st-runs';

/** Minimal FieldValue surface the writer uses — injectable for tests. */
export interface SignalDateWriterFieldValue {
  serverTimestamp(): unknown;
  arrayUnion(...items: unknown[]): unknown;
}

/** Minimal logger surface the writer uses — injectable for tests. */
export interface SignalDateWriterLogger {
  error(message: string, data?: Record<string, unknown>): void;
}

/** Optional dependency overrides — tests inject a fake db + sentinel FieldValue. */
export interface SignalDateWriterDeps {
  db?: FirebaseFirestore.Firestore;
  fieldValue?: SignalDateWriterFieldValue;
  logger?: SignalDateWriterLogger;
}

export class SignalDateWriter {
  private readonly symbol: string;
  private readonly symbolRef: FirebaseFirestore.DocumentReference;
  private readonly db: FirebaseFirestore.Firestore;
  private readonly fv: SignalDateWriterFieldValue;
  private readonly log: SignalDateWriterLogger;

  /**
   * Create a writer bound to a specific symbol.
   * @param symbol Symbol ticker to which all writes are scoped — normalized
   *   to uppercase once so legacy subcollection paths and canonical
   *   st-signals doc ids can't diverge on case.
   * @param deps Optional db/FieldValue/logger overrides (tests inject fakes).
   */
  constructor(symbol: string, deps: SignalDateWriterDeps = {}) {
    this.symbol = symbol.toUpperCase();
    this.db = deps.db ?? defaultDb;
    this.fv = deps.fieldValue ?? FieldValue;
    this.log = deps.logger ?? defaultLogger;
    this.symbolRef = this.db.collection(ST_SYMBOLS_COLLECTION).doc(this.symbol);
  }

  /**
   * Persist all signal entries for a single bar date atomically:
   *   - merge-write the run-ids doc
   *   - merge-write the signal-history doc (nightly runs only)
   *   - merge-update the symbol gate dates
   *   - upsert the canonical st-signals occurrence docs (#984 dual-write)
   *
   * All writes are queued in one Firestore batch and committed together so
   * successful writes stay consistent. The st-signals path is fail-soft
   * during the dual-write window: an unusable entry (malformed id segments)
   * or a failed existence read is logged and skipped, and a wholesale
   * failure is logged without aborting the legacy commit — run-ids and
   * signal-history remain the source of truth until reader cutover (#1013).
   *
   * Returns the number of entries persisted.
   */
  async persistBarDate(
    runId: string,
    runStartedAt: string,
    marketDate: string,
    entries: StSignalEntry[],
    triggeredBy?: StTriggeredBy
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const batch = this.db.batch();

    this.writeRunIdDoc(batch, runId, runStartedAt, marketDate, entries);
    if (triggeredBy === 'nightly') {
      this.writeSignalHistoryDoc(batch, runId, entries);
    }
    this.updateGateDates(batch, entries);
    try {
      await this.writeStSignalDocs(batch, runId, marketDate, entries);
    } catch (err) {
      this.log.error('st-signals dual-write failed — committing legacy writes only', {
        symbol: this.symbol,
        runId,
        marketDate,
        error: String(err),
      });
    }

    await batch.commit();
    return entries.length;
  }

  /**
   * Write signals to run-ids/{runId} — the run-centric real-time path.
   * One doc per run per symbol; all signals for this run stored as a map keyed by signalType.
   */
  private writeRunIdDoc(
    batch: FirebaseFirestore.WriteBatch,
    runId: string,
    runStartedAt: string,
    marketDate: string,
    entries: StSignalEntry[]
  ): void {
    if (entries.length === 0) return;

    const docRef = this.symbolRef.collection(ST_RUN_IDS_SUBCOLLECTION).doc(runId);
    const signalsUpdate: Record<string, any> = {};
    for (const entry of entries) {
      signalsUpdate[`signals.${entry.signalType}`] = entry;
    }

    batch.set(
      docRef,
      {
        symbol: this.symbol,
        runId,
        marketDate,
        startedAt: runStartedAt,
        updatedAt: this.fv.serverTimestamp(),
        ...signalsUpdate,
      } as StRunIdDoc,
      { merge: true }
    );
  }

  /**
   * Write canonical EOD signal history to signal-history/{date}.
   * Called only for nightly runs. Groups entries by barDate and writes one doc per date.
   * Each signal entry is stored with a sourceRunId for auditability.
   */
  private writeSignalHistoryDoc(
    batch: FirebaseFirestore.WriteBatch,
    runId: string,
    entries: StSignalEntry[]
  ): void {
    if (entries.length === 0) return;

    const byBarDate = new Map<string, StSignalEntry[]>();
    for (const entry of entries) {
      const list = byBarDate.get(entry.barDate) ?? [];
      list.push(entry);
      byBarDate.set(entry.barDate, list);
    }

    for (const [barDate, dateEntries] of byBarDate) {
      const docRef = this.symbolRef.collection(ST_SIGNAL_HISTORY_SUBCOLLECTION).doc(barDate);
      const signalsUpdate: Record<string, any> = {};
      for (const entry of dateEntries) {
        signalsUpdate[`signals.${entry.signalType}`] = { ...entry, sourceRunId: runId };
      }
      batch.set(
        docRef,
        {
          symbol: this.symbol,
          date: barDate,
          updatedAt: this.fv.serverTimestamp(),
          canonicalizedAt: this.fv.serverTimestamp(),
          ...signalsUpdate,
        } as StSignalHistoryDoc,
        { merge: true }
      );
    }
  }

  /**
   * Upsert canonical st-signals occurrence docs — one doc per
   * {symbol, barDate, signalType}, shared by intraday, post, and nightly
   * rediscovery (#984 dual-write).
   *
   * Always-written: identity + payload fields (direction normalized to
   * TradeSide), `status` (already barStatus-resolved upstream), `runIds`
   * arrayUnion, `updatedAt`. Create-only: `marketDate`, `sourceRunId`,
   * `ticketIds`/`positionGroupIds` (initialized empty for later
   * arrayUnion), `createdAt` — a merge write can't express set-if-absent,
   * so each ref is read once up front; a nightly rerun never clobbers the
   * first-detection provenance. Fail-soft: per-entry failures are logged
   * and skipped so the dual-write can't regress the legacy paths.
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
      if (data) batch.set(data.docRef, data.fields, { merge: true });
    }));
  }

  /**
   * Read the current occurrence doc and assemble its merge payload.
   * Returns null when the entry is unusable (malformed id segments) or the
   * existence read fails — the caller logs and skips that entry so one bad
   * signal can't drop its siblings.
   */
  private async buildStSignalData(
    col: FirebaseFirestore.CollectionReference,
    runId: string,
    marketDate: string,
    entry: StSignalEntry
  ): Promise<{ docRef: FirebaseFirestore.DocumentReference; fields: Record<string, unknown> } | null> {
    let docRef: FirebaseFirestore.DocumentReference;
    let snap: FirebaseFirestore.DocumentSnapshot;
    try {
      docRef = col.doc(stSignalOccurrenceId(this.symbol, entry.barDate, entry.signalType));
      snap = await docRef.get();
    } catch (err) {
      this.log.error('st-signals entry skipped — unwritable occurrence', {
        symbol: this.symbol,
        runId,
        barDate: entry.barDate,
        signalType: entry.signalType,
        error: String(err),
      });
      return null;
    }
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

