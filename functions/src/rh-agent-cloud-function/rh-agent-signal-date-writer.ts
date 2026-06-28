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
  RhAgentSignalDateDoc,
  RhAgentSignalEntry,
} from './rh-agent-config';

export class SignalDateWriter {
  private readonly symbolRef: FirebaseFirestore.DocumentReference;

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
    entries: RhAgentSignalEntry[],
    intraday: boolean
  ): Promise<number> {
    if (entries.length === 0) return 0;

    const weeklyEntries = entries.filter((e) => e.timeframe === 'W');
    const dailyEntries = entries.filter((e) => e.timeframe === 'D');

    const weeklyTypes = new Set(weeklyEntries.map((e) => e.signalType));
    const dailyTypes = new Set(dailyEntries.map((e) => e.signalType));
    const barDate = entries[0].barDate;

    const writeDoc = this.writeSignalDateDoc(runId, entries);
    const gateUpdate = this.updateGateDates(entries);

    const clearPromises: Promise<void>[] = [];
    if (weeklyTypes.size > 0) {
      clearPromises.push(this.clearStaleInterimSignals(barDate, weeklyTypes));
    }
    if (intraday && dailyTypes.size > 0) {
      clearPromises.push(this.clearStaleInterimSignals(barDate, dailyTypes));
    }

    await Promise.all([writeDoc, gateUpdate, ...clearPromises]);
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

