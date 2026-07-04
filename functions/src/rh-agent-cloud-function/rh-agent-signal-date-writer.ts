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
  RhAgentRunIdDoc,
  RhAgentSignalHistoryDoc,
  RhAgentSignalEntry,
  RhAgentTriggeredBy,
} from './rh-agent-config';

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
   * Persist all signal entries for a single bar date in parallel:
   *   - merge-write the run-ids doc
   *   - merge-write the signal-history doc (nightly runs only)
   *   - batch-update the symbol gate dates
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

    const writeRunId = this.writeRunIdDoc(runId, runStartedAt, marketDate, entries);
    const gateUpdate = this.updateGateDates(entries);

    const writes: Promise<any>[] = [writeRunId, gateUpdate];
    if (triggeredBy === 'nightly') {
      writes.push(this.writeSignalHistoryDoc(runId, entries));
    }

    await Promise.all(writes);
    return entries.length;
  }

  /**
   * Write signals to run-ids/{runId} — the run-centric real-time path.
   * One doc per run per symbol; all signals for this run stored as a map keyed by signalType.
   */
  private async writeRunIdDoc(
    runId: string,
    runStartedAt: string,
    marketDate: string,
    entries: RhAgentSignalEntry[]
  ): Promise<void> {
    if (entries.length === 0) return;

    const docRef = this.symbolRef.collection(RH_AGENT_RUN_IDS_SUBCOLLECTION).doc(runId);
    const signalsUpdate: Record<string, any> = {};
    for (const entry of entries) {
      signalsUpdate[`signals.${entry.signalType}`] = entry;
    }

    await docRef.set(
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
  private async writeSignalHistoryDoc(
    runId: string,
    entries: RhAgentSignalEntry[]
  ): Promise<void> {
    if (entries.length === 0) return;

    const byBarDate = new Map<string, RhAgentSignalEntry[]>();
    for (const entry of entries) {
      const list = byBarDate.get(entry.barDate) ?? [];
      list.push(entry);
      byBarDate.set(entry.barDate, list);
    }

    const writes: Promise<any>[] = [];
    for (const [barDate, dateEntries] of byBarDate) {
      const docRef = this.symbolRef.collection(RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION).doc(barDate);
      const signalsUpdate: Record<string, any> = {};
      for (const entry of dateEntries) {
        signalsUpdate[`signals.${entry.signalType}`] = { ...entry, sourceRunId: runId };
      }
      writes.push(
        docRef.set(
          {
            symbol: this.symbol,
            date: barDate,
            updatedAt: FieldValue.serverTimestamp(),
            canonicalizedAt: FieldValue.serverTimestamp(),
            ...signalsUpdate,
          } as RhAgentSignalHistoryDoc,
          { merge: true }
        )
      );
    }

    await Promise.all(writes);
  }


  /**
   * Update the symbol doc's last signal date/direction fields based on the
   * highest-priority entries written for this bar date.
   */
  private async updateGateDates(entries: RhAgentSignalEntry[]): Promise<void> {
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
    await this.symbolRef.set(updates, { merge: true });
  }
}

