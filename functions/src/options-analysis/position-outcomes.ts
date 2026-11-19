/**
 * `position-outcomes.ts` — the shared non-fired outcome + record
 * scaffolding `records.ts` maps one position row through (Topic
 * #1238, Thread #1266, task #1372; multi-leg extension #1500).
 *
 * Rule-invariant outcomes (fetch failure on ANY leg, unusable/
 * truncated series, unpriceable settlement) short-circuit to an
 * 'error' under every exitId; non-fired rules share the position's
 * single expired/open/error outcome — no-fire excursions span the
 * same full window for all rules, so the only per-rule variance is
 * `exitId`.
 */

import { calendarDaysBetween } from '../common/pt-date-utils';
import type { ContractListPositionRow } from '@options-replay/contracts';
import type {
  AnalysisErrorTrade,
  AnalysisTradeRecord,
} from '@options-analysis/contracts';
import type { ExitScanBar, ExitScanResult } from './exit-evaluators';
import { signFor } from './position-net';

const placeholderExcursion = (entryMark: number, pickDate: string) => ({
  mae: { value: entryMark, date: pickDate },
  mfe: { value: entryMark, date: pickDate },
});

/** Everything a record needs besides outcome/excursion — mirrors the
 *  (unexported) AnalysisTradeBase contract fields. */
export interface RecordSeed {
  runId: string;
  symbol: string;
  templateId: string;
  contractListDocId: string;
  exitId: string;
  pickDate: string;
  contractId: string;
  entryMark: number;
  /** Pick-day NET greeks — signed like the mark (posture-normalized
   *  space, see records.ts). Absent when any leg can't contribute the
   *  field (a stock leg has no iv → the position's entryIv is absent,
   *  never fabricated). */
  entryDelta?: number;
  entryIv?: number;
}

/** Run-level slice keys shared by every record in a task. */
export type RecordBase = Pick<
  RecordSeed,
  'runId' | 'symbol' | 'templateId' | 'contractListDocId'
>;

/** Error records carry the entry-day placeholder excursion + daysHeld 0
 *  per the AnalysisErrorTrade contract. */
export function errorRecord(seed: RecordSeed, error: string): AnalysisErrorTrade {
  return {
    ...seed,
    outcome: 'error',
    daysHeld: 0,
    ...placeholderExcursion(seed.entryMark, seed.pickDate),
    error,
  };
}

/** Per-leg expiry economics — intrinsic + distance-to-money computed
 *  once per option leg at ITS OWN expiry (legs may die on different
 *  dates). A stock leg's "settlement" at position expiry is just its
 *  close. */
export interface LegSettlement {
  intrinsic: number;
  distancePct: number;
}

/** 'expired' inputs for one option leg — type from the SA response
 *  (authoritative), strike from the leg, close at the leg's OWN expiry.
 *  Returns `ok: false` as the unusable-type sentinel — callers convert
 *  to an 'error' record, never fabricate. */
export function legIntrinsic(
  type: unknown,
  strike: number,
  underlyingClose: number,
): { ok: true; value: LegSettlement } | { ok: false } {
  if (type !== 'call' && type !== 'put') return { ok: false };
  const intrinsicAtExpiry =
    type === 'put'
      ? Math.max(strike - underlyingClose, 0)
      : Math.max(underlyingClose - strike, 0);
  return {
    ok: true,
    value: {
      intrinsic: intrinsicAtExpiry,
      distancePct: (Math.abs(strike - underlyingClose) / underlyingClose) * 100,
    },
  };
}

/** The shared outcome every non-fired rule lands on for one position —
 *  computed once per position. Mirrors the v1 single-contract mapping:
 *  'expired' requires the net series to reach the position's LAST leg
 *  expiry; a series ending short of a FUTURE max expiry is 'open';
 *  truncated past-expiry / unpriceable settlement is 'error'. Position
 *  `expired` fields are net semantics in the posture-normalized space —
 *  `intrinsicAtExpiry` is the signed net settlement, `expiredItm` =
 *  the position settled with value (for a 1-leg pick exactly the v1
 *  ITM test, either side), `assignmentDistancePct` = the CLOSEST leg's
 *  distance-to-money at its own expiry (1-leg → the v1 value verbatim;
 *  NB the manage-exit-scan pass takes the FARTHEST leg — see #1500
 *  code review, one convention has to win). */
export function positionNoFireOutcome(
  seed: RecordSeed,
  scan: ExitScanResult,
  ctx: {
    netBars: readonly ExitScanBar[];
    legs: ContractListPositionRow['legs'];
    /** Settlements computed during leg-input construction for legs
     *  whose expiry precedes the position max (their frozenMark). */
    settlements: readonly (LegSettlement | undefined)[];
    optionTypes: readonly (unknown | undefined)[];
    maxExpiry: string;
    /** −1 flips the settlement into the record's posture space —
     *  debit positions evaluate on their negated cost-to-close. */
    postureSign: 1 | -1;
    underlyingClose: ReadonlyMap<string, number>;
    today: string;
  },
): AnalysisTradeRecord {
  const lastBar = ctx.netBars[ctx.netBars.length - 1];
  const reachedExpiry = lastBar.date === ctx.maxExpiry;
  if (!reachedExpiry) {
    // #1431 parity — see the v1 notes: a net series ending short of a
    // FUTURE last-expiry is a live position; truncated past-expiry is
    // a data problem.
    if (ctx.maxExpiry > ctx.today) {
      return {
        ...seed,
        outcome: 'open',
        daysHeld: calendarDaysBetween(seed.pickDate, lastBar.date),
        mae: scan.mae,
        mfe: scan.mfe,
        lastBarDate: lastBar.date,
        terminalMark: lastBar.mark,
        terminalDelta: lastBar.delta,
        terminalIv: lastBar.iv,
      };
    }
    return errorRecord(
      seed,
      `series ends ${lastBar.date} before expiry ${ctx.maxExpiry}`,
    );
  }
  // 'expired' — signed net settlement across legs (cost-to-close
  // space, flipped by postureSign below). Legs that died early reuse
  // their frozen settlement; legs at maxExpiry (and stock legs)
  // resolve against the close at maxExpiry.
  let netIntrinsic = 0;
  let minDistancePct: number | undefined;
  for (let i = 0; i < ctx.legs.length; i++) {
    const leg = ctx.legs[i];
    const sign = signFor(leg.side);
    if (leg.kind === 'stock') {
      const close = ctx.underlyingClose.get(ctx.maxExpiry);
      if (close === undefined) {
        return errorRecord(seed, `no underlying close at expiry ${ctx.maxExpiry}`);
      }
      netIntrinsic += sign * close;
      continue;
    }
    let settled = ctx.settlements[i];
    if (!settled) {
      // Leg expires at the position's last expiry — its frozenMark was
      // never needed, so its settlement is computed now.
      const close = ctx.underlyingClose.get(leg.expiration);
      if (close === undefined) {
        return errorRecord(seed, `no underlying close at expiry ${leg.expiration}`);
      }
      const r = legIntrinsic(ctx.optionTypes[i], leg.strike, close);
      if (!r.ok) {
        return errorRecord(seed, `leg ${i} upstream option type '${String(ctx.optionTypes[i])}' unusable`);
      }
      settled = r.value;
    }
    netIntrinsic += sign * settled.intrinsic;
    if (minDistancePct === undefined || settled.distancePct < minDistancePct) {
      minDistancePct = settled.distancePct;
    }
  }
  if (minDistancePct === undefined) {
    // Unreachable — 'expired' implies ≥1 option leg — but the
    // no-fabrication rule bars a silent default.
    return errorRecord(seed, 'expired position with no option-leg settlement');
  }
  const intrinsic = ctx.postureSign * netIntrinsic;
  return {
    ...seed,
    outcome: 'expired',
    daysHeld: calendarDaysBetween(seed.pickDate, ctx.maxExpiry),
    mae: scan.mae,
    mfe: scan.mfe,
    expiredItm: intrinsic > 0,
    intrinsicAtExpiry: intrinsic,
    assignmentDistancePct: minDistancePct,
    // The settled net mark is the terminal economics — matches the mark
    // change the FE derives; greeks come off the expiry bar itself.
    terminalMark: intrinsic,
    terminalDelta: lastBar.delta,
    terminalIv: lastBar.iv,
  };
}
