/**
 * SignalDateWriter
 *
 * Encapsulates all Firestore writes to the per-symbol run-ids and signal-history
 * subcollections, plus the per-symbol gate-date fields. Writes for different bar dates
 * and doc types run in parallel; writes to the same doc are kept as a single batched update.
 */
import { db, FieldValue } from '../firebase-admin-init';
import {
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_RUN_IDS_SUBCOLLECTION,
  RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION,
} from '../common/rh-agent-collections';
import {
  RhAgentRunIdDoc,
  RhAgentSignalHistoryDoc,
  RhAgentSignalEntry,
} from './rh-agent-signals';
import { RhAgentTriggeredBy } from '../common/rh-agent-runs';

export class SignalDateWriter {
  private readonly symbolRef: FirebaseFirestore.DocumentReference;

  /**
   * Create a writer bound to a specific symbol.
   * @param symbol Symbol ticker to which all writes are scoped.
   */
  constructor(private readonly symbol: string) {
    this.symbolRef = db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol);
  }

  /**
   * Persist all signal entries for a single bar date atomically:
   *   - merge-write the run-ids doc
   *   - merge-write the signal-history doc (nightly runs only)
   *   - merge-update the symbol gate dates
   *
   * All writes are queued in one Firestore batch and committed together so the
   * run-id, signal-history, and gate-date state stay consistent.
   *
   * Returns the number of entries persisted.
   */
  async persistBarDate(
    runId: string,
    runStartedAt: string,
    marketDate: string,
    entries: RhAgentSignalEntry[],
    _intraday: boolean,
    triggeredBy?: RhAgentTriggeredBy
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const batch = db.batch();

    this.writeRunIdDoc(batch, runId, runStartedAt, marketDate, entries);
    if (triggeredBy === 'nightly') {
      this.writeSignalHistoryDoc(batch, runId, entries);
    }
    this.updateGateDates(batch, entries);

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
    entries: RhAgentSignalEntry[]
  ): void {
    if (entries.length === 0) return;

    const docRef = this.symbolRef.collection(RH_AGENT_RUN_IDS_SUBCOLLECTION).doc(runId);
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
        updatedAt: FieldValue.serverTimestamp(),
        ...signalsUpdate,
      } as RhAgentRunIdDoc,
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
    entries: RhAgentSignalEntry[]
  ): void {
    if (entries.length === 0) return;

    const byBarDate = new Map<string, RhAgentSignalEntry[]>();
    for (const entry of entries) {
      const list = byBarDate.get(entry.barDate) ?? [];
      list.push(entry);
      byBarDate.set(entry.barDate, list);
    }

    for (const [barDate, dateEntries] of byBarDate) {
      const docRef = this.symbolRef.collection(RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION).doc(barDate);
      const signalsUpdate: Record<string, any> = {};
      for (const entry of dateEntries) {
        signalsUpdate[`signals.${entry.signalType}`] = { ...entry, sourceRunId: runId };
      }
      batch.set(
        docRef,
        {
          symbol: this.symbol,
          date: barDate,
          updatedAt: FieldValue.serverTimestamp(),
          canonicalizedAt: FieldValue.serverTimestamp(),
          ...signalsUpdate,
        } as RhAgentSignalHistoryDoc,
        { merge: true }
      );
    }
  }


  /**
   * Update the symbol doc's last signal date/direction fields based on the
   * highest-priority entries written for this bar date.
   */
  private updateGateDates(batch: FirebaseFirestore.WriteBatch, entries: RhAgentSignalEntry[]): void {
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

