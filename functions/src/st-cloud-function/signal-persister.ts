/**
 * Signal Persister
 *
 * Converts strategy outputs into signal entries and persists them to the
 * canonical st-signals occurrence docs (+ st-symbols gate fields) via
 * SignalDateWriter. This is a pure persistence concern extracted from the
 * worker so it can be tested independently.
 */
import { logger } from 'firebase-functions/v2';
import { SignalDateWriter } from './signal-date-writer';
import {
  StSignalEntry,
  StSignalDirection,
} from './signals';
import { stSignalStatusFromBarStatus } from '@st/signals';
import type { StrategyOutput } from './strategies/strategy-registry';

export interface SignalPersistenceResult {
  opportunityCount: number;
}

/**
 * Persist all fired signals for a symbol/run.
 *
 * @param symbol Symbol ticker.
 * @param runId Run ID.
 * @param marketDate YYYY-MM-DD run date.
 * @param results Strategy outputs.
 */
export async function persistSymbolSignals(
  symbol: string,
  runId: string,
  marketDate: string,
  results: StrategyOutput[],
  barStatusByTimeframe?: Record<'D' | 'W' | 'M', -1 | 0 | 1 | undefined>,
): Promise<SignalPersistenceResult> {
  const fired = results.filter(r => r.action);
  const entries = fired.map(r => createSignalEntry(marketDate, r, barStatusByTimeframe));

  const byBarDate = new Map<string, StSignalEntry[]>();
  for (const entry of entries) {
    const list = byBarDate.get(entry.barDate) ?? [];
    list.push(entry);
    byBarDate.set(entry.barDate, list);
  }

  const writer = new SignalDateWriter(symbol);
  const barDatePromises: Promise<number>[] = [];
  for (const [, dateEntries] of byBarDate) {
    barDatePromises.push(writer.persistBarDate(runId, marketDate, dateEntries));
  }

  const counts = await Promise.all(barDatePromises);
  const opportunityCount = counts.reduce((sum, c) => sum + c, 0);

  logger.info('st_signal_persister_persisted', {
    symbol,
    runId,
    marketDate,
    barDates: Array.from(byBarDate.keys()),
    opportunityCount,
  });

  return { opportunityCount };
}

/**
 * Build a signal entry for the canonical st-signals occurrence upsert.
 *
 * barStatus → status delegates to stSignalStatusFromBarStatus (@st/signals).
 *
 * barDate is always the date of the bar that fired the signal (from the strategy
 * output), never the run date. The run date is captured separately in marketDate.
 */
function createSignalEntry(
  marketDate: string,
  result: StrategyOutput,
  barStatusByTimeframe?: Record<'D' | 'W' | 'M', -1 | 0 | 1 | undefined>,
): StSignalEntry {
  const timeframe = deriveTimeframe(result.signalType);
  const barStatus = barStatusByTimeframe?.[timeframe];
  const barDate = result.barDate || marketDate;
  const status = stSignalStatusFromBarStatus(barStatus);
  return {
    signalType: result.signalType,
    timeframe,
    direction: result.action ?? StSignalDirection.LONG,
    status,
    barDate,
    marketDate,
    indicators: (result.indicators || {}) as Record<string, number | string | null>,
  };
}

/**
 * Derive timeframe ('D' | 'W' | 'M') from signalType prefix.
 */
function deriveTimeframe(signalType: string): 'D' | 'W' | 'M' {
  if (signalType.startsWith('W_')) return 'W';
  if (signalType.startsWith('M_')) return 'M';
  return 'D';
}
