/**
 * `records.ts` — pure record construction for `optionsReplayAnalysis`
 * (Topic #1238, Thread #1266, task #1372; IMPL-BE §3 step 3).
 *
 * One pick row → one `AnalysisTradeRecord` per registered exit, in
 * registry order (`buildPickRecords`). Rule-invariant outcomes (fetch
 * failure, unusable/truncated series) short-circuit to an 'error' under
 * every exitId; a fired rule gets its own 'exit' record while non-fired
 * rules share the pick's single expired/error outcome — no-fire
 * excursions span the same full window for all rules, so the only
 * per-rule variance is `exitId`.
 */

import { calendarDaysBetween } from '../common/pt-date-utils';
import { EXIT_STRATEGIES } from '@options-analysis/registry';
import type { ContractListPickRow } from '@options-replay/contracts';
import type {
  AnalysisErrorTrade,
  AnalysisExpiredTrade,
  AnalysisTradeRecord,
} from '@options-analysis/contracts';
import type {
  HistoricalOptionsContractV2Observation,
  PartnerHistoricalOptionsContractV2Response,
} from '@options-contract/contracts';
import { evaluateExit, type ExitScanBar, type ExitScanResult } from './exit-evaluators';

// ==========================
// Series normalization
// ==========================

/** Wire observations → scan bars: dates trimmed to YYYY-MM-DD, marks
 *  parsed (absent/blank/non-numeric dropped — see evaluator contract),
 *  bounded to [entryDate, expiration], sorted ascending. `delta`/`iv`
 *  ride along for the record's terminal greeks — absent/blank/
 *  non-numeric parse to `undefined` (a bar without greeks still scans). */
export function toScanBars(
  observations: HistoricalOptionsContractV2Observation[],
  entryDate: string,
  expiration: string,
): ExitScanBar[] {
  return observations
    .map((o) => {
      const delta = numOrUndef(o.delta);
      const iv = numOrUndef(o.implied_volatility);
      return {
        date: o.date.slice(0, 10),
        mark: o.mark?.trim() ? Number(o.mark) : NaN,
        ...(delta !== undefined && { delta }),
        ...(iv !== undefined && { iv }),
      };
    })
    .filter(
      (b) =>
        Number.isFinite(b.mark) && b.date >= entryDate && b.date <= expiration,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Wire-string → finite number or `undefined` (greeks are optional —
 *  missing strings never gate the bar). */
function numOrUndef(s: string | undefined): number | undefined {
  const n = s?.trim() ? Number(s) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// ==========================
// Record construction
// ==========================

const placeholderExcursion = (entryMark: number, pickDate: string) => ({
  mae: { value: entryMark, date: pickDate },
  mfe: { value: entryMark, date: pickDate },
});

/** Everything a record needs besides outcome/excursion — mirrors the
 *  (unexported) AnalysisTradeBase contract fields. */
interface RecordSeed {
  runId: string;
  symbol: string;
  templateId: string;
  contractListDocId: string;
  exitId: string;
  pickDate: string;
  contractId: string;
  entryMark: number;
  /** Pick-day greeks from the SA pick row — written on every outcome,
   *  'error' included. */
  entryDelta: number;
  entryIv: number;
}

/** Run-level slice keys shared by every record in a task. */
export type RecordBase = Pick<
  RecordSeed,
  'runId' | 'symbol' | 'templateId' | 'contractListDocId'
>;

/** Error records carry the entry-day placeholder excursion + daysHeld 0
 *  per the AnalysisErrorTrade contract. */
function errorRecord(seed: RecordSeed, error: string): AnalysisErrorTrade {
  return {
    ...seed,
    outcome: 'error',
    daysHeld: 0,
    ...placeholderExcursion(seed.entryMark, seed.pickDate),
    error,
  };
}

/** 'expired' fields from the underlying close at expiry — put: close <
 *  strike is ITM; call: close > strike. Type comes from the SA response
 *  (authoritative); strike from the pick row. */
function expiredFields(
  type: 'call' | 'put',
  strike: number,
  underlyingClose: number,
): Pick<AnalysisExpiredTrade, 'expiredItm' | 'intrinsicAtExpiry' | 'assignmentDistancePct'> {
  const expiredItm =
    type === 'put' ? underlyingClose < strike : underlyingClose > strike;
  const intrinsicAtExpiry =
    type === 'put'
      ? Math.max(strike - underlyingClose, 0)
      : Math.max(underlyingClose - strike, 0);
  return {
    expiredItm,
    intrinsicAtExpiry,
    assignmentDistancePct:
      (Math.abs(strike - underlyingClose) / underlyingClose) * 100,
  };
}

/** The shared outcome every non-fired rule lands on for one pick —
 *  computed once per pick. */
function noFireOutcome(
  seed: RecordSeed,
  scan: ExitScanResult,
  ctx: {
    reachedExpiry: boolean;
    optionType: unknown;
    strike: number;
    close: number | undefined;
    expiration: string;
    lastBarDate: string;
    /** The final scan bar — terminal greeks + the open row's mark. */
    lastBar: ExitScanBar;
    /** Analysis run date (YYYY-MM-DD, PT) — "is expiry still ahead?". */
    today: string;
  },
): AnalysisTradeRecord {
  if (!ctx.reachedExpiry) {
    // #1431: a series ending short of a FUTURE expiry is a live position,
    // not a data problem — 'open' carries the rule's real excursion and
    // days-held-so-far. Truncated past-expiry series stays 'error'.
    // Boundary notes (review R2): 'open' trusts the series tail — a
    // contract that stopped reporting weeks ago (delist/gap) with a
    // future expiry also reads 'open', but `lastBarDate` surfaces that
    // staleness in the table. `expiration === today` still resolves
    // 'error': the position is live intraday but the record can't know
    // whether the missing expiry bar is pending or absent — the next
    // day's run self-heals it.
    if (ctx.expiration > ctx.today) {
      return {
        ...seed,
        outcome: 'open',
        daysHeld: calendarDaysBetween(seed.pickDate, ctx.lastBarDate),
        mae: scan.mae,
        mfe: scan.mfe,
        lastBarDate: ctx.lastBarDate,
        terminalMark: ctx.lastBar.mark,
        terminalDelta: ctx.lastBar.delta,
        terminalIv: ctx.lastBar.iv,
      };
    }
    return errorRecord(
      seed,
      `series ends ${ctx.lastBarDate} before expiry ${ctx.expiration}`,
    );
  }
  if (ctx.optionType !== 'call' && ctx.optionType !== 'put') {
    return errorRecord(seed, `upstream option type '${String(ctx.optionType)}' unusable`);
  }
  if (ctx.close === undefined) {
    return errorRecord(seed, `no underlying close at expiry ${ctx.expiration}`);
  }
  const expiry = expiredFields(ctx.optionType, ctx.strike, ctx.close);
  return {
    ...seed,
    outcome: 'expired',
    daysHeld: calendarDaysBetween(seed.pickDate, ctx.expiration),
    mae: scan.mae,
    mfe: scan.mfe,
    ...expiry,
    // The settled mark is the terminal economics — matches the mark
    // change the FE derives; greeks come off the expiry bar itself.
    terminalMark: expiry.intrinsicAtExpiry,
    terminalDelta: ctx.lastBar.delta,
    terminalIv: ctx.lastBar.iv,
  };
}

/** One pick row → one record per registered exit, in registry order.
 *  `fetched` is the pick's SA response or its fetch error; records are
 *  distributed by the caller into per-exit buckets by array position. */
export function buildPickRecords(
  row: ContractListPickRow,
  fetched: { resp?: PartnerHistoricalOptionsContractV2Response; error?: string },
  ctx: { underlyingClose: ReadonlyMap<string, number>; base: RecordBase; today: string },
): AnalysisTradeRecord[] {
  const base: Omit<RecordSeed, 'exitId'> = {
    ...ctx.base,
    pickDate: row.entryDate,
    contractId: row.contractId,
    entryMark: row.mark,
    entryDelta: row.delta,
    entryIv: row.iv,
  };
  const allErrors = (error: string) =>
    EXIT_STRATEGIES.map((rule) => errorRecord({ ...base, exitId: rule.exitId }, error));

  if (fetched.error || !fetched.resp?.ok) {
    return allErrors(fetched.error ?? 'upstream response not ok');
  }
  const bars = toScanBars(fetched.resp.series ?? [], row.entryDate, row.expiration);
  if (bars.length === 0) return allErrors('empty or unusable series');
  // Evaluator precondition: series[0] IS the pick-day bar — a head-truncated
  // series (corpus hole at entry) is a data problem, not a position.
  if (bars[0].date !== row.entryDate) {
    return allErrors(`series starts ${bars[0].date} — pick-day bar ${row.entryDate} missing`);
  }

  const noFireCtx = {
    reachedExpiry: bars[bars.length - 1].date === row.expiration,
    optionType: fetched.resp.type,
    strike: row.strike,
    close: ctx.underlyingClose.get(row.expiration),
    expiration: row.expiration,
    lastBarDate: bars[bars.length - 1].date,
    lastBar: bars[bars.length - 1],
    today: ctx.today,
  };
  let sharedNoFire: AnalysisTradeRecord | undefined;
  return EXIT_STRATEGIES.map((rule) => {
    const scan = evaluateExit(bars, row.mark, rule, row.expiration);
    if (scan.fired) {
      const exitBar = bars[scan.dayIndex];
      return {
        ...base,
        exitId: rule.exitId,
        outcome: 'exit' as const,
        daysHeld: calendarDaysBetween(row.entryDate, scan.exitDate),
        exitDate: scan.exitDate,
        exitPrice: scan.exitPrice,
        mae: scan.mae,
        mfe: scan.mfe,
        terminalMark: scan.exitPrice,
        terminalDelta: exitBar.delta,
        terminalIv: exitBar.iv,
      };
    }
    sharedNoFire ??= noFireOutcome({ ...base, exitId: '' }, scan, noFireCtx);
    return { ...sharedNoFire, exitId: rule.exitId };
  });
}
