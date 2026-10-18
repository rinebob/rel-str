/**
 * @topic #984 — ST Firestore Reorg (task #1004)
 *
 * StPositionGroupWriter
 *
 * Canonical `st-position-groups` creation + membership — the aggregation
 * unit over the tickets/trades one originating action produced
 * (`{SYM}-{YYMMDD}-grp-{NN}`). Mirrors StOrderTicketWriter (#1002):
 * deps-seamed `{db, logger}`, fail-soft so a canonical-path failure never
 * drops the legacy artifact the path actually runs on (the paper cohort
 * during the #984 soak).
 *
 * - `create()` allocates `{NN}` via `create()` + ALREADY_EXISTS per the
 *   st-ids seq contract. A collision on the same origin AND the same (or
 *   a subset of the existing) member ids is a retried accept — the
 *   existing doc is adopted rather than spawning a sibling grp-02. A
 *   collision with different members is a distinct group (e.g. a second
 *   manual accept, whose origin carries no distinguishing id) and takes
 *   the next seq.
 * - `ensure()` restores a known-id doc for the rebuild path (trades exist
 *   but the group doc is missing) — `create()` no-ops when it exists.
 * - `addMembers()` unions ticket/trade/broker ids inside a transaction —
 *   the live-join path appends brokerOrderIds as fills land.
 */
import { logger as defaultLogger } from 'firebase-functions/v2';
import { db as defaultDb } from '../firebase-admin-init';
import { ST_POSITION_GROUPS_ROOT } from '../common/st-collections';
import { isAlreadyExists, unionIds } from '../common/firestore-utils';
import { stPositionGroupId } from '@st/ids';
import type {
  StGroupOrigin,
  StMode,
  StPositionGroup,
  StPositionGroupRollups,
  StPositionGroupStatus,
} from '@st/position-groups';

/** Minimal logger surface — injectable for tests. */
export interface StPositionGroupWriterLogger {
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface StPositionGroupWriterDeps {
  db?: FirebaseFirestore.Firestore;
  logger?: StPositionGroupWriterLogger;
}

/** The dep seam call sites declare — one surface, Pick'd per consumer. */
export type StPositionGroupEmitter = Pick<
  StPositionGroupWriter,
  'create' | 'ensure' | 'addMembers' | 'get'
>;

/** Doc-content fields — everything `buildGroupDoc` needs (rebuild callers
 *  have a known id but no symbol/idDate to mint one from). */
export interface PositionGroupDocFields {
  origin: StGroupOrigin;
  mode: StMode;
  userId: string;
  memberTicketIds?: string[];
  memberTradeIds?: string[];
  brokerOrderIds?: string[];
  status?: StPositionGroupStatus;
  rollups?: StPositionGroupRollups;
  /** ISO timestamp stamped on createdAt/updatedAt. */
  now: string;
  /** Provenance override for createdAt (rebuild paths pass the original
   *  accept time; defaults to `now`). */
  createdAt?: string;
}

/** Everything a caller supplies to create a group doc. */
export interface EmitPositionGroupInput extends PositionGroupDocFields {
  symbol: string;
  /** Market-date anchor for the YYMMDD segment — mint from the PT date. */
  idDate: Date;
}

export class StPositionGroupWriter {
  private readonly db: FirebaseFirestore.Firestore;
  private readonly log: StPositionGroupWriterLogger;

  constructor(deps: StPositionGroupWriterDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.log = deps.logger ?? defaultLogger;
  }

  /**
   * Create `st-position-groups/{SYM}-{YYMMDD}-grp-{NN}`. Returns the group
   * id, or null when the write failed (logged — canonical-write skipped,
   * never a hard failure during the dual-write window).
   */
  async create(input: EmitPositionGroupInput): Promise<string | null> {
    for (let seq = 1; seq < 1000; seq++) {
      let id: string;
      try {
        id = stPositionGroupId(input.symbol, input.idDate, seq);
      } catch (err) {
        this.log.error('st-position-group create rejected — unmintable id', {
          symbol: input.symbol,
          error: String(err),
        });
        return null;
      }
      const ref = this.db.collection(ST_POSITION_GROUPS_ROOT).doc(id);
      const doc = buildGroupDoc(id, input);
      try {
        await ref.create(doc);
        return id;
      } catch (err) {
        if (isAlreadyExists(err)) {
          // Same logical group = same origin AND same deterministic member
          // ids (a retried accept re-mints them). Origin alone is not enough
          // — a manual origin carries no distinguishing id, so a second
          // distinct manual accept for the same symbol+day would otherwise
          // adopt the first accept's group. The adoption read is fail-soft:
          // an unreadable doc can't be verified, so we bail rather than
          // spawn a sibling or crash the accept.
          try {
            const existing = (await ref.get()).data() as StPositionGroup | undefined;
            if (existing && sameOrigin(existing.origin, input.origin) && membersCovered(existing, input)) {
              return id;
            }
          } catch (getErr) {
            this.log.error('st-position-group adoption read failed', { id, error: String(getErr) });
            return null;
          }
          continue;
        }
        this.log.error('st-position-group create failed', { id, error: String(err) });
        return null;
      }
    }
    this.log.error('st-position-group seq exhausted', { symbol: input.symbol });
    return null;
  }

  /**
   * Restore a known-id group (trades/tickets carry `positionGroupId` but the
   * doc is missing — e.g. an accept that crashed before the group write).
   * `create()` makes the restore idempotent — an existing doc is untouched.
   */
  async ensure(group: StPositionGroup): Promise<string | null> {
    try {
      await this.db.collection(ST_POSITION_GROUPS_ROOT).doc(group.id).create(group);
      return group.id;
    } catch (err) {
      if (isAlreadyExists(err)) return group.id;
      this.log.error('st-position-group ensure failed', { id: group.id, error: String(err) });
      return null;
    }
  }

  /** Read a group doc — null when missing or unreadable (fail-soft like
   *  the rest of the writer surface). */
  async get(groupId: string): Promise<StPositionGroup | null> {
    try {
      const snap = await this.db.collection(ST_POSITION_GROUPS_ROOT).doc(groupId).get();
      return snap.exists ? (snap.data() as StPositionGroup) : null;
    } catch (err) {
      this.log.warn('st-position-group get failed', { groupId, error: String(err) });
      return null;
    }
  }

  /**
   * Union new member ids into the group's lists inside a transaction —
   * the live-join path appends `brokerOrderIds` as member tickets fill,
   * and minted trades join by `tradeIds`. Returns false (warn logged)
   * when the group doc is missing or the txn fails.
   */
  async addMembers(
    groupId: string,
    members: { ticketIds?: string[]; tradeIds?: string[]; brokerOrderIds?: string[] },
    now: string,
  ): Promise<boolean> {
    const ref = this.db.collection(ST_POSITION_GROUPS_ROOT).doc(groupId);
    try {
      const applied = await this.db.runTransaction(async (txn: FirebaseFirestore.Transaction) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return false;
        const g = snap.data() as StPositionGroup;
        txn.update(ref, {
          memberTicketIds: unionIds(g.memberTicketIds, members.ticketIds),
          memberTradeIds: unionIds(g.memberTradeIds, members.tradeIds),
          brokerOrderIds: unionIds(g.brokerOrderIds, members.brokerOrderIds),
          updatedAt: now,
        });
        return true;
      });
      if (!applied) {
        this.log.warn('st-position-group addMembers on missing doc', { groupId });
      }
      return applied;
    } catch (err) {
      this.log.warn('st-position-group addMembers failed', {
        groupId,
        error: String(err),
      });
      return false;
    }
  }
}

/**
 * Build the canonical group doc — the single shape definition shared by
 * `create()` and callers restoring a known-id doc via `ensure()`.
 */
export function buildGroupDoc(id: string, input: PositionGroupDocFields): StPositionGroup {
  return {
    id,
    origin: input.origin,
    mode: input.mode,
    userId: input.userId,
    memberTicketIds: input.memberTicketIds ?? [],
    memberTradeIds: input.memberTradeIds ?? [],
    brokerOrderIds: input.brokerOrderIds ?? [],
    status: input.status ?? 'open',
    rollups: input.rollups ?? { openCount: 0, closedCount: 0 },
    createdAt: input.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

/** Same logical group = same origin (type + signal/instance refs). */
function sameOrigin(a: StGroupOrigin, b: StGroupOrigin): boolean {
  return a.type === b.type && a.signalId === b.signalId && a.instanceId === b.instanceId;
}

/** Retried-accept membership — every input member id already lives on the
 *  existing doc. Subset (not equality): a group may legitimately hold ids
 *  a retry doesn't re-supply — e.g. brokerOrderIds unioned in by a live
 *  fill join between attempts. */
function membersCovered(existing: StPositionGroup, input: PositionGroupDocFields): boolean {
  const covered = (have: string[], want?: string[]) => {
    // Empty `want` = no membership evidence → covered. Every create
    // caller supplies members today; a future empty-members mint would
    // adopt any same-origin group — acceptable only because origin
    // disambiguates (signalId/instanceId) for real callers.
    if (!want?.length) return true;
    const haveSet = new Set(have);
    return want.every((id) => haveSet.has(id));
  };
  return (
    covered(existing.memberTicketIds, input.memberTicketIds) &&
    covered(existing.memberTradeIds, input.memberTradeIds) &&
    covered(existing.brokerOrderIds, input.brokerOrderIds)
  );
}
