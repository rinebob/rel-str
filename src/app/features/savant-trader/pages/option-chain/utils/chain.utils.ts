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

import { parseNumOrNull } from '../../../utils/contract-observation.utils';

/** Strike ordering within a side's grid — default high strike at top. */
export type StrikeOrientation = 'desc' | 'asc';

/** One rendered contract cell — numeric values for logic, strings for view. */
export interface ChainCell {
  contractID: string;
  expiration: string;
  strike: number;
  /** Raw session contract — the hover popup renders the full payload. */
  contract: HistoricalOptionContract;
  mark: number | null;
  priorMark: number | null;
  chgAbs: number | null;
  chgPct: number | null;
  delta: number | null;
  iv: number | null;
  volume: number | null;
  openInterest: number | null;
  /** |delta| band shading — odd tenths (0.1x/0.3x/0.5x/0.7x/0.9x incl. 1.0)
   *  shade, even tenths don't. Null delta → false. */
  deltaShaded: boolean;
  markText: string;
  /** "+$0.25 / +10.0%" or 'n/a' when prior mark is missing. */
  chgText: string;
  deltaText: string;
  /** IV rendered as a percentage (source is a decimal fraction). */
  ivText: string;
  /** Compact volume / open-interest — '1.2k', '34.5M', 'n/a' when missing. */
  volText: string;
  oiText: string;
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
  /** Distinct strikes in the snapshot BEFORE the symmetric-ATM window —
   *  rows.length vs totalStrikes tells the user strikes were trimmed. */
  totalStrikes: number;
}

function fmtSignedMoney(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function fmtSignedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

/** Compact count for tiny cells — 950→'950', 1234→'1.2k', 2.5M→'2.5M'.
 *  999_500+ rounds into '1.0M' rather than the degenerate '1000k'. */
function fmtCount(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Cell inclusion filter — mirrors pct-change's delta filter semantics. */
export interface ChainGridFilter {
  /** |delta| lower bound — contracts below are excluded. */
  deltaGte?: number | null;
  /** |delta| upper bound — contracts above are excluded. */
  deltaLte?: number | null;
  /** Strike lower bound — rows below are excluded. */
  strikeGte?: number | null;
  /** Strike upper bound — rows above are excluded. */
  strikeLte?: number | null;
  /** Expiration columns to hide entirely (the Columns picker writes these). */
  excludeExpirations?: ReadonlySet<string> | null;
}

/** Index of the row whose strike is nearest `target` — the semantic
 *  anchor for cross-pane scroll sync. Rows are sorted (either
 *  orientation); a linear scan over ~100 rows is cheap and orientation-
 *  agnostic, and nearest-match keeps sync working when the panes' strike
 *  sets differ. */
export function nearestStrikeIndex(
  rows: readonly { strike: number }[],
  target: number,
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(rows[i].strike - target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface BuildChainGridOptions {
  /** Underlying session close — anchors atmStrike. */
  spot?: number | null;
  /** Strike ordering — default high strike at top. */
  orientation?: StrikeOrientation;
  /** Symmetric strike window around ATM (default true): keeps
   *  min(above, below) strikes on each side so ATM is the row-count
   *  midpoint — keeps BOTH-mode panes vertically aligned and is the
   *  per-day "strike filter" that trims the excess side. */
  atmSymmetric?: boolean;
  filter?: ChainGridFilter;
}

/**
 * Build one side's grid model. Contracts missing contractID/strike/
 * expiration can't be placed and are skipped. Change is computed against
 * the prior-session contract with the same contractID; missing prior mark
 * or missing mark yields 'n/a' — never a silent fallback. When a delta
 * bound is set, contracts with missing delta fail the filter (same as
 * pct-change).
 */
export function buildChainGrid(
  session: HistoricalOptionContract[],
  prior: HistoricalOptionContract[],
  side: OptionType,
  opts: BuildChainGridOptions = {},
): ChainGridModel {
  const { spot = null, orientation = 'desc', atmSymmetric = true, filter } = opts;
  const priorById = new Map<string, HistoricalOptionContract>();
  for (const c of prior) {
    if (c.contractID) priorById.set(c.contractID, c);
  }

  const byCell = new Map<string, ChainCell>();
  const expirations = new Set<string>();
  const strikes = new Set<number>();

  for (const c of session) {
    if (normalizeOptionType(c.type) !== side || !c.contractID || !c.expiration) continue;
    const strike = parseNumOrNull(c.strike);
    if (strike === null) continue;
    if (filter?.strikeGte != null && strike < filter.strikeGte) continue;
    if (filter?.strikeLte != null && strike > filter.strikeLte) continue;

    const mark = parseNumOrNull(c.mark);
    const priorMark = parseNumOrNull(priorById.get(c.contractID)?.mark);
    const chgRaw = mark !== null && priorMark !== null ? mark - priorMark : null;
    // Sub-cent float noise renders as -$0.00 — clamp to zero.
    const chgAbs = chgRaw !== null && Math.abs(chgRaw) < 0.005 ? 0 : chgRaw;
    const chgPct =
      chgAbs !== null && priorMark !== null && priorMark !== 0
        ? chgAbs / priorMark
        : null;
    const delta = parseNumOrNull(c.delta);
    const iv = parseNumOrNull(c.implied_volatility);
    const volume = parseNumOrNull(c.volume);
    const openInterest = parseNumOrNull(c.open_interest);

    // Delta filter on absolute value — missing delta fails (pct-change parity).
    if (filter?.deltaGte != null || filter?.deltaLte != null) {
      if (delta === null) continue;
      const absDelta = Math.abs(delta);
      if (filter.deltaGte != null && absDelta < filter.deltaGte) continue;
      if (filter.deltaLte != null && absDelta > filter.deltaLte) continue;
    }

    expirations.add(c.expiration);
    strikes.add(strike);
    byCell.set(`${strike}|${c.expiration}`, {
      contractID: c.contractID,
      expiration: c.expiration,
      strike,
      contract: c,
      deltaShaded:
        delta !== null &&
        Math.min(Math.floor(Math.abs(delta) * 10 + 1e-9), 9) % 2 === 1,
      mark,
      priorMark,
      chgAbs,
      chgPct,
      delta,
      iv,
      volume,
      openInterest,
      markText: mark !== null ? `$${mark.toFixed(2)}` : 'n/a',
      chgText:
        chgAbs !== null
          ? `${fmtSignedMoney(chgAbs)} / ${chgPct !== null ? fmtSignedPct(chgPct) : 'n/a'}`
          : 'n/a',
      deltaText: delta !== null ? delta.toFixed(2) : 'n/a',
      ivText: iv !== null ? `${(iv * 100).toFixed(1)}%` : 'n/a',
      volText: volume !== null ? `V ${fmtCount(volume)}` : 'n/a',
      oiText: openInterest !== null ? `OI ${fmtCount(openInterest)}` : 'n/a',
    });
  }

  const hidden = filter?.excludeExpirations ?? null;
  const expList = [...expirations].sort().filter((e) => !hidden?.has(e));
  const allStrikes = [...strikes].sort((a, b) => a - b); // asc — symmetric slice needs positional neighbors
  // ATM reduce runs over desc order — preserves the prior tie-break where
  // the HIGHER of two equidistant strikes wins.
  const descStrikes = [...allStrikes].reverse();
  const atmStrike =
    spot != null && descStrikes.length
      ? descStrikes.reduce((a, b) =>
          Math.abs(b - spot) < Math.abs(a - spot) ? b : a,
        )
      : null;

  // Symmetric window: equal strike counts above and below ATM. The pane
  // with the longer side loses its excess — recomputed per build, so a
  // new session's different strike shape re-aligns automatically.
  let strikeList = allStrikes;
  if (atmSymmetric && atmStrike !== null) {
    const idx = allStrikes.indexOf(atmStrike);
    const k = Math.min(idx, allStrikes.length - 1 - idx);
    strikeList = allStrikes.slice(idx - k, idx + k + 1);
  }
  if (orientation === 'desc') strikeList = [...strikeList].reverse();

  return {
    expirations: expList,
    atmStrike,
    totalStrikes: strikes.size,
    rows: strikeList.map((strike) => ({
      strike,
      cells: expList.map((exp) => byCell.get(`${strike}|${exp}`) ?? null),
    })),
  };
}
