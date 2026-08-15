/**
 * Option contract selection helpers for single-leg and multi-leg spreads.
 *
 * Shared between the options strategy engine and the hybrid quote provider.
 * Supports target delta, target DTE, DTE bounds, and mark availability.
 * All AV market-data fields are optional strings, so helpers parse defensively.
 *
 * Originally lived in rh-agent-cloud-function/strategies; relocated to common/
 * so the new options-strategy-engine (a separate subsystem) can share it without
 * reaching across subsystem boundaries.
 */

import { HistoricalOptionContract, OptionType } from '../types/partner';

export interface OptionContractSelectionCriteria {
  /** Option type / side of the leg. */
  type: OptionType;
  /** Target absolute delta (e.g. 0.75 for a 75-delta LEAP call). */
  targetDelta?: number;
  /** Target days to expiration. */
  targetDte?: number;
  /** Minimum allowed DTE (hard constraint, relaxed only if no contract matches). */
  minDte?: number;
  /** Maximum allowed DTE (hard constraint, relaxed only if no contract matches). */
  maxDte?: number;
  /** If true, skip contracts with a missing mark price. */
  requireMark?: boolean;
  /** If true, compare |delta| against targetDelta (useful for puts). */
  useAbsoluteDelta?: boolean;
}

export interface SelectedOptionContract {
  contract: HistoricalOptionContract;
  dte: number;
  mark?: number;
  delta?: number;
  score: number;
}

export interface OptionSpreadLegSelection {
  side: 'long' | 'short';
  quantity?: number;
  criteria: OptionContractSelectionCriteria;
}

export interface SelectedOptionSpreadLeg extends SelectedOptionContract {
  legIndex: number;
  side: 'long' | 'short';
  quantity: number;
}

export function parseOptionalNumber(value?: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) || !Number.isFinite(n) ? undefined : n;
}

function parseDate(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || Number.isNaN(y) || !m || Number.isNaN(m) || !d || Number.isNaN(d)) {
    return NaN;
  }
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(fromDate: string, toDate: string): number | undefined {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.round((to - from) / 86_400_000);
}

function computeScore(
  dte: number,
  delta: number | undefined,
  mark: number | undefined,
  criteria: OptionContractSelectionCriteria,
  enforceDteRange: boolean,
): number | null {
  if (criteria.requireMark && mark === undefined) return null;
  if (criteria.targetDelta !== undefined && delta === undefined) return null;

  if (enforceDteRange) {
    if (criteria.minDte !== undefined && dte < criteria.minDte) return null;
    if (criteria.maxDte !== undefined && dte > criteria.maxDte) return null;
  }

  let score = 0;
  if (criteria.targetDelta !== undefined) {
    const signedDelta = delta ?? 0;
    const effectiveDelta = criteria.useAbsoluteDelta ? Math.abs(signedDelta) : signedDelta;
    score += Math.abs(effectiveDelta - criteria.targetDelta);
  }
  if (criteria.targetDte !== undefined && criteria.targetDte > 0) {
    const dteDiff = Math.abs(dte - criteria.targetDte) / criteria.targetDte;
    score += dteDiff * 0.5;
  }

  // Soft penalty if the candidate falls outside the desired DTE band and we
  // are in relaxed fallback mode.
  if (!enforceDteRange) {
    if (criteria.minDte !== undefined && dte < criteria.minDte) {
      score += (criteria.minDte - dte) / Math.max(criteria.minDte, 1);
    }
    if (criteria.maxDte !== undefined && dte > criteria.maxDte) {
      score += (dte - criteria.maxDte) / Math.max(criteria.maxDte, 1);
    }
  }

  return score;
}

function normalizeType(value: string | OptionType | undefined): string {
  return String(value ?? '').toLowerCase().trim();
}

function evaluateContract(
  marketDate: string,
  contract: HistoricalOptionContract,
  criteria: OptionContractSelectionCriteria,
  enforceDteRange: boolean,
): SelectedOptionContract | null {
  if (normalizeType(contract.type) !== normalizeType(criteria.type)) return null;
  if (!contract.expiration) return null;

  const dte = daysBetween(marketDate, contract.expiration);
  if (dte === undefined || dte <= 0) return null;

  const delta = parseOptionalNumber(contract.delta);
  const mark = parseOptionalNumber(contract.mark);

  const score = computeScore(dte, delta, mark, criteria, enforceDteRange);
  if (score === null) return null;

  return { contract, dte, delta, mark, score };
}

/**
 * Select the best option contract for a single leg.
 *
 * Returns null when no usable contract is found.
 */
export function selectOptionContract(
  marketDate: string,
  contracts: HistoricalOptionContract[],
  criteria: OptionContractSelectionCriteria,
): SelectedOptionContract | null {
  // First pass: respect DTE bounds.
  const eligible: SelectedOptionContract[] = [];
  const fallback: SelectedOptionContract[] = [];

  for (const contract of contracts) {
    const inRange = evaluateContract(marketDate, contract, criteria, true);
    if (inRange) {
      eligible.push(inRange);
      continue;
    }
    const relaxed = evaluateContract(marketDate, contract, criteria, false);
    if (relaxed) {
      fallback.push(relaxed);
    }
  }

  const pool = eligible.length > 0 ? eligible : fallback;
  if (pool.length === 0) return null;

  pool.sort((a, b) => a.score - b.score);
  return pool[0];
}

/**
 * Select one contract per leg for a multi-leg spread.
 *
 * Each leg is selected sequentially from the remaining pool so the same
 * contract is never used twice.
 *
 * Returns null if any leg cannot be filled.
 */
export function selectOptionSpread(
  marketDate: string,
  contracts: HistoricalOptionContract[],
  legs: OptionSpreadLegSelection[],
): SelectedOptionSpreadLeg[] | null {
  const selected: SelectedOptionSpreadLeg[] = [];
  let remaining = [...contracts];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const result = selectOptionContract(marketDate, remaining, leg.criteria);
    if (!result) return null;

    const id = result.contract.contractID;
    if (id !== undefined) {
      remaining = remaining.filter((c) => c.contractID !== id);
    }

    selected.push({
      ...result,
      legIndex: i,
      side: leg.side,
      quantity: leg.quantity ?? 1,
    });
  }

  return selected;
}
