/**
 * Pure functions for parsing PDR (Partner Data Ready) messages.
 *
 * These functions have no side effects and no dependencies — they transform
 * raw Pub/Sub message attributes + decoded payload into a structured context
 * that the SDS subscriber and worker consume.
 */

import type { PartnerInterval } from '../partner-infrastructure';

export type PdrPhase = 'pre' | 'post';
export type PdrSequence = 'A' | 'B' | 'C';
export type PdrInterval = PartnerInterval | 'intraday';

export interface PdrContext {
  runType: string;
  phase: PdrPhase;
  runId: string;
  marketDate: string;
  interval: PdrInterval;
  sequence: PdrSequence | undefined;
  excludeSymbols: string[] | undefined;
  includeSymbols: string[] | undefined;
  clockPt: string | undefined;
}

type AttrMap = Record<string, string | undefined>;

function normalizeInterval(raw: string | undefined): PdrInterval {
  const upper = (raw ?? '').toUpperCase();
  if (upper === 'DAILY' || upper === 'WEEKLY' || upper === 'MONTHLY') return upper;
  if (upper === 'INTRADAY') return 'intraday';
  // Unknown interval — log and throw rather than silently defaulting
  throw new Error(`sds_unknown_interval: ${raw ?? '(undefined)'}`);
}

export function resolvePdrContext(
  attributes: AttrMap,
  payload: Record<string, unknown>,
): PdrContext {
  const runType = (attributes.runType ?? payload.runType as string ?? '').toString();
  const phase = ((attributes.phase ?? payload.phase as string ?? 'post') as string).toLowerCase() as PdrPhase;
  const runId = (attributes.runId ?? payload.runId as string ?? '').toString();
  const marketDate = (attributes.marketDate ?? payload.marketDate as string ?? '').toString();

  const isPre = phase === 'pre';
  const interval = isPre
    ? 'intraday'
    : normalizeInterval(attributes.interval ?? (payload.intervals as string[] | undefined)?.[0]);

  const sequence = isPre ? undefined : resolveSequence(runId);

  const excludeSymbols = payload.excludeSymbols as string[] | undefined;
  const includeSymbols = payload.includeSymbols as string[] | undefined;
  const clockPt = attributes.clockPt;

  return { runType, phase, runId, marketDate, interval, sequence, excludeSymbols, includeSymbols, clockPt };
}

export function resolveSequence(runId: string): PdrSequence | undefined {
  // RunIdFactory.createRealtime() format:
  //   {marketDate}-{dow}-{sequence}-{interval}-LIVE|MANUAL-POST-{clockPt}
  //   e.g., 2026-01-24-FRI-A-DAILY-LIVE-POST-1335
  // The sequence is a single char (A/B/C) between the dow and interval.
  const match = runId.match(/-[A-Z]{3}-([ABC])-(?:DAILY|WEEKLY|MONTHLY)-/);
  return match ? (match[1] as PdrSequence) : undefined;
}

export function computeSequenceRunId(runId: string, marketDate: string): string | undefined {
  const seq = resolveSequence(runId);
  if (!seq) return undefined;
  return `${marketDate}-POST-${seq}`;
}

export function resolveSymbolSet(ctx: PdrContext, trackedSymbols: string[]): string[] {
  if (ctx.phase === 'pre') {
    return [...trackedSymbols];
  }

  if (ctx.sequence === 'A') {
    const exclude = new Set(ctx.excludeSymbols ?? []);
    return trackedSymbols.filter((s) => !exclude.has(s));
  }

  // POST B/C
  return ctx.includeSymbols ?? [];
}
