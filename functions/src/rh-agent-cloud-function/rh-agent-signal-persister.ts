/**
 * Signal Persister
 *
 * Converts strategy outputs into signal entries and persists them to the
 * run-ids and signal-history subcollections via SignalDateWriter. This is a
 * pure persistence concern extracted from the worker so it can be tested
 * independently.
 */
import { logger } from 'firebase-functions/v2';
import { SignalDateWriter } from './rh-agent-signal-date-writer';
import {
  RhAgentSignalEntry,
  RhAgentSignalStatus,
  StSignalDirection,
} from './rh-agent-config';
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
 * @param runStartedAt ISO run start timestamp.
 * @param intraday Whether this is an intraday run.
 * @param results Strategy outputs.
 * @param triggeredBy Optional trigger source ('manual' | 'pdr' | 'nightly').
 */
export async function persistSymbolSignals(
  symbol: string,
  runId: string,
  marketDate: string,
  runStartedAt: string,
  intraday: boolean,
  results: StrategyOutput[],
  triggeredBy?: string,
): Promise<SignalPersistenceResult> {
  const fired = results.filter(r => r.action);
  const entries = fired.map(r => createSignalEntry(marketDate, r, intraday));

  const byBarDate = new Map<string, RhAgentSignalEntry[]>();
  for (const entry of entries) {
    const list = byBarDate.get(entry.barDate) ?? [];
    list.push(entry);
    byBarDate.set(entry.barDate, list);
  }

  const writer = new SignalDateWriter(symbol);
  const barDatePromises: Promise<number>[] = [];
  for (const [, dateEntries] of byBarDate) {
    barDatePromises.push(writer.persistBarDate(runId, runStartedAt, marketDate, dateEntries, intraday, triggeredBy as any));
  }

  const counts = await Promise.all(barDatePromises);
  const opportunityCount = counts.reduce((sum, c) => sum + c, 0);

  logger.info('rh_agent_signal_persister_persisted', {
    symbol,
    runId,
    marketDate,
    barDates: Array.from(byBarDate.keys()),
    opportunityCount,
  });

  return { opportunityCount };
}

/**
 * Build a signal entry for the run-ids and signal-history maps.
 */
function createSignalEntry(
  marketDate: string,
  result: StrategyOutput,
  intraday: boolean
): RhAgentSignalEntry {
  const timeframe = deriveTimeframe(result.signalType);
  const barDate = result.barDate || marketDate;
  return {
    signalType: result.signalType,
    timeframe,
    direction: result.action ?? StSignalDirection.LONG,
    status: deriveSignalStatus(timeframe, barDate, marketDate, intraday),
    barDate,
    marketDate,
    indicators: (result.indicators || {}) as Record<string, number | string | null>,
  };
}

/**
 * Derive timeframe ('D' | 'W') from signalType prefix.
 */
function deriveTimeframe(signalType: string): 'D' | 'W' {
  return signalType.startsWith('W_') ? 'W' : 'D';
}

/**
 * Determine signal status.
 * Daily signals are CONFIRMED on nightly runs, INTERIM during intraday runs.
 * Weekly signals are CONFIRMED once the next weekly bar has started
 * (i.e. marketDate is at least 7 days after barDate), otherwise INTERIM.
 */
function deriveSignalStatus(
  timeframe: 'D' | 'W',
  barDate: string,
  marketDate: string,
  intraday: boolean
): RhAgentSignalStatus {
  if (timeframe === 'D') return intraday ? 'INTERIM' : 'CONFIRMED';
  const barMs = new Date(barDate).getTime();
  const runMs = new Date(marketDate).getTime();
  return runMs - barMs >= 7 * 86_400_000 ? 'CONFIRMED' : 'INTERIM';
}
