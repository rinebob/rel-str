/**
 * @topic #553 — Paper Trading Infra (task #564)
 * @topic #984 — ST Firestore Reorg (task #1005)
 *
 * `paperSignalOrder` retry path + the canonical staged-ticket emitter,
 * extracted from callables.ts (the accept handler crossed the 1k-line
 * cap — these are the idempotent-retry halves of the same contract).
 *
 * Retry doctrine: a prior call for the same signal already wrote trades —
 * return the existing cohort instead of minting a second one under
 * suffixed ids, re-emitting any staged tickets the first accept died
 * before writing (`emit()` is `create()`-idempotent), and rebuilding a
 * missing cohort/position-group doc from the stored member dims.
 */
import { HttpsError } from 'firebase-functions/v2/https';

import { TradeSide } from '@common';
import {
  LIFECYCLE_OPEN_TRADE_STATUSES,
  PaperTradeStatus,
  PaperTradingKind,
  SIGNAL_EXPRESSION_TEMPLATES,
  type PaperCohort,
  type PaperSignalOrderRequest,
  type PaperSignalOrderResponse,
  type PaperTrade,
  type SignalExpressionTemplate,
} from '@paper-trading/contracts';
import {
  buildAccountId,
  buildSpreadTradeDesc,
  buildTradeId,
  EQUITY_TRADE_DESC,
} from '@paper-trading/ids';
import { stTicketId } from '@st/ids';
import type { StGroupOrigin } from '@st/position-groups';
import type { EmitStOrderTicketInput } from '../order-tickets/st-order-ticket-writer';
import { getMarketDatePT } from '../common/pt-date-utils';
import { buildGroupDoc } from '../position-groups/st-position-group-writer';
import type {
  OrderTicketDoc,
  PaperOrderTicketsDep,
  PaperSignalOrderDeps,
} from './callables';
import { createLogger } from './engine/logging';

const logger = createLogger('PaperSignalOrder');

export const hasTemplate = (t: PaperTrade): t is PaperTrade & { expressionTemplate: SignalExpressionTemplate } =>
  !!t.expressionTemplate;

export function buildCohortDoc(
  id: string,
  signalId: string,
  symbol: string,
  direction: TradeSide,
  tradeIds: string[],
  expressionTemplates: string[],
  acceptedAt: string,
  updatedAt: string,
): PaperCohort {
  return {
    kind: PaperTradingKind.COHORT,
    id,
    signalId,
    symbol,
    direction,
    acceptedAt,
    tradeIds,
    expressionTemplates,
    createdAt: acceptedAt,
    updatedAt,
  };
}

/** Narrowed emit input — mode/refId/account/userId/now are bound by the
 *  emitter factory. */
export type EmitTicketInput = Omit<
  EmitStOrderTicketInput,
  'mode' | 'auto' | 'refId' | 'accountTarget' | 'userId' | 'now' | 'signalContext'
>;
export type EmitTicket = (input: EmitTicketInput) => Promise<string | null>;

/**
 * Canonical staged-ticket emitter (#984/#1002/#1005) — emitted on both
 * the fresh and retry paths (emit is `create()`-idempotent): one per
 * expression template (stays `staged` — the ticket IS the pending
 * expression) plus the equity ticket, which flips filled/failed with its
 * ledger fill. Returns null when the writer dep is absent (tests that
 * pre-date canonical tickets) — canonical writes are soft during the
 * dual-write window.
 */
export function makeTicketEmitter(args: {
  tickets?: PaperOrderTicketsDep;
  data: PaperSignalOrderRequest;
  userId: string;
  sc: OrderTicketDoc['signalContext'];
  nowIso: string;
}): EmitTicket {
  const { tickets, data, userId, sc, nowIso } = args;
  return async (input: EmitTicketInput) => {
    if (!tickets) return null;
    try {
      return await tickets.emit({
        mode: 'paper',
        auto: false,
        refId: data.refId,
        accountTarget: buildAccountId(userId),
        userId,
        // signalContext.signalId = the caller-passed signal id — stamped on
        // every member ticket so the #1005 minted trade carries the same
        // signalId listTradesBySignal queries on retry. The signalType/
        // barDate lineage only exists when the legacy ticket doc carries it.
        signalContext: {
          signalId: data.signalId,
          ...(sc
            ? {
                signalType: sc.signalType,
                barDate: sc.barDate,
                direction: sc.direction,
                decisionId: sc.decisionId,
              }
            : {}),
        },
        now: nowIso,
        ...input,
      });
    } catch (err) {
      logger.warn(
        `st_paper_signal_ticket_emit ${JSON.stringify({ signalId: data.signalId, error: err instanceof Error ? err.message : String(err) })}`,
      );
      return null;
    }
  };
}

/**
 * Idempotent retry of `handlePaperSignalOrder`. `existing`/`eqTrade` are
 * the already-resolved same-signal trades + the equity member. Returns
 * the original cohort/ids and self-heals whatever the first accept died
 * before writing.
 *
 * Concurrency note: two simultaneous accepts for the same signal can both
 * pass the `existing.length > 0` gate — the cohort seq scan and trade-id
 * suffixes keep ids unique, but a duplicate cohort is possible in that
 * narrow race (single-user today; revisit if batching).
 */
export async function runSignalOrderRetry(ctx: {
  deps: PaperSignalOrderDeps;
  data: PaperSignalOrderRequest;
  userId: string;
  existing: PaperTrade[];
  eqTrade: PaperTrade;
  ticketOrigin: StGroupOrigin;
  emitTicket: EmitTicket;
  nowIso: string;
  /** Fallback member-seed date when `eqTrade.createdAt` is absent. */
  fallbackIdDate: Date;
}): Promise<PaperSignalOrderResponse> {
  const { deps, data, userId, existing, eqTrade, ticketOrigin, emitTicket, nowIso, fallbackIdDate } = ctx;
  const cohortId = eqTrade.cohortId;
  if (!cohortId) {
    throw new HttpsError(
      'failed-precondition',
      `signal ${data.signalId} has partial trades (${existing.map((t) => t.id).join(', ')}) — manual cleanup required`,
    );
  }
  // Post-#1005 accepts never mint expression trades at accept — the
  // staged tickets are the members. Recompute their seeds for the
  // response + rebuilds; the seed resolver adopts a base when the
  // existing pap_ doc is this signal's prior emit — refId OR signalId
  // ownership, since a client retry can carry a fresh refId while the
  // dedupe is signal-scoped (a refId-only resolver would mint `-2`
  // duplicate staged tickets). Pre-#1005 retries still find real
  // expression trades here.
  const templatesForSide = SIGNAL_EXPRESSION_TEMPLATES[eqTrade.order.side] ?? [];
  // Member seeds re-key on the ORIGINAL accept's market date (from the
  // stored equity trade), not the retry clock — a cross-day retry must
  // find the same pap_{seed} tickets the first accept emitted or it
  // would stage a second set (double mint at fill).
  const memberIdDate = eqTrade.createdAt
    ? new Date(`${getMarketDatePT(new Date(eqTrade.createdAt))}T12:00:00Z`)
    : fallbackIdDate;
  const memberSeeds = await Promise.all(
    templatesForSide.map(async (t) => {
      const base = buildTradeId(
        memberIdDate, 'sig', eqTrade.symbol,
        buildSpreadTradeDesc(t.expression, t.targetDelta, t.targetDte),
      );
      return deps.tickets
        ? deps.tickets.resolveTicketSeed(base, data.refId, data.signalId)
        : base;
    }),
  );
  // Cohort-scoped like the group rebuild below — a same-signal trade from
  // another flow (auto-paper ingest writes source:SIGNAL trades with no
  // cohortId) is not this accept's member and must not suppress a seed
  // emit or leak into the response.
  const expressionIds = existing
    .filter((t) => t.id !== eqTrade.id && t.cohortId === cohortId)
    .map((t) => t.id);
  // Response = real trade ids where they exist plus the still-pending
  // seeds — a mid-flight retry (some members minted, some staged) must
  // report both. A minted trade covers its seed via ticket.ticketId; a
  // legacy pending covers it by id equality (same buildTradeId base).
  const coveredSeeds = new Set(
    existing
      .map((t) => t.ticket?.ticketId)
      .filter((id): id is string => !!id)
      .map((id) => id.replace(/^pap_/, '')),
  );
  // Template-identity coverage — a member whose trade id diverged from the
  // recomputed seed (suffixed resolveTradeId on a same-day id collision,
  // or template-config drift) still covers its slot: re-staging it would
  // mint a second position for one template.
  const memberTemplateKeys = new Set(
    existing
      .filter((t) => t.id !== eqTrade.id && t.cohortId === cohortId)
      .map((t) => t.expressionTemplate?.key ?? t.expression)
      .filter((k): k is string => !!k),
  );
  // Seeds with no covering member trade = staged members a partial first accept
  // never wrote — the heal block below stages their tickets (only when
  // the writer dep is wired; otherwise the old response shape stands).
  const uncoveredSpecs = deps.tickets
    ? memberSeeds
        .map((seed, i) => ({ seed, t: templatesForSide[i] }))
        .filter(({ seed, t }) =>
          !coveredSeeds.has(seed)
          && !expressionIds.includes(seed)
          && !memberTemplateKeys.has(t.key)
          && !memberTemplateKeys.has(t.expression),
        )
    : [];
  const responseExprIds = expressionIds.length
    ? [...expressionIds, ...uncoveredSpecs.map((s) => s.seed)]
    : memberSeeds;
  if (!(await deps.getCohort(cohortId))) {
    logger.warn(`rebuilding missing cohort ${cohortId} for signal ${data.signalId}`);
    // Rebuild from the stored trade dims, not the new request — a retry
    // must reproduce the original cohort, not the caller's args.
    const templateKeys = existing.filter(hasTemplate).map((t) => t.expressionTemplate.key);
    // Post-#1005 cohorts list only the equity trade; the template keys
    // come from the direction's template set when no expression trades
    // exist to read them from.
    const retryKeys = templateKeys.length > 0
      ? templateKeys
      : templatesForSide.map((t) => t.key);
    await deps.setCohort(
      buildCohortDoc(cohortId, data.signalId, eqTrade.symbol, eqTrade.order.side,
        [eqTrade.id, ...expressionIds], retryKeys,
        eqTrade.createdAt ?? nowIso, nowIso),
    );
  }
  // Same rebuild contract as the cohort (#1004): trades carry the group
  // id — when the doc never landed, restore it from the stored members.
  // The stamp-absent case (group create failed soft before any trade was
  // stamped) is undetectable here by design — migrate-cohorts-1004.ts
  // heals it from the cohort doc on its next run.
  const positionGroupId = eqTrade.positionGroupId;
  if (positionGroupId && deps.groups) {
    try {
      if (!(await deps.groups.get(positionGroupId))) {
        logger.warn(`rebuilding missing position group ${positionGroupId} for signal ${data.signalId}`);
        // Membership is cohort-scoped — same-signal trades from other
        // flows (auto-paper ingest writes source:SIGNAL trades with no
        // cohort) must not be rebuilt into the group.
        const members = existing.filter((t) => t.cohortId === cohortId);
        const memberIds = members.map((t) => t.id);
        const openCount = members.filter((t) => LIFECYCLE_OPEN_TRADE_STATUSES.has(t.status)).length;
        await deps.groups.ensure(
          buildGroupDoc(positionGroupId, {
            origin: ticketOrigin,
            mode: 'paper',
            userId,
            // Member tickets = each trade's stamped lifecycle ticket
            // (pap_{seed} for minted members — NOT pap_{tradeId}) plus
            // pap_ for the still-staged members (the uncovered seeds).
            memberTicketIds: [
              ...members.map(
                (t) => t.ticket?.ticketId ?? stTicketId('paper', t.id),
              ),
              ...uncoveredSpecs.map((s) => stTicketId('paper', s.seed)),
            ],
            memberTradeIds: memberIds,
            status: openCount > 0 ? 'open' : 'closed',
            rollups: { openCount, closedCount: memberIds.length - openCount },
            now: nowIso,
            createdAt: eqTrade.createdAt ?? nowIso,
          }),
        );
      }
    } catch (err) {
      logger.warn(`st_position_group_restore ${JSON.stringify({ positionGroupId, error: String(err) })}`);
    }
  }
  // #1005 self-heal: the staged ticket IS the pending expression — a first
  // accept that died between the ledger write and the emits would leave
  // silent never-filled members without this. emit() is create()-
  // idempotent, so re-emitting existing tickets is a no-op. Two member
  // sets: pre-#1005 pending trades emit lifecycle tickets under their own
  // ids (the fill pass pairs them by refId for an in-place fill);
  // post-#1005 accepts emit under the template seeds.
  if (deps.tickets) {
    const retryOrigin: EmitStOrderTicketInput['origin'] = positionGroupId
      ? { ...ticketOrigin, positionGroupId }
      : { ...ticketOrigin };
    const equityTicketId = await emitTicket({
      idSeed: eqTrade.id,
      origin: retryOrigin,
      cohortId,
      terms: {
        symbol: eqTrade.symbol,
        side: eqTrade.order.side === TradeSide.SHORT ? 'sell' : 'buy',
        instrument: 'equity',
        quantity: eqTrade.order.quantity,
        orderType: 'market',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
        expression: EQUITY_TRADE_DESC,
      },
    });
    // Heal a stranded staged equity ticket — the trade already filled.
    // Ownership check first: emit() no-ops on ALREADY_EXISTS, so the
    // returned id can name a foreign ticket — never transition that.
    // refId OR signalId: a client retry can carry a fresh refId.
    const entry = eqTrade.fills.find((f) => f.role === 'entry');
    const equityTicket = equityTicketId ? await deps.tickets.get(equityTicketId) : null;
    const ownsEquityTicket = !!equityTicket
      && (equityTicket.refId === data.refId
        || equityTicket.signalContext?.signalId === data.signalId);
    if (equityTicket && ownsEquityTicket && entry) {
      await deps.tickets.markFilled(
        equityTicket.id,
        { averagePrice: entry.price, filledQty: entry.quantity, filledAt: nowIso },
        nowIso,
      );
    }
    const pendingMembers = existing.filter(
      (t) => t.id !== eqTrade.id
        && t.cohortId === cohortId
        && t.status === PaperTradeStatus.PENDING,
    );
    // Two member sets, emitted together: lifecycle tickets under each
    // pre-#1005 pending trade's own id (the fill pass pairs them by
    // refId for an in-place fill) + staged member tickets for seeds no
    // member trade covers — including members a partial pre-#1005
    // accept never wrote.
    const exprSpecs = [
      ...pendingMembers.map((t) => ({
        idSeed: t.id,
        side: t.order.side,
        expression: t.expression,
        template: t.expressionTemplate,
      })),
      ...uncoveredSpecs.map(({ seed, t }) => ({
        idSeed: seed,
        side: t.side,
        expression: t.expression,
        template: t,
      })),
    ];
    await Promise.all(
      exprSpecs.map((s) =>
        emitTicket({
          idSeed: s.idSeed,
          origin: retryOrigin,
          cohortId,
          terms: {
            symbol: eqTrade.symbol,
            side: s.side === TradeSide.SHORT ? 'sell' : 'buy',
            instrument: 'option',
            quantity: 1,
            orderType: 'market',
            timeInForce: 'gfd',
            marketHours: 'regular_hours',
            ...(s.expression ? { expression: s.expression } : {}),
            ...(s.template ? { expressionTemplate: s.template } : {}),
          },
        }),
      ),
    );
  }
  return {
    cohortId,
    equityTradeId: eqTrade.id,
    expressionTradeIds: responseExprIds,
    ...(positionGroupId ? { positionGroupId } : {}),
  };
}
