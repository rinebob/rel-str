/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Cross-cutting scalar types shared by the canonical `st-` record shapes
 * (order tickets, position groups, strategy instances). Single source for
 * BE (functions) and FE (Angular) via the `@st/types` path alias.
 */

/**
 * Execution mode — whether a record targets the live broker or the paper
 * ledger. Shared by StOrderTicket, StPositionGroup, and StStrategyInstance.
 */
export type StMode = 'live' | 'paper';
export const ST_MODES: readonly StMode[] = ['live', 'paper'];
