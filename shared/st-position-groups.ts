/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Canonical `st-position-groups` shape — groups the equity trade and
 * option-expression trades generated from one signal order (and their live
 * equivalents) under one doc (`{SYM}-{YYMMDD}-grp-{NN}`). Single source for
 * BE and FE via the `@st/position-groups` path alias.
 */
import type { StMode } from './st-types';
export type { StMode } from './st-types';

export type StGroupOriginType = 'signal' | 'program' | 'manual';
export const ST_GROUP_ORIGIN_TYPES: readonly StGroupOriginType[] = [
  'signal', 'program', 'manual',
];

export interface StGroupOrigin {
  type: StGroupOriginType;
  /** st-signals doc id — set when type='signal'. */
  signalId?: string;
  /** st-strategy-instances doc id — set when type='program'. */
  instanceId?: string;
}

export type StPositionGroupStatus = 'open' | 'closed';
export const ST_POSITION_GROUP_STATUSES: readonly StPositionGroupStatus[] = [
  'open', 'closed',
];

export interface StPositionGroupRollups {
  openCount: number;
  closedCount: number;
  realizedPnl?: number;
}

/**
 * Position group (`st-position-groups/{SYM}-{YYMMDD}-grp-{NN}`) — the
 * aggregation unit over the trades/tickets one originating action produced.
 */
export interface StPositionGroup {
  id: string;
  origin: StGroupOrigin;
  mode: StMode;
  /** Owning user — security-rule scoping + multi-tenant queries. */
  userId: string;
  memberTicketIds: string[];
  memberTradeIds: string[];
  brokerOrderIds: string[];
  status: StPositionGroupStatus;
  rollups: StPositionGroupRollups;
  createdAt: string;
  updatedAt: string;
}
