/**
 * `records.ts` — pure record construction for `optionsReplayAnalysis`
 * (Topic #1238, Thread #1266, task #1372; multi-leg extension #1500).
 *
 * One position row → one `AnalysisTradeRecord` per registered exit, in
 * registry order (`buildPositionRecords`). Rule-invariant outcomes
 * (fetch failure on ANY leg, unusable/truncated series, unpriceable
 * settlement) short-circuit to an 'error' under every exitId; a fired
 * rule gets its own 'exit' record while non-fired rules share the
 * position's single expired/open/error outcome (position-outcomes.ts).
 *
 * Posture normalization — the registry's exits are premium-decay
 * rules: they only read sensibly on a mark that starts positive and
 * decays toward 0. Legs sign in cost-to-close space (SHORT +mark,
 * LONG −mark — the #1544 manage-pass convention), so a CREDIT
 * position's net mark is already positive-decaying while a DEBIT
 * position's is negative. `postureSign` (entryMark < 0 → −1) flips
 * the whole analysis for debit positions onto their liquidation
 * value — a long option held as its value decays to ~0 trips the
 * same "premium decayed X%" boundary a short position's capture
 * does. The IMPL's literal `Σ long − Σ short` is equivalent under
 * this normalization; either raw formula alone breaks one posture.
 * v1 pick docs are all-short → postureSign = 1 → byte-parity.
 */

import { calendarDaysBetween } from '../common/pt-date-utils';
import { EXIT_STRATEGIES } from '@options-analysis/registry';
import type {
  ContractListPositionRow,
  PositionOptionLeg,
} from '@options-replay/contracts';
import type { AnalysisTradeRecord } from '@options-analysis/contracts';
import type {
  HistoricalOptionsContractV2Observation,
  PartnerHistoricalOptionsContractV2Response,
} from '@options-contract/contracts';
import { evaluateExit, type ExitScanBar } from './exit-evaluators';
import {
  buildPositionNetSeries,
  signFor,
  type PositionLegDay,
  type PositionLegInput,
} from './position-net';
import {
  errorRecord,
  legIntrinsic,
  positionNoFireOutcome,
  type LegSettlement,
  type RecordBase,
  type RecordSeed,
} from './position-outcomes';

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

/** What the worker hands back for one leg — the SA response or its
 *  fetch error; `undefined` on stock legs (no fetch). */
export type LegFetchResult =
  | { resp?: PartnerHistoricalOptionsContractV2Response; error?: string }
  | undefined;

/** One position row → one record per registered exit, in registry
 *  order. `legFetched[i]` aligns with `row.legs[i]`; records are
 *  distributed by the caller into per-exit buckets by array position. */
export function buildPositionRecords(
  row: ContractListPositionRow,
  legFetched: readonly LegFetchResult[],
  ctx: { underlyingClose: ReadonlyMap<string, number>; base: RecordBase; today: string },
): AnalysisTradeRecord[] {
  const optionLegs = row.legs
    .map((leg, i) => ({ leg, i }))
    .filter((x): x is { leg: PositionOptionLeg; i: number } => x.leg.kind === 'option');
  const maxExpiry = optionLegs.reduce(
    (m, { leg }) => (leg.expiration > m ? leg.expiration : m),
    '',
  );

  // Entry-day net fields (cost-to-close space) — computed from the
  // row's own leg data, so error records carry real entry economics
  // like v1.
  let entryMark = 0;
  let entryDelta = 0;
  let entryIv = 0;
  let ivOk = true;
  for (const leg of row.legs) {
    const sign = signFor(leg.side);
    if (leg.kind === 'option') {
      entryMark += sign * leg.mark;
      entryDelta += sign * leg.delta;
      entryIv += sign * leg.iv;
    } else {
      entryMark += sign * leg.underlyingClose;
      entryDelta += sign * 1; // a share of stock has delta 1
      ivOk = false; // stock carries no iv → the net field is absent
    }
  }
  // Debit posture → flip the whole analysis onto liquidation value so
  // the premium-decay rules evaluate a positive-decaying series (see
  // header). Everything downstream — bars, entry fields, settlement —
  // lives in this normalized space.
  const postureSign: 1 | -1 = entryMark < 0 ? -1 : 1;
  const base: Omit<RecordSeed, 'exitId'> = {
    ...ctx.base,
    pickDate: row.entryDate,
    contractId: optionLegs.map(({ leg }) => leg.contractId).join('+'),
    entryMark: postureSign * entryMark,
    entryDelta: postureSign * entryDelta,
    ...(ivOk && { entryIv: postureSign * entryIv }),
  };
  const allErrors = (error: string) =>
    EXIT_STRATEGIES.map((rule) => errorRecord({ ...base, exitId: rule.exitId }, error));

  if (optionLegs.length === 0) {
    return allErrors('position has no option leg — nothing to price');
  }

  // Per-leg live maps + frozen settlements. Option legs bound to their
  // OWN expiry; stock legs mark at the underlying close through the
  // position's last expiry.
  const legInputs: PositionLegInput[] = [];
  const settlements: (LegSettlement | undefined)[] = [];
  const optionTypes: (unknown | undefined)[] = [];
  for (let i = 0; i < row.legs.length; i++) {
    const leg = row.legs[i];
    optionTypes.push(undefined);
    settlements.push(undefined);
    if (leg.kind === 'stock') {
      const live = new Map<string, PositionLegDay>();
      for (const [d, c] of ctx.underlyingClose) {
        if (d >= row.entryDate && d <= maxExpiry) {
          live.set(d, { mark: c, delta: 1 });
        }
      }
      legInputs.push({ side: leg.side, live });
      continue;
    }
    const fetched = legFetched[i];
    if (!fetched || fetched.error || !fetched.resp?.ok) {
      return allErrors(
        `leg ${i} series fetch failed: ${fetched?.error ?? 'upstream response not ok'}`,
      );
    }
    const bars = toScanBars(fetched.resp.series ?? [], row.entryDate, leg.expiration);
    if (bars.length === 0) return allErrors(`leg ${i} empty or unusable series`);
    // Evaluator precondition (v1 parity): series[0] IS the pick-day bar
    // — a head-truncated leg series is a data problem, not a position.
    if (bars[0].date !== row.entryDate) {
      return allErrors(
        `leg ${i} series starts ${bars[0].date} — pick-day bar ${row.entryDate} missing`,
      );
    }
    const input: PositionLegInput = {
      side: leg.side,
      expiry: leg.expiration,
      live: new Map(
        bars.map((b) => [b.date, { mark: b.mark, delta: b.delta, iv: b.iv }]),
      ),
    };
    optionTypes[i] = fetched.resp.type;
    // Legs dying before the last expiry need their frozen settlement —
    // computed eagerly so an unpriceable settlement is a loud error,
    // not a silently dropped tail.
    if (leg.expiration < maxExpiry) {
      const close = ctx.underlyingClose.get(leg.expiration);
      if (close === undefined) {
        return allErrors(`leg ${i} no underlying close at expiry ${leg.expiration}`);
      }
      const r = legIntrinsic(fetched.resp.type, leg.strike, close);
      if (!r.ok) {
        return allErrors(`leg ${i} upstream option type '${String(fetched.resp.type)}' unusable`);
      }
      input.frozenMark = r.value.intrinsic;
      settlements[i] = r.value;
    }
    legInputs.push(input);
  }

  const costToCloseBars = buildPositionNetSeries(legInputs, maxExpiry);
  if (costToCloseBars.length === 0) return allErrors('empty or unusable position series');
  // Same precondition as v1, position level: a missing entry-day bar
  // (e.g., a stock leg with no close at entry) is a data problem.
  if (costToCloseBars[0].date !== row.entryDate) {
    return allErrors(
      `position series starts ${costToCloseBars[0].date} — pick-day bar ${row.entryDate} missing`,
    );
  }
  const netBars =
    postureSign === 1
      ? costToCloseBars
      : costToCloseBars.map((b) => ({
          ...b,
          mark: -b.mark,
          ...(b.delta !== undefined && { delta: -b.delta }),
          ...(b.iv !== undefined && { iv: -b.iv }),
        }));
  const evalEntryMark = base.entryMark;

  const noFireCtx = {
    netBars,
    legs: row.legs,
    settlements,
    optionTypes,
    maxExpiry,
    postureSign,
    underlyingClose: ctx.underlyingClose,
    today: ctx.today,
  };
  let sharedNoFire: AnalysisTradeRecord | undefined;
  return EXIT_STRATEGIES.map((rule) => {
    const scan = evaluateExit(netBars, evalEntryMark, rule, maxExpiry);
    if (scan.fired) {
      const exitBar = netBars[scan.dayIndex];
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
    sharedNoFire ??= positionNoFireOutcome({ ...base, exitId: '' }, scan, noFireCtx);
    return { ...sharedNoFire, exitId: rule.exitId };
  });
}
