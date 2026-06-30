/**
 * SignalDateWriter
 *
 * Encapsulates all Firestore writes to `rh-agent-symbols/{symbol}/signal-dates/{barDate}`
 * and the per-symbol gate-date fields. Writes for different bar dates and doc types run
 * in parallel; writes to the same doc are kept as a single batched update.
 */
import { db, FieldValue } from '../firebase-admin-init';
import {
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_SIGNAL_DATES_SUBCOLLECTION,
  RH_AGENT_RUN_IDS_SUBCOLLECTION,
  RH_AGENT_SIGNAL_HISTORY_SUBCOLLECTION,
  RhAgentSignalDateDoc,
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
   *   - merge-write the signal-date doc
   *   - batch-update the symbol gate dates
   *   - delete stale INTERIM signals for this bar date
   *
   * Returns the number of entries persisted.
   */
  async persistBarDate(
    runId: string,
    runStartedAt: string,
    marketDate: string,
    entries: RhAgentSignalEntry[],
    intraday: boolean,
    triggeredBy?: RhAgentTriggeredBy
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const weeklyEntries = entries.filter((e) => e.timeframe === 'W');
    const dailyEntries = entries.filter((e) => e.timeframe === 'D');

    const weeklyTypes = new Set(weeklyEntries.map((e) => e.signalType));
    const dailyTypes = new Set(dailyEntries.map((e) => e.signalType));
    const barDate = entries[0].barDate;

    const writeSignalDate = this.writeSignalDateDoc(runId, entries);
    const writeRunId = this.writeRunIdDoc(runId, runStartedAt, marketDate, entries);
    const gateUpdate = this.updateGateDates(entries);

    const clearPromises: Promise<void>[] = [];
    if (weeklyTypes.size > 0) {
      clearPromises.push(this.clearStaleInterimSignals(barDate, weeklyTypes));
    }
    if (intraday && dailyTypes.size > 0) {
      clearPromises.push(this.clearStaleInterimSignals(barDate, dailyTypes));
    }

    const writes: Promise<any>[] = [writeSignalDate, writeRunId, gateUpdate, ...clearPromises];
    if (triggeredBy === 'nightly') {
      writes.push(this.writeSignalHistoryDoc(runId, entries));
    }

    await Promise.all(writes);
    return entries.length;
  }

  /**
   * Delete stale INTERIM signals on a bar date that did not fire this run.
   * The caller controls which timeframes are considered by the signal types it passes.
   */
  async clearStaleInterimSignals(
    barDate: string,
    firedSignalTypes: Set<string>
  ): Promise<void> {
    const docRef = this.symbolRef.collection(RH_AGENT_SIGNAL_DATES_SUBCOLLECTION).doc(barDate);
    const snap = await docRef.get();
    if (!snap.exists) return;

    const data = snap.data() as RhAgentSignalDateDoc;
    const deletions: Record<string, any> = {};
    for (const [signalType, entry] of Object.entries(data.signals ?? {})) {
      if (entry.status === 'INTERIM' && !firedSignalTypes.has(signalType)) {
        deletions[`signals.${signalType}`] = FieldValue.delete();
      }
    }

    if (Object.keys(deletions).length > 0) {
      await docRef.update(deletions);
    }
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
   * Merge-write the signal-date doc (date-centric path, kept for backward compatibility).
   * Confirmed signals are never overwritten by new INTERIM entries.
   */
  private async writeSignalDateDoc(runId: string, entries: RhAgentSignalEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const barDate = entries[0].barDate;
    const docRef = this.symbolRef.collection(RH_AGENT_SIGNAL_DATES_SUBCOLLECTION).doc(barDate);

    const existing = await docRef.get();
    const existingData = existing.exists ? (existing.data() as RhAgentSignalDateDoc) : null;

    const signalsUpdate: Record<string, any> = {};
    for (const entry of entries) {
      const previous = existingData?.signals?.[entry.signalType];
      if (previous?.status === 'CONFIRMED') continue;
      signalsUpdate[`signals.${entry.signalType}`] = entry;
    }

    if (Object.keys(signalsUpdate).length === 0) return;

    await docRef.set(
      {
        symbol: this.symbol,
        barDate,
        runId,
        updatedAt: FieldValue.serverTimestamp(),
        ...signalsUpdate,
      },
      { merge: true }
    );
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

