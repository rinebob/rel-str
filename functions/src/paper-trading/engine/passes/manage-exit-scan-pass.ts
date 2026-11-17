/**
 * @topic #137 — Strategy Builder UI
 * @task #1544 — BE: Exit-scan pass over position marks
 *
 * Daily pass (after the last mark tick) that evaluates every OPEN manage
 * position against the shared `EXIT_STRATEGIES` registry and persists one
 * `AnalysisResultDoc` per `(instanceId, exitId)` to
 * `st-options-analysis-results/{instanceId}_{exitId}` — the exit matrix
 * the manage page's analysis view consumes.
 *
 * v1 scope: `listActiveManageInstances` already gates to `mode:'paper'`
 * (and paper ⇒ `stopType:'ALL'`), so every registry rule runs per
 * position. The real-mode path (`stopType` → one configured rule) is a
 * schema-only future seam — the STOP_CODES vocabulary is still a
 * placeholder (`T8`), so non-paper instances evaluate nothing today.
 * New registry entries auto-apply (the pass iterates `EXIT_STRATEGIES`
 * and stamps `registryVersion`).
 *
 * Mark semantics — a position's daily "mark" is its signed cost-to-close:
 *   mark(d) = Σ_i (side_i === 'short' ? +mark_i(d) : −mark_i(d))
 * — identical to a single contract's price for one-leg positions (buy
 * back a short = +mark, sell a long = −mark). `entryMark` is the signed
 * net premium at open (credit > 0, debit < 0). The series is the
 * inner-join of the legs' SA contract series: a date missing from ANY
 * leg can't price the package and drops out. NOTE: the registry rules
 * are credit-native (`target-pct-premium` fires when the mark decays
 * toward 0) — debit entries produce mechanically-correct scans whose
 * pct thresholds read through the negative sign; a debit-aware rule
 * family is a registry-side task, not a pass concern.
 *
 * Outcome mapping mirrors `buildPickRecords`: fired → 'exit';
 * reached-expiry-bar → 'expired' (net intrinsic + max per-leg
 * assignmentDistancePct — per-leg flags generalized to the package);
 * last bar short of a still-future expiry → 'open'; truncated past
 * expiry / fetch failure / missing entry-day bar → 'error'. Positions
 * whose legs can't produce ANY net bar are skipped with a log (AC:
 * missing-marks skip).
 *
 * Series source: `callPartnerHistoricalOptionsContractV2` per leg —
 * Google-SA fetch, no RH MCP session, so the timer needs no
 * RH_CREDENTIAL_BUNDLE.
 */

import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import { db } from '../../../firebase-admin-init';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  stOptionsAnalysisResultDocId,
} from '@st/collections';
import { EXIT_REGISTRY_VERSION, EXIT_STRATEGIES } from '@options-analysis/registry';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
  ExcursionPoint,
} from '@options-analysis/contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '@options-contract/contracts';
import { evaluateExit, type ExitScanBar } from '../../../options-analysis/exit-evaluators';
import { aggregateExitType } from '../../../options-analysis/aggregate';
import { callPartnerHistoricalOptionsContractV2 } from '../../../options-contract-proxy';
import { getCachedBarsFromSymbolData } from '../../../st-cloud-function/data-loader';
import { calendarDaysBetween, getMarketDatePT } from '../../../common/pt-date-utils';
import { listActiveManageInstances } from '../manage-instance-reader';
import type { ActiveManageInstances, RunnableManageInstance } from '../manage-instance-reader';
import { listAllPositions } from '../position-repository';
import type { Position, PositionLeg } from '../types';
import { PositionStatus } from '../types';
import { strategyInstanceDailyAnalysisRef } from '../strategy-instance-repository';
import { createLogger } from '../logging';

const logger = createLogger('ManageExitScan');

// ── Types ───────────────────────────────────────────────────────────────────

/** Open position with embedded legs — `listAllPositions` spreads `legs`
 *  onto `Position` at read time (no N+1). */
export type ManageOpenPosition = Position & { legs: PositionLeg[] };

/** Per-position result — one trade record per exitId, plus the net
 *  series summary for observability. */
export interface ManageExitScanResult {
  instanceId: string;
  symbol: string;
  positionsScanned: number;
  positionsSkipped: number;
  exitsEvaluated: number;
  resultDocIds: string[];
  recordedAt: string;
}

export interface ManageExitScanDeps {
  listActiveInstances?: () => Promise<ActiveManageInstances>;
  /** Open positions with legs — default `listAllPositions` + OPEN filter. */
  listOpenPositions?: (instanceId: string) => Promise<ManageOpenPosition[]>;
  /** One leg contract's daily series — default SA partner endpoint. */
  fetchSeries?: (input: {
    symbol: string;
    contractID: string;
    startDate: string;
    endDate: string;
  }) => Promise<PartnerHistoricalOptionsContractV2Response>;
  /** Underlying daily closes for the expiry fields — default cached bars. */
  loadUnderlyingClose?: (symbol: string) => Promise<ReadonlyMap<string, number>>;
  /** Result-doc writer — default `st-options-analysis-results/{id}` set. */
  writeResultDoc?: (docId: string, doc: AnalysisResultDoc) => Promise<void>;
  /** Observability — default stamps `manageExitScanResult` on
   *  `daily-analysis/latest`. */
  writeResult?: (instanceId: string, result: ManageExitScanResult) => Promise<void>;
  now?: () => Date;
}

// ── Net series ──────────────────────────────────────────────────────────────

const signFor = (side: TradeSide): 1 | -1 => (side === TradeSide.SHORT ? 1 : -1);

const parseMark = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Signed cost-to-close at a given bar set — sum across legs. */
export function netMark(
  legs: readonly { side: TradeSide }[],
  marks: readonly number[],
): number {
  return legs.reduce((acc, leg, i) => acc + signFor(leg.side) * marks[i], 0);
}

/** Inner-join the legs' daily series into one net cost-to-close series —
 *  a date missing from any leg can't price the package and drops out.
 *  `entryMark` = signed net premium from the persisted leg premiums. */
export function buildNetSeries(
  legs: readonly PositionLeg[],
  perLegBars: ExitScanBar[][],
): ExitScanBar[] {
  if (legs.length === 0 || perLegBars.length !== legs.length) return [];
  const markByDate = perLegBars.map((bars) => new Map(bars.map((b) => [b.date, b.mark])));
  const dates = [...markByDate[0].keys()]
    .filter((d) => markByDate.every((m) => m.has(d)))
    .sort();
  return dates.map((date) => ({
    date,
    mark: legs.reduce(
      (acc, leg, i) => acc + signFor(leg.side) * (markByDate[i].get(date) as number),
      0,
    ),
  }));
}

// ── Record building ─────────────────────────────────────────────────────────

function baseRecord(
  position: ManageOpenPosition,
  instance: RunnableManageInstance,
  exitId: string,
): Omit<
  Extract<AnalysisTradeRecord, { outcome: 'exit' }>,
  'outcome' | 'exitDate' | 'exitPrice' | 'daysHeld' | 'mae' | 'mfe' | 'terminalMark'
> {
  return {
    runId: instance.id,
    symbol: instance.symbol,
    templateId: instance.variant.templateId ?? '',
    contractListDocId: instance.id,
    exitId,
    pickDate: position.openDate,
    // Multi-leg positions have no single contract — the deterministic
    // position id is the traceable identity (instance + openDate).
    contractId: position.id,
    entryMark: netMark(position.legs, position.legs.map((l) => l.premium)),
  };
}

function placeholderExcursion(entryMark: number, date: string): {
  mae: ExcursionPoint;
  mfe: ExcursionPoint;
} {
  const p = { value: entryMark, date };
  return { mae: p, mfe: { ...p } };
}

const legIntrinsic = (leg: PositionLeg, close: number): number =>
  leg.type === OptionType.PUT
    ? Math.max(leg.strike - close, 0)
    : Math.max(close - leg.strike, 0);

const legDistancePct = (leg: PositionLeg, close: number): number =>
  (Math.abs(leg.strike - close) / close) * 100;

/** Evaluate one position under one rule → one AnalysisTradeRecord. */
export function positionExitRecord(
  position: ManageOpenPosition,
  instance: RunnableManageInstance,
  exitId: string,
  rule: (typeof EXIT_STRATEGIES)[number],
  netSeries: ExitScanBar[],
  expiration: string,
  underlyingClose: ReadonlyMap<string, number>,
  today: string,
): AnalysisTradeRecord {
  const base = baseRecord(position, instance, exitId);

  if (netSeries.length === 0) {
    return {
      ...base,
      outcome: 'error',
      error: 'no net series — legs share no common mark dates',
      daysHeld: 0,
      ...placeholderExcursion(base.entryMark, base.pickDate),
    };
  }
  if (netSeries[0].date !== position.openDate) {
    return {
      ...base,
      outcome: 'error',
      error: `net series starts ${netSeries[0].date} — entry-day bar ${position.openDate} missing`,
      daysHeld: 0,
      ...placeholderExcursion(base.entryMark, base.pickDate),
    };
  }

  const scan = evaluateExit(netSeries, base.entryMark, rule, expiration);
  const lastBar = netSeries[netSeries.length - 1];

  if (scan.fired) {
    return {
      ...base,
      outcome: 'exit',
      exitDate: scan.exitDate,
      exitPrice: scan.exitPrice,
      terminalMark: scan.exitPrice,
      daysHeld: calendarDaysBetween(position.openDate, scan.exitDate),
      mae: scan.mae,
      mfe: scan.mfe,
    };
  }

  const reachedExpiry = lastBar.date === expiration;
  if (reachedExpiry) {
    const close = underlyingClose.get(expiration);
    if (close === undefined) {
      return {
        ...base,
        outcome: 'error',
        error: `underlying close missing for expiry bar ${expiration}`,
        daysHeld: 0,
        ...placeholderExcursion(base.entryMark, base.pickDate),
      };
    }
    // Net intrinsic: shorts cost their intrinsic to close, longs return
    // theirs — the package's terminal value. Per-leg ITM flags don't
    // generalize; `expiredItm` = the package expired worth something
    // (for a short-heavy structure that's the losing case).
    const intrinsic = netMark(
      position.legs,
      position.legs.map((l) => legIntrinsic(l, close)),
    );
    const distancePct = Math.max(...position.legs.map((l) => legDistancePct(l, close)));
    if (!Number.isFinite(intrinsic) || !Number.isFinite(distancePct)) {
      return {
        ...base,
        outcome: 'error',
        error: `non-finite expiry economics at close ${close}`,
        daysHeld: 0,
        ...placeholderExcursion(base.entryMark, base.pickDate),
      };
    }
    return {
      ...base,
      outcome: 'expired',
      expiredItm: intrinsic > 0,
      intrinsicAtExpiry: intrinsic,
      assignmentDistancePct: distancePct,
      // Worker convention: expired records resolve at intrinsic, not
      // the (possibly stale) expiry-bar mark.
      terminalMark: intrinsic,
      daysHeld: calendarDaysBetween(position.openDate, expiration),
      mae: scan.mae,
      mfe: scan.mfe,
    };
  }

  if (expiration > today) {
    return {
      ...base,
      outcome: 'open',
      lastBarDate: lastBar.date,
      terminalMark: lastBar.mark,
      daysHeld: calendarDaysBetween(position.openDate, lastBar.date),
      mae: scan.mae,
      mfe: scan.mfe,
    };
  }

  return {
    ...base,
    outcome: 'error',
    error: `net series truncated at ${lastBar.date} — expiry ${expiration} already passed`,
    daysHeld: 0,
    ...placeholderExcursion(base.entryMark, base.pickDate),
  };
}

// ── Pass ────────────────────────────────────────────────────────────────────

async function defaultListOpenPositions(instanceId: string): Promise<ManageOpenPosition[]> {
  const positions = (await listAllPositions(instanceId)) as ManageOpenPosition[];
  return positions.filter(
    (p) => p.status === PositionStatus.OPEN && Array.isArray(p.legs) && p.legs.length > 0,
  );
}

async function defaultWriteResultDoc(docId: string, doc: AnalysisResultDoc): Promise<void> {
  await db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT).doc(docId).set(doc);
}

async function defaultWriteResult(
  instanceId: string,
  result: ManageExitScanResult,
): Promise<void> {
  await strategyInstanceDailyAnalysisRef(instanceId, db)
    .doc('latest')
    .set({ manageExitScanResult: result }, { merge: true });
}

/** Scan one position's net series under every registry rule → records
 *  grouped per exitId. `fetchSeries` failures degrade that position to
 *  'error' records (never abort the pass). Returns null when the
 *  position can't be priced at all (missing contractID, or opened
 *  today — the EOD corpus can't carry an entry-day bar yet) so the
 *  caller logs + skips rather than writing error noise. */
export async function scanPosition(
  position: ManageOpenPosition,
  instance: RunnableManageInstance,
  rules: typeof EXIT_STRATEGIES,
  today: string,
  underlyingClose: ReadonlyMap<string, number>,
  deps: Pick<ManageExitScanDeps, 'fetchSeries'>,
): Promise<Map<string, AnalysisTradeRecord> | null> {
  const fetchSeries = deps.fetchSeries ?? callPartnerHistoricalOptionsContractV2;

  if (position.openDate >= today) return null;
  if (position.legs.some((l) => !l.contractID)) return null;

  const errorRecords = (error: string): Map<string, AnalysisTradeRecord> => {
    const out = new Map<string, AnalysisTradeRecord>();
    for (const rule of rules) {
      const base = baseRecord(position, instance, rule.exitId);
      out.set(rule.exitId, {
        ...base,
        outcome: 'error',
        error,
        daysHeld: 0,
        ...placeholderExcursion(base.entryMark, base.pickDate),
      });
    }
    return out;
  };

  const expiration = position.legs.reduce(
    (min, l) => (l.expiration < min ? l.expiration : min),
    position.legs[0].expiration,
  );
  // Multi-expiry structures (calendar/diagonal) aren't expressible in
  // the terminal-value model — intrinsic of a still-open far leg isn't
  // its expiry-day worth. Same-expiry legs only for v1.
  if (position.legs.some((l) => l.expiration !== expiration)) {
    return errorRecords('multi-expiry position — unsupported in v1');
  }
  const endBound = expiration < today ? expiration : today;

  const perLegBars: ExitScanBar[][] = [];
  for (const leg of position.legs) {
    let resp: PartnerHistoricalOptionsContractV2Response;
    try {
      resp = await fetchSeries({
        symbol: position.symbol,
        contractID: leg.contractID as string,
        startDate: position.openDate,
        endDate: endBound,
      });
    } catch {
      return errorRecords('leg series fetch failed');
    }
    if (resp.ok === false) return errorRecords('leg series fetch returned ok:false');
    perLegBars.push(
      (resp.series ?? [])
        .map((o) => ({ date: o.date.slice(0, 10), mark: parseMark(o.mark) }))
        .filter(
          (b): b is { date: string; mark: number } =>
            b.mark !== undefined && b.date >= position.openDate && b.date <= endBound,
        ),
    );
  }

  const netSeries = buildNetSeries(position.legs, perLegBars);
  const out = new Map<string, AnalysisTradeRecord>();
  for (const rule of rules) {
    out.set(
      rule.exitId,
      positionExitRecord(
        position,
        instance,
        rule.exitId,
        rule,
        netSeries,
        expiration,
        underlyingClose,
        today,
      ),
    );
  }
  return out;
}

/** Per-instance body — a failure here must not abort the day's scan for
 *  the remaining instances (the once-daily timer has no retry). */
async function scanInstance(
  instance: RunnableManageInstance,
  marketDate: string,
  deps: Required<
    Pick<
      ManageExitScanDeps,
      'listOpenPositions' | 'loadUnderlyingClose' | 'writeResultDoc' | 'writeResult' | 'now'
    >
  > &
    Pick<ManageExitScanDeps, 'fetchSeries'>,
): Promise<void> {
  // v1 paper-only: the reader already gates modes — a non-paper
  // instance here means a direct/manual invocation; the real-mode
  // stopType→rule mapping is a v2 seam (STOP_CODES is a placeholder).
  const rules = instance.mode === 'paper' ? EXIT_STRATEGIES : [];
  if (rules.length === 0) {
    logger.warn(`exit-scan ${instance.id}: non-paper mode — no rules evaluated (v2 seam)`);
    return;
  }

  const positions = await deps.listOpenPositions(instance.id);
  const underlyingClose = await deps.loadUnderlyingClose(instance.symbol);
  if (underlyingClose.size === 0) {
    logger.warn(`exit-scan ${instance.id}: no underlying closes — expired outcomes degrade to error`);
  }
  const recordsByExit = new Map<string, AnalysisTradeRecord[]>(
    rules.map((r) => [r.exitId, []]),
  );
  let skipped = 0;
  for (const position of positions) {
    try {
      const records = await scanPosition(
        position,
        instance,
        rules,
        marketDate,
        underlyingClose,
        deps,
      );
      if (records === null) {
        logger.warn(
          `exit-scan ${instance.id}: position ${position.id} skipped — opened today or missing leg contractID`,
        );
        skipped++;
        continue;
      }
      for (const [exitId, rec] of records) recordsByExit.get(exitId)?.push(rec);
    } catch (e) {
      logger.warn(
        `exit-scan ${instance.id}: position ${position.id} scan failed — ${e instanceof Error ? e.message : String(e)}`,
      );
      skipped++;
    }
  }

  const generatedAt = deps.now().toISOString();
  const docIds: string[] = [];
  for (const rule of rules) {
    const docId = stOptionsAnalysisResultDocId(instance.id, rule.exitId);
    const records = recordsByExit.get(rule.exitId) ?? [];
    await deps.writeResultDoc(docId, {
      contractListDocId: instance.id,
      runId: instance.id,
      symbol: instance.symbol,
      templateId: instance.variant.templateId,
      exitId: rule.exitId,
      registryVersion: EXIT_REGISTRY_VERSION,
      status: 'success',
      trades: records,
      aggregate: aggregateExitType(rule.exitId, positions.length - skipped, records),
      generatedAt,
    });
    docIds.push(docId);
  }

  try {
    await deps.writeResult(instance.id, {
      instanceId: instance.id,
      symbol: instance.symbol,
      positionsScanned: positions.length - skipped,
      positionsSkipped: skipped,
      exitsEvaluated: rules.length,
      resultDocIds: docIds,
      recordedAt: generatedAt,
    });
  } catch (e) {
    logger.warn(`exit-scan ${instance.id}: result write failed — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The pass — every ACTIVE manage instance → open positions → one
 *  result doc per (instance, exitId). */
export async function runManageExitScan(
  marketDate: string,
  deps: ManageExitScanDeps = {},
): Promise<void> {
  const listActive = deps.listActiveInstances ?? listActiveManageInstances;
  const resolved = {
    listOpenPositions: deps.listOpenPositions ?? defaultListOpenPositions,
    loadUnderlyingClose:
      deps.loadUnderlyingClose ??
      (async (symbol: string) => {
        const { dailyBars } = await getCachedBarsFromSymbolData(symbol, getMarketDatePT());
        return new Map<string, number>(dailyBars.map((b) => [b.d, b.c]));
      }),
    writeResultDoc: deps.writeResultDoc ?? defaultWriteResultDoc,
    writeResult: deps.writeResult ?? defaultWriteResult,
    now: deps.now ?? (() => new Date()),
    fetchSeries: deps.fetchSeries,
  };

  const instances = await listActive();
  for (const instance of [...instances.daily, ...instances.signal]) {
    try {
      await scanInstance(instance, marketDate, resolved);
    } catch (e) {
      logger.warn(
        `exit-scan ${instance.id}: instance scan failed — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
