/**
 * One-shot migration: legacy `paper-trading/cohorts/items` →
 * canonical `st-position-groups` (task #1004, IMPL-BE §Phase 3).
 *
 * Per cohort doc:
 *   - join member trades for `userId` + lifecycle rollups
 *     (cohorts carry no owner — the group's userId contract requires it)
 *   - join canonical `st-order-tickets` by `trade.ticket.refId` for
 *     `memberTicketIds` and the canonical `origin.signalId` (prod cohorts
 *     store the legacy gallery signal id, NOT the st-signals occurrence id)
 *   - map via `cohortToGroup`: `cohort-{YYMMDD}-{SYM}-{NN}` →
 *     `{SYM}-{YYMMDD}-grp-{NN}`, tradeIds → memberTradeIds verbatim
 *   - set(merge) the group doc — rerunnable; identical reruns count as
 *     `unchanged`
 *   - back-stamp `positionGroupId` on member trades and
 *     `origin.positionGroupId` on member tickets so the join is
 *     bidirectional (tickets → group, group → tickets/trades)
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-cohorts-1004.ts [--id <cohortId>]   # dry-run
 *   npx tsx scripts/migrate-cohorts-1004.ts --apply [--id ...]  # write
 *
 * Requires Application Default Credentials (writes st-position-groups +
 * member back-stamps). Run OUTSIDE live-run windows — the paperSignalOrder
 * accept path mints groups for new accepts; this script only migrates
 * existing cohort docs.
 */
import { db } from '../src/firebase-admin-init';
import {
  ST_ORDER_TICKETS_ROOT,
  ST_POSITION_GROUPS_ROOT,
} from '../src/common/st-collections';
import { PaperTradingKind, paperTradingItemsPath } from '@paper-trading/ids';
import { stTicketId } from '@st/ids';
import { cohortToGroup, parseCohortId } from '../src/position-groups/legacy-cohorts';
import { unionIds } from '../src/common/firestore-utils';
import { deepEqual } from '../src/order-tickets/legacy-order-intents';
import type { PaperCohort, PaperTrade } from '@paper-trading/contracts';
import type { StOrderTicket } from '@st/order-tickets';

const BATCH_LIMIT = 400;

const asIds = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

interface MigrateStats {
  created: number;
  updated: number;
  unchanged: number;
  malformed: number;
  failed: number;
  conflicted: number;
  tradesStamped: number;
  ticketsStamped: number;
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--apply');
  const idArg = process.argv.findIndex((a) => a === '--id');
  const onlyId = idArg >= 0 ? process.argv[idArg + 1] : undefined;
  if (idArg >= 0 && (!onlyId || onlyId.startsWith('--'))) {
    console.error('--id requires a value');
    process.exit(1);
  }

  const cohortsCol = db.collection(paperTradingItemsPath(PaperTradingKind.COHORT));
  const tradesCol = db.collection(paperTradingItemsPath(PaperTradingKind.TRADE));
  const ticketsCol = db.collection(ST_ORDER_TICKETS_ROOT);
  const groupsCol = db.collection(ST_POSITION_GROUPS_ROOT);

  const cohortSnap = onlyId
    ? { docs: [await cohortsCol.doc(onlyId).get()].filter((d) => d.exists) }
    : await cohortsCol.get();

  // One ticket scan up front — refId → member ticket ids + canonical
  // signal lineage for the group origin.
  const ticketSnap = await ticketsCol.get();
  const ticketsByRef = new Map<string, StOrderTicket[]>();
  const ticketIds = new Set<string>();
  const ticketsById = new Map<string, StOrderTicket>();
  for (const d of ticketSnap.docs) {
    const t = { ...(d.data() as Omit<StOrderTicket, 'id'>), id: d.id } as StOrderTicket;
    ticketIds.add(t.id);
    ticketsById.set(t.id, t);
    if (!t.refId) continue;
    const list = ticketsByRef.get(t.refId) ?? [];
    list.push(t);
    ticketsByRef.set(t.refId, list);
  }

  console.log(
    `cohorts migration — ${cohortSnap.docs.length} cohort doc(s), ` +
    `${ticketSnap.size} canonical ticket(s)${dryRun ? ' [DRY RUN]' : ''}\n`,
  );

  const stats: MigrateStats = {
    created: 0, updated: 0, unchanged: 0, malformed: 0, failed: 0,
    conflicted: 0, tradesStamped: 0, ticketsStamped: 0,
  };
  const malformedLines: string[] = [];
  const warningLines: string[] = [];

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };
  const enqueue = async (fn: () => void) => {
    fn();
    pending++;
    if (pending >= BATCH_LIMIT) await flush();
  };

  const now = new Date().toISOString();

  for (const doc of cohortSnap.docs) {
    try {
      // Prod cohort docs don't store `id` inside the data — the doc id
      // lives in the path (`paper-trading/cohorts/items/{cohort-…}`).
      const cohort = { ...(doc.data() as Omit<PaperCohort, 'id'>), id: doc.id };
      if (typeof cohort.symbol !== 'string' || !Array.isArray(cohort.tradeIds)) {
        stats.malformed++;
        malformedLines.push(`${doc.id}: missing symbol/tradeIds`);
        continue;
      }
      // The group id derives from the parsed cohort-id symbol — surface
      // drift when the doc's symbol field disagrees with its own path id.
      const parsedCohort = parseCohortId(doc.id);
      if (parsedCohort && parsedCohort.symbol !== cohort.symbol) {
        warningLines.push(
          `${doc.id}: doc symbol '${cohort.symbol}' ≠ id symbol '${parsedCohort.symbol}' — grouping under the id`,
        );
      }

      // Member trades — userId + rollups source. Prod trade docs don't
      // store `id` in data either — the path id is authoritative.
      const memberTrades: { id: string; trade: PaperTrade }[] = [];
      for (const tradeId of cohort.tradeIds) {
        const tSnap = await tradesCol.doc(tradeId).get();
        if (tSnap.exists) {
          memberTrades.push({ id: tradeId, trade: tSnap.data() as PaperTrade });
        } else {
          warningLines.push(`${doc.id}: member trade ${tradeId} not found`);
        }
      }

      // Member tickets via trade.ticket.refId → canonical st-order-tickets.
      const memberTicketIds = new Set<string>();
      let originSignalId: string | undefined;
      for (const { id: tradeId, trade: t } of memberTrades) {
        const refId = t.ticket?.refId;
        // Lifecycle tickets emitted by #1002+ accepts are pap_{tradeId} —
        // include deterministic ids only when the doc actually exists.
        const lifecycleId = stTicketId('paper', tradeId);
        if (ticketIds.has(lifecycleId)) memberTicketIds.add(lifecycleId);
        if (!refId) continue;
        for (const ticket of ticketsByRef.get(refId) ?? []) {
          memberTicketIds.add(ticket.id);
          originSignalId ??= ticket.origin?.signalId;
        }
      }

      const group = cohortToGroup(cohort, {
        userId: memberTrades.find((m) => m.trade.userId)?.trade.userId,
        originSignalId,
        memberTicketIds: [...memberTicketIds],
        memberTrades: memberTrades.map((m) => m.trade),
        now,
      });
      if (!group) {
        stats.malformed++;
        malformedLines.push(
          `${doc.id}: unmappable (bad cohort id or no resolvable userId)`,
        );
        continue;
      }

      // Cohort seq and group seq are separate namespaces — a stranded
      // group (accept died post-create, no cohort) or an unmappable
      // cohort leaves the seqs diverged for later accepts. The member
      // trades' own stamps are authoritative: unanimous stamp wins over
      // the cohort-derived id; a split stamp is a manual-reconciliation
      // stop, not a merge (unioning foreign members or overwriting a
      // foreign stamp silently corrupts lineage).
      const stamped = [...new Set(
        memberTrades
          .map((m) => m.trade.positionGroupId)
          .filter((x): x is string => typeof x === 'string' && x.length > 0),
      )];
      if (stamped.length > 1) {
        stats.conflicted++;
        warningLines.push(
          `${doc.id}: member trades stamped ${stamped.length} group ids ` +
          `(${stamped.join(', ')}) — skipping, reconcile manually`,
        );
        continue;
      }
      if (stamped.length === 1 && stamped[0] !== group.id) {
        warningLines.push(
          `${doc.id}: trades stamped ${stamped[0]} (cohort-derived ` +
          `${group.id}) — merging into the stamped group`,
        );
        group.id = stamped[0];
      }

      const existing = (await groupsCol.doc(group.id).get()).data();
      // Never union members into a foreign-origin group at the target id.
      const exOrigin = existing?.['origin'] as
        | { type?: string; signalId?: string }
        | undefined;
      if (existing && (
        (exOrigin?.type != null && exOrigin.type !== group.origin.type) ||
        (exOrigin?.signalId != null && group.origin.signalId != null &&
          exOrigin.signalId !== group.origin.signalId)
      )) {
        stats.conflicted++;
        warningLines.push(
          `${doc.id} → ${group.id}: existing group origin ` +
          `${JSON.stringify(exOrigin)} conflicts with mapped ` +
          `${JSON.stringify(group.origin)} — skipping, reconcile manually`,
        );
        continue;
      }
      const mapped: Record<string, unknown> = { ...group };
      // Merge-safe shape: a live-created group may carry members and
      // rollups the migration doesn't know (brokerOrderIds from a fill
      // join, realizedPnl from a close) — union arrays, keep the earlier
      // createdAt, never drop existing members or richer origin fields.
      const mergeDoc: Record<string, unknown> = existing
        ? {
            ...mapped,
            origin: { ...(mapped['origin'] as object), ...(existing['origin'] as object | undefined) },
            status: existing['status'] ?? mapped['status'],
            rollups: {
              ...(mapped['rollups'] as object),
              ...(existing['rollups'] as object | undefined),
            },
            memberTicketIds: unionIds(asIds(existing['memberTicketIds']), group.memberTicketIds),
            memberTradeIds: unionIds(asIds(existing['memberTradeIds']), group.memberTradeIds),
            brokerOrderIds: unionIds(asIds(existing['brokerOrderIds']), group.brokerOrderIds),
            createdAt: existing['createdAt'] ?? mapped['createdAt'],
          }
        : mapped;
      // `updatedAt` always carries a fresh timestamp — exclude it from the
      // unchanged comparison or every rerun would report `updated`.
      const changed =
        existing != null &&
        Object.entries(mergeDoc)
          .filter(([k]) => k !== 'updatedAt')
          .some(([k, v]) => !deepEqual(existing[k], v));
      if (existing && !changed) {
        stats.unchanged++;
      } else if (existing) {
        stats.updated++;
        warningLines.push(`${doc.id} → ${group.id}: existing group doc updated`);
        if (!dryRun) await enqueue(() => batch.set(groupsCol.doc(group.id), mergeDoc, { merge: true }));
      } else {
        stats.created++;
        if (!dryRun) await enqueue(() => batch.set(groupsCol.doc(group.id), mergeDoc, { merge: true }));
      }

      // Back-stamps — bidirectional join. Skipped when the stamp is already
      // present so reruns stay unchanged-noise-free. A stamp pointing at a
      // DIFFERENT group is never overwritten — foreign membership wins.
      for (const { id: tradeId, trade: t } of memberTrades) {
        if (t.positionGroupId && t.positionGroupId !== group.id) {
          warningLines.push(
            `${doc.id}: member trade ${tradeId} stamped ${t.positionGroupId} — leaving (other group owns it)`,
          );
        } else if (t.positionGroupId !== group.id) {
          stats.tradesStamped++;
          if (!dryRun) {
            const ref = tradesCol.doc(tradeId);
            await enqueue(() => batch.update(ref, { positionGroupId: group.id, updatedAt: now }));
          }
        }
      }
      for (const ticketId of memberTicketIds) {
        const ticket = ticketsById.get(ticketId);
        const ticketStamp = ticket?.origin?.positionGroupId;
        if (ticketStamp && ticketStamp !== group.id) {
          warningLines.push(
            `${doc.id}: member ticket ${ticketId} stamped ${ticketStamp} — leaving (other group owns it)`,
          );
        } else if (ticket && ticketStamp !== group.id) {
          stats.ticketsStamped++;
          if (!dryRun) {
            const ref = ticketsCol.doc(ticketId);
            await enqueue(() => batch.update(ref, { 'origin.positionGroupId': group.id, updatedAt: now }));
          }
        }
      }
    } catch (err) {
      stats.failed++;
      malformedLines.push(`${doc.id}: ${String(err)}`);
    }
  }
  await flush();

  console.log('— results —');
  for (const [k, v] of Object.entries(stats)) console.log(`${k}: ${v}`);
  if (warningLines.length) {
    console.log('\nwarnings:');
    for (const w of warningLines) console.log(`  ⚠ ${w}`);
  }
  if (malformedLines.length) {
    console.log('\nmalformed/failed:');
    for (const m of malformedLines) console.log(`  ✖ ${m}`);
  }
  if (dryRun) console.log('\n[DRY RUN] rerun with --apply to write');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
