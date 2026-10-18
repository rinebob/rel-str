/**
 * Read-only audit for #1004 — verifies `st-position-groups` and the
 * cohorts → groups migration:
 *
 *   FAIL (drives exit 1):
 *   - group doc id doesn't match `{SYM}-{YYMMDD}-grp-{NN}`
 *   - required axes missing: origin.type ∉ {signal, program, manual},
 *     mode ∉ {live, paper}, userId/status/rollups/createdAt/updatedAt
 *   - memberTradeIds reference trades that don't exist, or a member trade
 *     whose `positionGroupId` doesn't point back at the group
 *   - memberTicketIds reference missing tickets, or a member ticket whose
 *     `origin.positionGroupId` doesn't point back
 *   - a legacy cohort doc with no canonical group counterpart (post-apply
 *     gap) — cohort `cohort-{YYMMDD}-{SYM}-{NN}` maps to
 *     `{SYM}-{YYMMDD}-grp-{NN}` and its tradeIds must all appear in
 *     memberTradeIds
 *
 *   WARN (reported, does not fail):
 *   - group with no member ids at all (a pre-write crash could leave one —
 *     the writer always writes declared members, so post-create crashes
 *     surface as missing-member FAILs instead, which is the detection
 *     intent)
 *   - cohort's legacy signalId couldn't be resolved to a canonical
 *     st-signals occurrence id (origin.signalId omitted by design)
 *   - signal-origin group without origin.signalId
 *   - rollups disagree with observed member trade statuses (stale rollup
 *     is a data-quality note, not a contract break — nothing maintains
 *     them post-write yet)
 *
 * An empty collection is expected until post-deploy accepts run — reported,
 * not failed.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-position-groups-1004.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_ORDER_TICKETS_ROOT,
  ST_POSITION_GROUPS_ROOT,
} from '../../src/common/st-collections';
import { PaperTradingKind, paperTradingItemsPath } from '@paper-trading/ids';
import { parseCohortId } from '../../src/position-groups/legacy-cohorts';
import {
  collectGroupMembership,
  joinLivePositions,
  type EquityTaxLotLike,
  type OptionPositionLike,
} from '../../src/position-groups/live-position-join';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';
import {
  ST_GROUP_ORIGIN_TYPES,
  ST_POSITION_GROUP_STATUSES,
  type StPositionGroup,
} from '../../../shared/st-position-groups';
import { LIFECYCLE_OPEN_TRADE_STATUSES } from '../../../shared/paper-trading-contracts';
import type { PaperCohort, PaperTrade } from '../../../shared/paper-trading-contracts';
import type { StOrderTicket } from '../../../shared/st-order-tickets';
import { stPositionGroupId } from '../../../shared/st-ids';

interface Finding {
  tier: 'FAIL' | 'WARN';
  docId: string;
  detail: string;
}

const findings: Finding[] = [];
const fail = (docId: string, detail: string) => findings.push({ tier: 'FAIL', docId, detail });
const warn = (docId: string, detail: string) => findings.push({ tier: 'WARN', docId, detail });

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const GROUP_ID_RE = /^[A-Z0-9.]+-\d{6}-grp-\d{2,}$/;

const OPEN_STATUSES = LIFECYCLE_OPEN_TRADE_STATUSES;

/** Unwrap an observation-tool result — `{success, parsed}` → the inner
 *  array (RH list payloads nest under results/positions/data). */
async function callToolList(name: string, args: Record<string, unknown>): Promise<unknown[]> {
  const res = await executeObservationTool(name, args);
  if (!('success' in res) || !res.success) {
    throw new Error(`MCP ${name} failed: ${'error' in res ? res.error : 'unknown'}`);
  }
  return extractArray((res as { parsed?: unknown }).parsed);
}

function extractArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['results', 'positions', 'tax_lots', 'items', 'data']) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
      const nested = extractArray(o[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function auditShape(g: StPositionGroup): void {
  if (!GROUP_ID_RE.test(g.id)) fail(g.id, 'id does not match {SYM}-{YYMMDD}-grp-{NN}');
  if (!g.origin || !ST_GROUP_ORIGIN_TYPES.includes(g.origin.type)) {
    fail(g.id, `origin.type '${g.origin?.type}' not in ${ST_GROUP_ORIGIN_TYPES}`);
  }
  if (g.origin?.type === 'signal' && !isStr(g.origin.signalId)) {
    warn(g.id, 'signal-origin group without origin.signalId');
  }
  if (g.origin?.type === 'program' && !isStr(g.origin.instanceId)) {
    warn(g.id, 'program-origin group without origin.instanceId');
  }
  if (g.mode !== 'live' && g.mode !== 'paper') fail(g.id, `mode '${g.mode}'`);
  if (!isStr(g.userId)) fail(g.id, 'userId missing');
  if (!ST_POSITION_GROUP_STATUSES.includes(g.status)) fail(g.id, `status '${g.status}'`);
  for (const f of ['createdAt', 'updatedAt'] as const) {
    if (!isStr(g[f])) fail(g.id, `${f} missing`);
  }
  for (const f of ['memberTicketIds', 'memberTradeIds', 'brokerOrderIds'] as const) {
    if (!Array.isArray(g[f])) fail(g.id, `${f} not an array`);
  }
  if (!g.rollups || !Number.isFinite(g.rollups.openCount) || !Number.isFinite(g.rollups.closedCount)) {
    fail(g.id, 'rollups.openCount/closedCount missing or non-numeric');
  }
  if (
    g.memberTicketIds?.length === 0 &&
    g.memberTradeIds?.length === 0 &&
    g.brokerOrderIds?.length === 0
  ) {
    warn(g.id, 'empty group — no members (crashed accept can leave one)');
  }
}

async function main(): Promise<void> {
  const [groupSnap, cohortSnap, ticketSnap, tradeSnap] = await Promise.all([
    db.collection(ST_POSITION_GROUPS_ROOT).get(),
    db.collection(paperTradingItemsPath(PaperTradingKind.COHORT)).get(),
    db.collection(ST_ORDER_TICKETS_ROOT).get(),
    db.collection(paperTradingItemsPath(PaperTradingKind.TRADE)).get(),
  ]);

  const tradesById = new Map(tradeSnap.docs.map((d) => [d.id, d.data() as PaperTrade]));
  // Keyed by path id — canonical ticket docs don't all store `id` in
  // data, and the path is authoritative (same doctrine as the migration).
  const ticketsById = new Map(
    ticketSnap.docs.map((d) => [d.id, d.data() as StOrderTicket]),
  );

  console.log(
    `st-position-groups audit — ${groupSnap.size} group(s), ` +
    `${cohortSnap.size} legacy cohort(s)\n`,
  );

  // ── 1. Canonical shape + bidirectional membership ──
  for (const d of groupSnap.docs) {
    const g = d.data() as StPositionGroup;
    auditShape(g);

    let openCount = 0;
    let observed = 0;
    for (const tradeId of g.memberTradeIds ?? []) {
      const t = tradesById.get(tradeId);
      if (!t) {
        fail(g.id, `memberTradeIds references missing trade ${tradeId}`);
        continue;
      }
      observed++;
      if (OPEN_STATUSES.has(t.status)) openCount++;
      if (t.positionGroupId !== g.id) {
        fail(g.id, `member trade ${tradeId} lacks positionGroupId back-stamp`);
      }
    }
    for (const ticketId of g.memberTicketIds ?? []) {
      const t = ticketsById.get(ticketId);
      if (!t) {
        fail(g.id, `memberTicketIds references missing ticket ${ticketId}`);
        continue;
      }
      if (t.origin?.positionGroupId !== g.id) {
        fail(g.id, `member ticket ${ticketId} lacks origin.positionGroupId back-stamp`);
      }
    }
    if (
      g.rollups &&
      observed > 0 &&
      (g.rollups.openCount !== openCount || g.rollups.closedCount !== observed - openCount)
    ) {
      warn(
        g.id,
        `rollups ${JSON.stringify(g.rollups)} vs observed open=${openCount} closed=${observed - openCount}`,
      );
    }
    if (g.status === 'closed' && openCount > 0) {
      warn(g.id, `status 'closed' with ${openCount} lifecycle-open member(s)`);
    }
  }

  // ── 2. Cohort parity — every legacy cohort maps to a canonical group ──
  const groupsById = new Map(groupSnap.docs.map((d) => [d.id, d.data() as StPositionGroup]));
  for (const d of cohortSnap.docs) {
    const cohort = { ...(d.data() as Omit<PaperCohort, 'id'>), id: d.id };
    const parsed = parseCohortId(cohort.id);
    if (!parsed) {
      fail(d.id, 'cohort id unparseable — cannot derive group counterpart');
      continue;
    }
    const yymmdd = `20${parsed.date.slice(0, 2)}-${parsed.date.slice(2, 4)}-${parsed.date.slice(4, 6)}`;
    // nn() throws on seq < 1 (`cohort-…-00`) — one hostile id must not
    // abort the whole audit.
    let expectedId: string;
    try {
      expectedId = stPositionGroupId(parsed.symbol, new Date(`${yymmdd}T12:00:00Z`), parsed.seq);
    } catch (err) {
      fail(d.id, `cannot derive group id — ${String(err)}`);
      continue;
    }
    const g = groupsById.get(expectedId);
    if (!g) {
      fail(d.id, `no canonical counterpart ${expectedId} — run migrate-cohorts-1004.ts`);
      continue;
    }
    for (const tradeId of cohort.tradeIds ?? []) {
      if (!g.memberTradeIds.includes(tradeId)) {
        fail(d.id, `group ${expectedId} memberTradeIds missing cohort trade ${tradeId}`);
      }
    }
    // Lineage check: cohort.signalId is the legacy gallery id — the group
    // should carry the canonical occurrence id via the member ticket join.
    if (!g.origin.signalId) {
      warn(d.id, `group ${expectedId} carries no canonical origin.signalId (legacy id '${cohort.signalId}' not resolvable)`);
    }
  }

  // ── 2b. Reverse direction — dangling stamps the forward checks miss ──
  // A grp-shaped stamp pointing at a missing group, or at a group that
  // doesn't list the doc as a member, is real corruption (partial-crash
  // residue or a bad merge) — never produced by a correct accept/
  // migration. NOTE: tickets also carry `origin.positionGroupId` for
  // MANAGEMENT lineage (legacy position anchors like 'broker-position-X'
  // or an opening order id — pre-#1004 use of the field, not a group id),
  // so only grp-shaped values are checked.
  for (const [tradeId, t] of tradesById) {
    const gid = t.positionGroupId;
    if (!gid || !GROUP_ID_RE.test(gid)) continue;
    const g = groupsById.get(gid);
    if (!g) fail(tradeId, `positionGroupId '${gid}' has no group doc`);
    else if (!g.memberTradeIds?.includes(tradeId)) {
      fail(tradeId, `stamped '${gid}' but not in that group's memberTradeIds`);
    }
  }
  for (const [ticketId, t] of ticketsById) {
    const gid = t.origin?.positionGroupId;
    if (!gid || !GROUP_ID_RE.test(gid)) continue;
    const g = groupsById.get(gid);
    if (!g) fail(ticketId, `origin.positionGroupId '${gid}' has no group doc`);
    else if (!g.memberTicketIds?.includes(ticketId)) {
      fail(ticketId, `stamped '${gid}' but not in that group's memberTicketIds`);
    }
  }

  // ── 3. Live join — real tax lots vs live member tickets ──
  // Collect every live ticket's brokerOrderId/leg ids and join them
  // against the account's actual RH tax lots + option positions. The
  // account may legitimately hold no positions — matches are reported,
  // not required.
  // Option legs count even when the ticket was never submitted (no
  // brokerOrderId yet) — they still carry leg identities to join on.
  const liveTickets = ticketSnap.docs
    .map((d) => d.data() as StOrderTicket)
    .filter(
      (t) => t.mode === 'live' &&
        (isStr(t.brokerOrderId) || (t.terms?.legs?.length ?? 0) > 0),
    );
  const membership = collectGroupMembership(liveTickets);
  console.log(
    `\nlive-join probe — ${liveTickets.length} live ticket(s), ` +
    `${membership.brokerOrderIds.length} brokerOrderId(s), ` +
    `${membership.optionLegIds.length} option leg id(s)`,
  );
  if (membership.brokerOrderIds.length > 0 || membership.optionLegIds.length > 0) {
    const accountNumber = liveTickets.map((t) => t.accountTarget).find(isStr);
    if (!accountNumber) {
      warn('live-join', 'no accountTarget resolvable on live tickets');
    } else {
      try {
        // get_equity_tax_lots is per-instrument — one call per unique
        // live member-ticket symbol.
        const symbols = [...new Set(
          liveTickets
            .filter((t) => !t.terms?.legs?.length)
            .map((t) => t.terms?.symbol)
            .filter(isStr),
        )];
        const taxLots: EquityTaxLotLike[] = [];
        for (const sym of symbols) {
          const lots = await callToolList('get_equity_tax_lots', {
            account_number: accountNumber,
            symbol: sym,
          });
          taxLots.push(...(lots as EquityTaxLotLike[]));
        }
        const optionPositions = (await callToolList('get_option_positions', {
          account_number: accountNumber,
          nonzero: true,
        })) as OptionPositionLike[];
        const join = joinLivePositions(membership, taxLots, optionPositions);
        console.log(
          `  tax lots: ${taxLots.length} fetched → ${join.taxLots.length} member match(es); ` +
          `option positions: ${optionPositions.length} fetched → ${join.optionPositions.length} member match(es)`,
        );
        if (join.unmatchedBrokerOrderIds.length) {
          console.log(
            `  unmatched member orders (closed legs / unfilled): ${join.unmatchedBrokerOrderIds.length}`,
          );
        }
      } catch (err) {
        warn('live-join', `RH tax-lot/position fetch unavailable — ${String(err)}`);
      }
    }
  }

  // ── 4. Report ──
  const fails = findings.filter((f) => f.tier === 'FAIL');
  const warns = findings.filter((f) => f.tier === 'WARN');
  for (const f of findings) console.log(`${f.tier} ${f.docId} — ${f.detail}`);
  console.log(
    `\n=== ${groupSnap.size} groups / ${cohortSnap.size} cohorts audited: ` +
    `${fails.length} FAIL, ${warns.length} WARN ===`,
  );
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
