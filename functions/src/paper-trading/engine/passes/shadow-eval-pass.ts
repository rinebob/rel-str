/**
 * @topic #137 — Strategy Manager (task #1713)
 *
 * Per-tick shadow exit-eval — the intraday counterpart to the 2 PM
 * `manage-exit-scan` EOD scan. On each unified mark-pass tick, every
 * successfully-marked OPEN option position carrying a `strategyInstanceId`
 * is evaluated against all `EXIT_STRATEGIES` on the tick's fresh
 * order-exit-price mark (`marks[date].mark` space — the price eval/
 * settlement consumes, posture-normalized so a LONG order's debit reads
 * positive like its fill price).
 *
 * Accumulation contract — merge-writes into the SAME
 * `st-options-analysis-results/{instanceId}_{exitId}` docs the EOD scan
 * owns, never clobbering its shape:
 * - `firstFiredAt` (ISO tick timestamp — intraday grain vs the record's
 *   day-grain exitDate) + `firstFiredMark` stamp on the tick a rule first
 *   fires and are sticky thereafter (idempotent re-runs, restart-safe).
 * - Terminal outcomes ('exit'/'expired') are frozen — a fired rule stays
 *   fired even if the mark recovers; the scan's expired verdict stands.
 * - Live records ('open') refresh each tick: terminalMark/lastBarDate/
 *   daysHeld update and mae/mfe fold the new mark across ticks.
 * - Records for positions not marked this tick carry forward verbatim.
 *
 * Analytics only — nothing here ever closes a position (options run to
 * expiry, exits are shadow measurement). Positions with no
 * `strategyInstanceId` (legacy/signal era) mark but don't eval — they
 * have no matrix to key under.
 *
 * v1 caveats shared with the EOD scan: credit-native registry rules read
 * through the sign on debit structures — and the two writers' sign spaces
 * differ (scan records carry signed netMark, tick records the posture-
 * normalized order price), so scan-seeded mae/mfe on a debit position can
 * fold opposite-sign tick marks until the afternoon rebuild corrects them;
 * multi-expiry positions produce error records; positions with share legs
 * (covered calls) are skipped outright for scan parity.
 */

import type { PaperTrade } from '@paper-trading/contracts';
import { EXIT_REGISTRY_VERSION, EXIT_STRATEGIES } from '@options-analysis/registry';
import type { ExitStrategyDef } from '@options-analysis/registry';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
  ExcursionPoint,
} from '@options-analysis/contracts';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  stOptionsAnalysisResultDocId,
} from '@st/collections';
import { entryNetMark } from '@options/position-math';
import { db, FieldValue } from '../../../firebase-admin-init';
import { evaluateExit } from '../../../options-analysis/exit-evaluators';
import { aggregateExitType } from '../../../options-analysis/aggregate';
import {
  calendarDaysBetween,
  getMarketDatePT,
  normalizeMarketDate,
} from '../../../common/pt-date-utils';
import { orderPriceForLiquidationValue } from '../../ledger';
import { createLogger } from '../logging';

const logger = createLogger('ShadowEval');

// ── Types ───────────────────────────────────────────────────────────────────

/** One position marked this tick — `mark` is the order-level exit price
 *  the mark pass just stamped (`marks[date].mark` space). */
export interface ShadowEvalPositionInput {
  trade: PaperTrade;
  mark: number;
}

export interface ShadowEvalDeps {
  rules?: readonly ExitStrategyDef[];
  /** Result-doc reader — default `st-options-analysis-results/{id}` get. */
  readResultDoc?: (docId: string) => Promise<AnalysisResultDoc | null>;
  /** Result-doc merge-writer — default `set(doc, {merge:true})`. */
  writeResultDoc?: (docId: string, doc: AnalysisResultDoc) => Promise<void>;
  now?: () => Date;
  /** PT market date (YYYY-MM-DD) the tick's marks belong to — day-grain
   *  for exitDate/lastBarDate/excursion dates. Default today PT. */
  marketDate?: string;
}

export interface ShadowEvalSummary {
  /** Positions evaluated (had a strategyInstanceId). */
  positions: number;
  /** Position×rule evaluations performed this tick. */
  evaluated: number;
  /** New first-fires stamped this tick. */
  fires: number;
  /** OPEN option positions skipped — no strategyInstanceId (legacy/signal). */
  skippedNoInstance: number;
  /** Positions skipped — share legs present (scan parity: covered calls
   *  aren't expressible in the option-only terminal-value model). */
  skippedNonOption: number;
  /** Analysis docs merge-written this tick. */
  docsWritten: number;
  errors: { docId?: string; positionId?: string; error: string }[];
}

interface EvalContext {
  marketDate: string;
  tickAt: string;
}

// ── Record building ─────────────────────────────────────────────────────────

/** Entry fill's market date → leg openDate → doc createdAt. */
function pickDateOf(trade: PaperTrade): string {
  const entry = trade.fills.find((f) => f.role === 'entry');
  if (entry?.date) return entry.date.slice(0, 10);
  const legDate = trade.legs
    .map((l) => l.openDate)
    .filter((d): d is string => typeof d === 'string')
    .sort()[0];
  return legDate ?? trade.createdAt.slice(0, 10);
}

function baseRecord(
  trade: PaperTrade,
  instanceId: string,
  exitId: string,
  entryMark: number,
  pickDate: string,
): Omit<AnalysisTradeRecord, 'outcome' | 'daysHeld' | 'mae' | 'mfe'> {
  return {
    runId: instanceId,
    symbol: trade.symbol,
    templateId: trade.expression.toLowerCase(),
    contractListDocId: instanceId,
    exitId,
    pickDate,
    // Multi-leg positions have no single contract — the deterministic
    // position id is the traceable identity (instance + openDate).
    contractId: trade.id,
    entryMark,
  };
}

/** Sticky first-fire fields — carried onto rebuilt records so neither the
 *  EOD rewrite nor a later tick erases intraday evidence. A malformed prior
 *  carrying firstFiredAt without firstFiredMark omits the mark rather than
 *  writing undefined (Firestore rejects undefined fields on set). */
function carryFirstFire(
  prior: AnalysisTradeRecord | undefined,
): Pick<AnalysisTradeRecord, 'firstFiredAt' | 'firstFiredMark'> {
  if (prior?.firstFiredAt === undefined) return {};
  return {
    firstFiredAt: prior.firstFiredAt,
    ...(prior.firstFiredMark !== undefined
      ? { firstFiredMark: prior.firstFiredMark }
      : {}),
  };
}

function errorRecord(
  base: ReturnType<typeof baseRecord>,
  error: string,
  prior: AnalysisTradeRecord | undefined,
): AnalysisTradeRecord {
  const placeholder = { value: base.entryMark, date: base.pickDate };
  return {
    ...base,
    outcome: 'error',
    error,
    daysHeld: 0,
    mae: prior?.mae ?? placeholder,
    mfe: prior?.mfe ?? placeholder,
    ...carryFirstFire(prior),
  };
}

/** Fold one tick mark into the running excursion — first occurrence wins
 *  ties (strict >/< keeps the earliest extreme's date). */
function foldExcursion(
  mae: ExcursionPoint,
  mfe: ExcursionPoint,
  mark: number,
  marketDate: string,
): { mae: ExcursionPoint; mfe: ExcursionPoint } {
  return {
    mae: mark > mae.value ? { value: mark, date: marketDate } : mae,
    mfe: mark < mfe.value ? { value: mark, date: marketDate } : mfe,
  };
}

/** Evaluate one marked position under one rule → the record to upsert.
 *  `prior` is the record already in the doc (from earlier ticks or the
 *  EOD scan) — terminal outcomes and first-fire fields are sticky. */
export function evalPositionRule(
  input: ShadowEvalPositionInput,
  instanceId: string,
  rule: ExitStrategyDef,
  prior: AnalysisTradeRecord | undefined,
  ctx: EvalContext,
): { record: AnalysisTradeRecord | null; newFire: boolean } {
  const { trade, mark } = input;

  // Terminal outcomes are sticky — a fired/stamped record is the rule's
  // settled opinion; a later tick never resurrects it.
  if (prior?.outcome === 'exit' || prior?.outcome === 'expired') {
    return { record: prior, newFire: false };
  }

  const optionLegs = trade.legs.filter((l) => l.kind === 'option');
  const pickDate = pickDateOf(trade);
  const entryNet = entryNetMark(
    trade.legs.map((l) => ({
      side: l.side,
      mark: l.entryMark,
      multiplier: l.multiplier,
      quantity: l.quantity,
    })),
  );
  const entryMark =
    entryNet === undefined
      ? undefined
      : orderPriceForLiquidationValue(entryNet, trade.order, trade.legs);
  const base = baseRecord(trade, instanceId, rule.exitId, entryMark ?? NaN, pickDate);

  if (optionLegs.length === 0) {
    return {
      record: errorRecord(base, 'no option legs — nothing to eval', prior),
      newFire: false,
    };
  }
  if (entryMark === undefined || !Number.isFinite(entryMark)) {
    return {
      record: errorRecord(base, 'missing entry mark — legs unpriceable at open', prior),
      newFire: false,
    };
  }
  const expiration = optionLegs.reduce(
    (min, l) => (l.expiration < min ? l.expiration : min),
    optionLegs[0].expiration,
  );
  // Same v1 bound as the EOD scan — intrinsic of a still-open far leg
  // isn't expressible in the terminal-value model.
  if (optionLegs.some((l) => l.expiration !== expiration)) {
    return {
      record: errorRecord(base, 'multi-expiry position — unsupported in v1', prior),
      newFire: false,
    };
  }
  // Settlement owns the position past expiry — a tick that lands after
  // expiration (settlement is nightly, so an open trade can linger a day)
  // must not stamp an 'open' record whose lastBarDate postdates expiry.
  // Carry the prior; with no prior, write nothing (null skips the upsert).
  if (ctx.marketDate > expiration) {
    return { record: prior ?? null, newFire: false };
  }

  const daysHeld = calendarDaysBetween(pickDate, ctx.marketDate);
  const seed = {
    mae: prior?.mae ?? { value: entryMark, date: pickDate },
    mfe: prior?.mfe ?? { value: entryMark, date: pickDate },
  };
  const { mae, mfe } = foldExcursion(seed.mae, seed.mfe, mark, ctx.marketDate);

  // Point-fire check through the shared evaluator — a 1-bar synthetic
  // series keeps every threshold/EPS/comparison in one place.
  const scan = evaluateExit(
    [{ date: ctx.marketDate, mark }],
    entryMark,
    rule,
    expiration,
  );

  if (scan.fired) {
    // firstFired* preserves any earlier intraday fire — the EOD scan can
    // rewrite outcome back to 'open' (its daily series never crossed) while
    // carrying first-fire forward; a re-cross must not stamp a second
    // "first" fire. The exit resolves at the original fire's date+mark and
    // the record freezes at the pre-rewrite excursion state.
    const firedAt = prior?.firstFiredAt;
    const exitDate =
      firedAt !== undefined ? normalizeMarketDate(firedAt) : ctx.marketDate;
    return {
      record: {
        ...base,
        outcome: 'exit',
        exitDate,
        exitPrice: prior?.firstFiredMark ?? mark,
        terminalMark: prior?.firstFiredMark ?? mark,
        daysHeld: calendarDaysBetween(pickDate, exitDate),
        mae: prior?.mae ?? mae,
        mfe: prior?.mfe ?? mfe,
        firstFiredAt: firedAt ?? ctx.tickAt,
        firstFiredMark: prior?.firstFiredMark ?? mark,
      },
      newFire: firedAt === undefined,
    };
  }

  return {
    record: {
      ...base,
      outcome: 'open',
      lastBarDate: ctx.marketDate,
      terminalMark: mark,
      daysHeld,
      mae,
      mfe,
      ...carryFirstFire(prior),
    },
    newFire: false,
  };
}

// ── Pass ────────────────────────────────────────────────────────────────────

async function defaultReadResultDoc(docId: string): Promise<AnalysisResultDoc | null> {
  const snap = await db.collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT).doc(docId).get();
  return snap.exists ? (snap.data() as AnalysisResultDoc) : null;
}

async function defaultWriteResultDoc(docId: string, doc: AnalysisResultDoc): Promise<void> {
  await db
    .collection(ST_OPTIONS_ANALYSIS_RESULTS_ROOT)
    .doc(docId)
    // merge keeps forward-compat fields the tick doesn't know about; the
    // delete sentinel clears a stale `error` left by a failed doc.
    .set({ ...doc, error: FieldValue.delete() }, { merge: true });
}

/** One mark-pass tick of shadow eval — merge position×rule records into
 *  the per-(instance × exitId) analysis docs. Read-once-per-doc, all of an
 *  instance's positions merged in memory, one write per doc. */
export async function runShadowEvalTick(
  positions: readonly ShadowEvalPositionInput[],
  deps: ShadowEvalDeps = {},
): Promise<ShadowEvalSummary> {
  const rules = deps.rules ?? EXIT_STRATEGIES;
  const readDoc = deps.readResultDoc ?? defaultReadResultDoc;
  const writeDoc = deps.writeResultDoc ?? defaultWriteResultDoc;
  const ctx: EvalContext = {
    marketDate: deps.marketDate ?? getMarketDatePT(),
    tickAt: (deps.now ?? (() => new Date()))().toISOString(),
  };

  const summary: ShadowEvalSummary = {
    positions: 0,
    evaluated: 0,
    fires: 0,
    skippedNoInstance: 0,
    skippedNonOption: 0,
    docsWritten: 0,
    errors: [],
  };

  const byInstance = new Map<string, ShadowEvalPositionInput[]>();
  for (const p of positions) {
    const instanceId = p.trade.strategyInstanceId;
    if (!instanceId) {
      summary.skippedNoInstance++;
      continue;
    }
    // Scan parity — the EOD scan skips positions with non-option legs
    // outright; evaluating them here would write records the afternoon
    // rebuild drops every day (and option-only rules misread a stock leg's
    // notional as premium).
    if (p.trade.legs.some((l) => l.kind === 'share')) {
      summary.skippedNonOption++;
      continue;
    }
    const bucket = byInstance.get(instanceId) ?? [];
    bucket.push(p);
    byInstance.set(instanceId, bucket);
  }

  for (const [instanceId, inputs] of byInstance) {
    summary.positions += inputs.length;
    const openIds = new Set(inputs.map((i) => i.trade.id));
    // Per-(instance × rule) docs are independent — fetch+write in parallel;
    // the per-doc try keeps one failure from aborting the rest.
    await Promise.all(
      rules.map(async (rule) => {
        const docId = stOptionsAnalysisResultDocId(instanceId, rule.exitId);
        try {
          const priorDoc = await readDoc(docId);
          const records = new Map<string, AnalysisTradeRecord>(
            (priorDoc?.trades ?? []).map((t) => [t.contractId, t]),
          );
          for (const input of inputs) {
            try {
              const prior = records.get(input.trade.id);
              const { record, newFire } = evalPositionRule(
                input,
                instanceId,
                rule,
                prior,
                ctx,
              );
              if (record !== null) records.set(input.trade.id, record);
              if (prior?.outcome !== 'exit' && prior?.outcome !== 'expired') {
                summary.evaluated++;
              }
              if (newFire) summary.fires++;
            } catch (err) {
              summary.errors.push({
                positionId: input.trade.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          const trades = [...records.values()];
          const doc: AnalysisResultDoc = {
            ...(priorDoc ?? {}),
            contractListDocId: instanceId,
            runId: instanceId,
            symbol: priorDoc?.symbol ?? inputs[0].trade.symbol,
            templateId:
              priorDoc?.templateId ?? inputs[0].trade.expression.toLowerCase(),
            exitId: rule.exitId,
            registryVersion: EXIT_REGISTRY_VERSION,
            status: 'success',
            trades,
            // Scan parity — the aggregate counts positions, not records:
            // this tick's open positions plus carried-forward non-terminal
            // records (still-open positions not marked this tick).
            aggregate: aggregateExitType(
              rule.exitId,
              trades.filter(
                (t) =>
                  openIds.has(t.contractId) ||
                  (t.outcome !== 'exit' && t.outcome !== 'expired'),
              ).length,
              trades,
            ),
            generatedAt: ctx.tickAt,
          };
          await writeDoc(docId, doc);
          summary.docsWritten++;
        } catch (err) {
          summary.errors.push({
            docId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  logger.info(
    `Shadow eval: ${summary.positions} position(s), ${summary.fires} new fire(s), ` +
      `${summary.docsWritten} doc(s), ${summary.skippedNoInstance} no-instance skip(s), ` +
      `${summary.skippedNonOption} non-option skip(s), ${summary.errors.length} error(s)`,
  );
  return summary;
}
