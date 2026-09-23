/**
 * Chain grid model builders.
 *
 * Turn a session snapshot (+ prior-session snapshot for change) into the
 * strikes x expirations view-model a chain-grid component renders. All
 * display strings are precomputed here so hover/re-render is property
 * reads only.
 */
import type { HistoricalOptionContract } from '@options-contract/contracts';
import { normalizeOptionType, OptionType } from '@options-contract/contracts';

import { parseNum } from '../../../utils/contract-observation.utils';

/** Strike ordering within a side's grid — default high strike at top. */
export type StrikeOrientation = 'desc' | 'asc';

/** parseNum treats '' as 0 — a missing value must be null, not zero. */
function numOrNull(v: string | undefined): number | null {
  return v === '' || v == null ? null : parseNum(v);
}

/** One rendered contract cell — numeric values for logic, strings for view. */
export interface ChainCell {
  contractID: string;
  expiration: string;
  strike: number;
  mark: number | null;
  priorMark: number | null;
  chgAbs: number | null;
  chgPct: number | null;
  delta: number | null;
  iv: number | null;
  markText: string;
  /** "+$0.25 / +10.0%" or 'n/a' when prior mark is missing. */
  chgText: string;
  deltaText: string;
  /** IV rendered as a percentage (source is a decimal fraction). */
  ivText: string;
}

export interface ChainGridRow {
  strike: number;
  /** Aligned to ChainGridModel.expirations — null holes where no contract. */
  cells: (ChainCell | null)[];
}

export interface ChainGridModel {
  /** Expiration columns, ascending. */
  expirations: string[];
  /** Strike rows, descending (high strike at top). */
  rows: ChainGridRow[];
  /** Strike nearest the underlying close — scroll/highlight anchor. */
  atmStrike: number | null;
}

function fmtSignedMoney(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function fmtSignedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

/**
 * Build one side's grid model. Contracts missing contractID/strike/
 * expiration can't be placed and are skipped. Change is computed against
 * the prior-session contract with the same contractID; missing prior mark
 * or missing mark yields 'n/a' — never a silent fallback.
 */
export function buildChainGrid(
  session: HistoricalOptionContract[],
  prior: HistoricalOptionContract[],
  side: OptionType,
  spot: number | null = null,
  orientation: StrikeOrientation = 'desc',
): ChainGridModel {
  const priorById = new Map<string, HistoricalOptionContract>();
  for (const c of prior) {
    if (c.contractID) priorById.set(c.contractID, c);
  }

  const byCell = new Map<string, ChainCell>();
  const expirations = new Set<string>();
  const strikes = new Set<number>();

  for (const c of session) {
    if (normalizeOptionType(c.type) !== side || !c.contractID || !c.expiration) continue;
    const strike = numOrNull(c.strike);
    if (strike === null) continue;

    const mark = numOrNull(c.mark);
    const priorMark = numOrNull(priorById.get(c.contractID)?.mark);
    const chgRaw = mark !== null && priorMark !== null ? mark - priorMark : null;
    // Sub-cent float noise renders as -$0.00 — clamp to zero.
    const chgAbs = chgRaw !== null && Math.abs(chgRaw) < 0.005 ? 0 : chgRaw;
    const chgPct =
      chgAbs !== null && priorMark !== null && priorMark !== 0
        ? chgAbs / priorMark
        : null;
    const delta = numOrNull(c.delta);
    const iv = numOrNull(c.implied_volatility);

    expirations.add(c.expiration);
    strikes.add(strike);
    byCell.set(`${strike}|${c.expiration}`, {
      contractID: c.contractID,
      expiration: c.expiration,
      strike,
      mark,
      priorMark,
      chgAbs,
      chgPct,
      delta,
      iv,
      markText: mark !== null ? `$${mark.toFixed(2)}` : 'n/a',
      chgText:
        chgAbs !== null
          ? `${fmtSignedMoney(chgAbs)} / ${chgPct !== null ? fmtSignedPct(chgPct) : 'n/a'}`
          : 'n/a',
      deltaText: delta !== null ? delta.toFixed(2) : 'n/a',
      ivText: iv !== null ? `${(iv * 100).toFixed(1)}%` : 'n/a',
    });
  }

  const expList = [...expirations].sort();
  const strikeList = [...strikes].sort((a, b) =>
    orientation === 'desc' ? b - a : a - b,
  );
  const atmStrike =
    spot != null && strikeList.length
      ? strikeList.reduce((a, b) =>
          Math.abs(b - spot) < Math.abs(a - spot) ? b : a,
        )
      : null;

  return {
    expirations: expList,
    atmStrike,
    rows: strikeList.map((strike) => ({
      strike,
      cells: expList.map((exp) => byCell.get(`${strike}|${exp}`) ?? null),
    })),
  };
}
