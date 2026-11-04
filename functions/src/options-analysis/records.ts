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
 *  bounded to [entryDate, expiration], sorted ascending. */
export function toScanBars(
  observations: HistoricalOptionsContractV2Observation[],
  entryDate: string,
  expiration: string,
): ExitScanBar[] {
  return observations
    .map((o) => ({ date: o.date.slice(0, 10), mark: o.mark?.trim() ? Number(o.mark) : NaN }))
    .filter(
      (b) =>
        Number.isFinite(b.mark) && b.date >= entryDate && b.date <= expiration,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
  },
): AnalysisTradeRecord {
  if (!ctx.reachedExpiry) {
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
  return {
    ...seed,
    outcome: 'expired',
    daysHeld: calendarDaysBetween(seed.pickDate, ctx.expiration),
    mae: scan.mae,
    mfe: scan.mfe,
    ...expiredFields(ctx.optionType, ctx.strike, ctx.close),
  };
}

/** One pick row → one record per registered exit, in registry order.
 *  `fetched` is the pick's SA response or its fetch error; records are
 *  distributed by the caller into per-exit buckets by array position. */
export function buildPickRecords(
  row: ContractListPickRow,
  fetched: { resp?: PartnerHistoricalOptionsContractV2Response; error?: string },
  ctx: { underlyingClose: ReadonlyMap<string, number>; base: RecordBase },
): AnalysisTradeRecord[] {
  const base: Omit<RecordSeed, 'exitId'> = {
    ...ctx.base,
    pickDate: row.entryDate,
    contractId: row.contractId,
    entryMark: row.mark,
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
  };
  let sharedNoFire: AnalysisTradeRecord | undefined;
  return EXIT_STRATEGIES.map((rule) => {
    const scan = evaluateExit(bars, row.mark, rule, row.expiration);
    if (scan.fired) {
      return {
        ...base,
        exitId: rule.exitId,
        outcome: 'exit' as const,
        daysHeld: calendarDaysBetween(row.entryDate, scan.exitDate),
        exitDate: scan.exitDate,
        exitPrice: scan.exitPrice,
        mae: scan.mae,
        mfe: scan.mfe,
      };
    }
    sharedNoFire ??= noFireOutcome({ ...base, exitId: '' }, scan, noFireCtx);
    return { ...sharedNoFire, exitId: rule.exitId };
  });
}
