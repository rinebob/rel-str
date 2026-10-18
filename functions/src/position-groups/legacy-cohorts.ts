/**
 * @topic #984 — ST Firestore Reorg (task #1004)
 *
 * cohortToGroup — pure mapper from the legacy `paper-trading/cohorts/items`
 * doc to the canonical `st-position-groups` doc, shared by the one-shot
 * migration (#1004) and any caller rebuilding a group from its cohort.
 *
 * The cohort doc only carries part of the group — the caller joins the
 * member trades for `userId`/lifecycle rollups and the canonical tickets
 * for `memberTicketIds`/signal lineage:
 *
 *   cohort-{YYMMDD}-{SYM}-{NN}   → {SYM}-{YYMMDD}-grp-{NN}
 *   cohort.signalId              → origin.signalId is NOT carried verbatim —
 *     prod cohorts store the legacy gallery signal id, not the st-signals
 *     occurrence id; the caller supplies the canonical id from the member
 *     ticket's `origin.signalId` (minted by the #1003 order-intents
 *     migration) or leaves it off.
 *   tradeIds                     → memberTradeIds (verbatim)
 *   acceptedAt                   → createdAt (preserved provenance)
 */
import { stPositionGroupId } from '@st/ids';
import type { StPositionGroup, StPositionGroupStatus } from '@st/position-groups';
import {
  LIFECYCLE_OPEN_TRADE_STATUSES,
  type PaperCohort,
  type PaperTrade,
} from '@paper-trading/contracts';

/** `cohort-{YYMMDD}-{SYM}-{NN}` — symbol segment tolerant of dots/colons. */
const COHORT_ID_RE = /^cohort-(\d{6})-(.+)-(\d+)$/;

export function parseCohortId(
  id: string,
): { date: string; symbol: string; seq: number } | null {
  const m = COHORT_ID_RE.exec(id);
  if (!m) return null;
  return { date: m[1], symbol: m[2], seq: Number(m[3]) };
}

/** What the caller must resolve — everything the cohort doc doesn't carry. */
export interface CohortGroupExtras {
  /** Owning uid — sourced from a member trade (`trade.userId`). */
  userId: string | undefined;
  /** Canonical st-signals occurrence id — from the member ticket's
   *  `origin.signalId`. Omitted when unresolvable. */
  originSignalId?: string;
  /** Canonical `st-order-tickets` ids for member trades — the refId join. */
  memberTicketIds: string[];
  /** Member trade docs — lifecycle rollups derive from their statuses. */
  memberTrades: PaperTrade[];
  /** ISO timestamp for updatedAt (migration run time). */
  now: string;
}

/** Lifecycle-active statuses — shared definition (`@paper-trading/contracts`). */
const OPEN_STATUSES = LIFECYCLE_OPEN_TRADE_STATUSES;

/**
 * Map a legacy cohort doc to a canonical position group. Returns null when
 * the cohort id is malformed or no `userId` is resolvable — the group
 * contract requires an owner, and an ownerless group is unmappable.
 */
export function cohortToGroup(
  cohort: PaperCohort,
  extras: CohortGroupExtras,
): StPositionGroup | null {
  const parsed = parseCohortId(cohort.id);
  const userId = extras.userId ?? extras.memberTrades.find((t) => t.userId)?.userId;
  if (!parsed || !userId) return null;

  const { date, symbol, seq } = parsed;
  const yymmdd = `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`;
  const id = stPositionGroupId(symbol, new Date(`${yymmdd}T12:00:00Z`), seq);

  const openCount = extras.memberTrades.filter((t) => OPEN_STATUSES.has(t.status)).length;
  const status: StPositionGroupStatus =
    extras.memberTrades.length === 0 || openCount > 0 ? 'open' : 'closed';

  return {
    id,
    origin: extras.originSignalId
      ? { type: 'signal', signalId: extras.originSignalId }
      : { type: 'signal' },
    mode: 'paper',
    userId,
    memberTicketIds: [...extras.memberTicketIds],
    memberTradeIds: [...cohort.tradeIds],
    brokerOrderIds: [],
    status,
    rollups: {
      openCount,
      closedCount: extras.memberTrades.length - openCount,
    },
    // Provenance stamp when present; extras.now keeps createdAt defined
    // (the canonical contract requires it) on legacy docs missing both.
    createdAt: cohort.acceptedAt ?? cohort.createdAt ?? extras.now,
    updatedAt: extras.now,
  };
}
