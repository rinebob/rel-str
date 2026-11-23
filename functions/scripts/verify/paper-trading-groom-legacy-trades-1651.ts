/**
 * @topic #553 — Paper Trading Infra (task #1651)
 *
 * Verify for `groom-legacy-signal-trades` — the legacy signal-trade wipe.
 *
 *   npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts
 *     DRY — fixture deps through the real runGroomSignalTrades: census
 *     classification, dry no-delete, apply bucketing, batch iteration,
 *     idempotent re-run. No credentials.
 *
 *   npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts --live
 *     Read-only real census: prod deps scan count equals a raw
 *     source==SIGNAL query, and eligible + skipped == scanned. Safe —
 *     deletes nothing.
 *
 *   npx tsx scripts/verify/paper-trading-groom-legacy-trades-1651.ts --live --apply
 *     Performs the real wipe, then re-censuses: every remaining
 *     source==SIGNAL doc must carry an accept-flow marker (eligible == 0).
 *     DESTRUCTIVE — run only when the wipe is actually wanted (pre-pane).
 */
import {
  groomProdDeps,
  runGroomSignalTrades,
  type GroomSignalTradeRow,
  type GroomSignalTradesDeps,
} from '../groom-legacy-signal-trades';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
} from '../../../shared/paper-trading-contracts';
import { db as adminDb } from '../../src/firebase-admin-init';
import { paperItemsRef } from '../../src/paper-trading/collections';

const LIVE = process.argv.includes('--live');
const APPLY = process.argv.includes('--apply');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── DRY — fixture deps through the real groom ───────────────────────────────

function row(
  id: string,
  extra: Partial<Omit<GroomSignalTradeRow, 'id'>> = {},
): GroomSignalTradeRow {
  return { id, status: PaperTradeStatus.OPEN, ...extra };
}

function fixtureDeps(rows: GroomSignalTradeRow[]) {
  const deleteCalls: string[] = [];
  const deps: GroomSignalTradesDeps = {
    listSignalTrades: async () => rows,
    deleteTrade: async (id) => {
      deleteCalls.push(id);
      return 'deleted';
    },
  };
  return { deps, deleteCalls };
}

async function dry(): Promise<void> {
  console.log('— census classification —');
  const { deps, deleteCalls } = fixtureDeps([
    row('sig-a'),
    row('with-cohort', { cohortId: 'c1' }),
    row('with-group', { positionGroupId: 'g1' }),
    row('with-ticket', {
      ticket: { refId: 'r', acceptedAt: '2026-11-01T00:00:00Z' },
    }),
    row('sig-b'),
  ]);

  const dry = await runGroomSignalTrades(deps, { apply: false });
  check('dry scans all rows', dry.scanned === 5);
  check('dry eligible = the two clean signals', dry.eligible.join() === 'sig-a,sig-b');
  check(
    'dry skipped = cohort + group + ticket carriers',
    dry.skippedAcceptFlow.join() === 'with-cohort,with-group,with-ticket',
  );
  check('dry deletes nothing', deleteCalls.length === 0 && dry.deleted.length === 0);

  console.log('— apply + idempotent re-run —');
  const { deps: deps2, deleteCalls: calls2 } = fixtureDeps([
    row('sig-a'),
    row('with-group', { positionGroupId: 'g1' }),
    row('sig-b'),
  ]);
  const applied = await runGroomSignalTrades(deps2, { apply: true, batchSize: 1 });
  check('apply deletes each eligible id', calls2.join() === 'sig-a,sig-b');
  check('apply reports the skip', applied.skippedAcceptFlow.join() === 'with-group');

  // Re-run shape: the remaining scan holds only skipped rows.
  const { deps: deps3, deleteCalls: calls3 } = fixtureDeps([
    row('with-group', { positionGroupId: 'g1' }),
  ]);
  const rerun = await runGroomSignalTrades(deps3, { apply: true });
  check('re-run deletes nothing', calls3.length === 0 && rerun.deleted.length === 0);
  check('re-run census = zero eligible', rerun.eligible.length === 0);
}

// ── LIVE — real Firestore (needs ADC) ───────────────────────────────────────

async function rawSignalTradeCount(): Promise<number> {
  const snap = await paperItemsRef(adminDb, PaperTradingKind.TRADE)
    .where('source', '==', PaperTradeSource.SIGNAL)
    .select()
    .get();
  return snap.size;
}

async function live(): Promise<void> {
  console.log('LIVE — real Firestore (st-paper-trading/trades/items)');
  const raw = await rawSignalTradeCount();
  const census = await runGroomSignalTrades(groomProdDeps(), { apply: false });
  check('scan count matches a raw source==SIGNAL query', census.scanned === raw);
  console.log(
    `census: ${census.scanned} scanned — ${census.eligible.length} eligible, ${census.skippedAcceptFlow.length} skipped`,
  );

  if (!APPLY) {
    console.log('read-only — pass --live --apply to run the real wipe');
    return;
  }
  console.log('— APPLYING THE REAL WIPE —');
  const applied = await runGroomSignalTrades(groomProdDeps(), { apply: true });
  check(
    'every eligible delete succeeded',
    applied.failed.length === 0,
    applied.failed.map((f) => `${f.tradeId}:${f.error}`).join(', '),
  );
  const post = await runGroomSignalTrades(groomProdDeps(), { apply: false });
  check(
    'post-wipe census: zero eligible remain',
    post.eligible.length === 0,
    `${post.eligible.length} still eligible`,
  );
  check(
    'post-wipe: only skipped (accept-flow) docs survive',
    post.scanned === post.skippedAcceptFlow.length,
  );
  console.log(
    `post-wipe: ${applied.deleted.length} deleted, ${post.scanned} skipped docs remain`,
  );
}

await dry();
if (LIVE) await live();
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
