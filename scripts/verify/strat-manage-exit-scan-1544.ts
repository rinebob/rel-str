/**
 * Verification: manage exit-scan pass (task #1544).
 *
 * Exercises the real modules through the functions tsconfig aliases:
 * `buildNetSeries` (signed cost-to-close inner-join), `positionExitRecord`
 * (exit/expired/open/error outcomes on a multi-leg net series),
 * `scanPosition` (per-leg SA fetch + error degradation), and
 * `runManageExitScan` end-to-end with injected Firestore/SA fakes —
 * asserting one `AnalysisResultDoc` per (instanceId, exitId) lands at
 * `st-options-analysis-results/{instanceId}_{exitId}` in the shape the
 * analysis route reads back.
 *
 * Importing the modules runs `firebase-admin-init` (parameterless
 * `initializeApp()` — no credentials needed; no Firestore call is made).
 *
 * Usage: npx tsx scripts/verify/strat-manage-exit-scan-1544.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  buildNetSeries,
  positionExitRecord,
  runManageExitScan,
  scanPosition,
} from '../../functions/src/paper-trading/engine/passes/manage-exit-scan-pass';
import type {
  ManageExitScanDeps,
  ManageOpenPosition,
} from '../../functions/src/paper-trading/engine/passes/manage-exit-scan-pass';
import type { RunnableManageInstance } from '../../functions/src/paper-trading/engine/manage-instance-reader';
import type { PositionLeg } from '../../functions/src/paper-trading/engine/types';
import { PositionStatus } from '../../functions/src/paper-trading/engine/types';
import {
  EXIT_REGISTRY_VERSION,
  EXIT_STRATEGIES,
} from '@options-analysis/registry';
import type { AnalysisResultDoc } from '@options-analysis/contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '@options-contract/contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import type { ManageVariant } from '@manage/variant-contracts';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

const OPEN_DATE = '2026-01-30'; // Friday
const MARKET_DATE = '2026-02-06'; // Friday — a week later
const EXPIRY = '2026-02-27';

function pcsVariant(): ManageVariant {
  return {
    id: 'pcs-28-30-15',
    name: 'put credit spread 30-15 28',
    templateId: 'pcs',
    dte: 28,
    legs: [
      { kind: 'option', type: OptionType.PUT, targetDelta: 0.3, dte: 28, side: TradeSide.SHORT },
      { kind: 'option', type: OptionType.PUT, targetDelta: 0.15, dte: 28, side: TradeSide.LONG },
    ],
  };
}

function makeInstance(): RunnableManageInstance {
  return {
    id: 'QQQ-PCS-28-30-15-ALL',
    variantRef: 'pcs-28-30-15',
    variant: pcsVariant(),
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'ACTIVE',
    userId: 'verify-user',
    paperAccountId: 'acct-1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  };
}

const SHORT_LEG: PositionLeg = {
  id: 'leg-s', type: OptionType.PUT, side: TradeSide.SHORT, strike: 480,
  expiration: EXPIRY, openDate: OPEN_DATE, contractID: 'QQQ260227P00480000', premium: 2.5,
};
const LONG_LEG: PositionLeg = {
  id: 'leg-l', type: OptionType.PUT, side: TradeSide.LONG, strike: 470,
  expiration: EXPIRY, openDate: OPEN_DATE, contractID: 'QQQ260227P00470000', premium: 1.0,
};

function makePosition(): ManageOpenPosition {
  return {
    id: 'QQQ-PCS-28-30-15-ALL-2026-01-30',
    instanceId: 'QQQ-PCS-28-30-15-ALL',
    symbol: 'QQQ',
    status: PositionStatus.OPEN,
    premiumCollected: 150,
    capitalRequired: 850,
    openDate: OPEN_DATE,
    currentValue: 100,
    currentValueAsOf: MARKET_DATE,
    unrealizedPnl: 50,
    legs: [SHORT_LEG, LONG_LEG],
  };
}

const DATES = [OPEN_DATE, '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', MARKET_DATE];
const SHORT_MARKS = [2.5, 2.25, 1.875, 1.625, 1.25, 0.75];
const LONG_MARKS = [1.0, 0.875, 0.75, 0.625, 0.5, 0.625];
// Net cost-to-close: 1.50, 1.375, 1.125, 1.00, 0.75, 0.125

function seriesResp(marks: number[]): PartnerHistoricalOptionsContractV2Response {
  return {
    symbol: 'QQQ', contractID: 'X',
    series: DATES.map((date, i) => ({ date, mark: String(marks[i]) })),
  } as PartnerHistoricalOptionsContractV2Response;
}

const fetchSeries: NonNullable<ManageExitScanDeps['fetchSeries']> = async ({ contractID }) => {
  if (contractID === SHORT_LEG.contractID) return seriesResp(SHORT_MARKS);
  if (contractID === LONG_LEG.contractID) return seriesResp(LONG_MARKS);
  throw new Error(`unexpected contract ${contractID}`);
};

async function main(): Promise<void> {
  console.log('── net series ──');
  const net = buildNetSeries(
    [SHORT_LEG, LONG_LEG],
    [
      DATES.map((d, i) => ({ date: d, mark: SHORT_MARKS[i] })),
      DATES.map((d, i) => ({ date: d, mark: LONG_MARKS[i] })),
    ],
  );
  check('net series length', net.length, 6);
  check('net entry mark (short − long)', net[0].mark, 1.5);
  check('net final mark', net[5].mark, 0.125);
  check(
    'inner-join drops dates missing from a leg',
    buildNetSeries([SHORT_LEG, LONG_LEG], [
      [{ date: 'd1', mark: 2 }, { date: 'd2', mark: 1 }],
      [{ date: 'd1', mark: 0.5 }],
    ]).length,
    1,
  );

  console.log('── record outcomes ──');
  const inst = makeInstance();
  const pos = makePosition();
  const close = new Map([[EXPIRY, 500]]);
  const t90 = EXIT_STRATEGIES.find((r) => r.exitId === 'target-90')!;
  const expiryRule = EXIT_STRATEGIES.find((r) => r.exitId === 'expiry')!;

  const fired = positionExitRecord(pos, inst, 'target-90', t90, net, EXPIRY, close, MARKET_DATE);
  check('target-90 outcome', fired.outcome, 'exit');
  if (fired.outcome === 'exit') {
    check('exit date = last bar at 0.125 ≤ 0.15', fired.exitDate, MARKET_DATE);
    check('entryMark = net premium', fired.entryMark, 1.5);
    check('contractId = position id (multi-leg traceability)', fired.contractId, pos.id);
  }

  const open = positionExitRecord(pos, inst, 'expiry', expiryRule, net, EXPIRY, close, MARKET_DATE);
  check('expiry rule on live series outcome', open.outcome, 'open');
  if (open.outcome === 'open') check('open lastBarDate', open.lastBarDate, MARKET_DATE);

  const expiredRec = positionExitRecord(
    pos, inst, 'expiry', expiryRule,
    [...net, { date: EXPIRY, mark: 0 }],
    EXPIRY, close, '2026-03-02',
  );
  check('expired outcome at expiry bar', expiredRec.outcome, 'expired');
  if (expiredRec.outcome === 'expired') {
    check('expired net intrinsic (OTM)', expiredRec.intrinsicAtExpiry, 0);
    check('expiredItm', expiredRec.expiredItm, false);
  }

  const errRec = positionExitRecord(pos, inst, 'target-90', t90, [], EXPIRY, close, MARKET_DATE);
  check('empty series → error', errRec.outcome, 'error');

  console.log('── scanPosition ──');
  const scanned = await scanPosition(pos, inst, EXIT_STRATEGIES, MARKET_DATE, close, {
    fetchSeries,
  });
  check('scan yields one record per registry rule', scanned?.size, EXIT_STRATEGIES.length);
  check('scan target-90 fired', scanned?.get('target-90')?.outcome, 'exit');
  check('scan expiry stayed open', scanned?.get('expiry')?.outcome, 'open');

  const fetchFail = await scanPosition(pos, inst, [t90], MARKET_DATE, close, {
    fetchSeries: async () => { throw new Error('upstream'); },
  });
  check('fetch failure → error record (not throw)', fetchFail?.get('target-90')?.outcome, 'error');

  const noContract = await scanPosition(
    { ...pos, legs: [{ ...SHORT_LEG, contractID: undefined }] },
    inst, [t90], MARKET_DATE, close, { fetchSeries },
  );
  check('missing contractID → null (skip)', noContract, null);

  const sameDay = await scanPosition(
    { ...pos, openDate: MARKET_DATE },
    inst, [t90], MARKET_DATE, close, { fetchSeries },
  );
  check('opened today → null (no entry-day EOD bar yet)', sameDay, null);

  const mixedExpiry = await scanPosition(
    { ...pos, legs: [SHORT_LEG, { ...LONG_LEG, expiration: '2026-04-17' }] },
    inst, [t90], MARKET_DATE, close, { fetchSeries },
  );
  check('mixed-expiry legs → error record (v1 unsupported)',
    mixedExpiry?.get('target-90')?.outcome, 'error');

  console.log('── runManageExitScan end-to-end ──');
  const docs = new Map<string, AnalysisResultDoc>();
  const results: unknown[] = [];
  await runManageExitScan(MARKET_DATE, {
    listActiveInstances: async () => ({ daily: [inst], signal: [] }),
    listOpenPositions: async () => [pos],
    fetchSeries,
    loadUnderlyingClose: async () => close,
    writeResultDoc: async (id, doc) => { docs.set(id, doc); },
    writeResult: async (_id, r) => { results.push(r); },
    now: () => new Date('2026-02-06T21:30:00Z'),
  });
  check('one result doc per registry exit', docs.size, EXIT_STRATEGIES.length);
  const docId = `QQQ-PCS-28-30-15-ALL_target-90`;
  const doc = docs.get(docId);
  check('doc id = {instanceId}_{exitId}', doc !== undefined, true);
  check('doc.contractListDocId = instanceId', doc?.contractListDocId, inst.id);
  check('doc.runId = instanceId', doc?.runId, inst.id);
  check('doc.symbol', doc?.symbol, 'QQQ');
  check('doc.templateId = variant template', doc?.templateId, 'pcs');
  check('doc.registryVersion', doc?.registryVersion, EXIT_REGISTRY_VERSION);
  check('doc.status', doc?.status, 'success');
  check('doc.trades length', doc?.trades.length, 1);
  check('trade outcome', doc?.trades[0].outcome, 'exit');
  check('observability result stamped', results.length, 1);

  // Skipped position → docs still written, empty trades.
  const docs2 = new Map<string, AnalysisResultDoc>();
  await runManageExitScan(MARKET_DATE, {
    listActiveInstances: async () => ({ daily: [inst], signal: [] }),
    listOpenPositions: async () => [{ ...pos, legs: [{ ...SHORT_LEG, contractID: undefined }] }],
    fetchSeries,
    loadUnderlyingClose: async () => close,
    writeResultDoc: async (id, d) => { docs2.set(id, d); },
    writeResult: async () => {},
    now: () => new Date('2026-02-06T21:30:00Z'),
  });
  check('skipped position → docs written with empty trades',
    docs2.get(docId)?.trades.length, 0);
  check('skipped docs still success status', docs2.get(docId)?.status, 'success');

  // NB: the optionsAnalysisStart gridVersion-0 gate is covered by
  // tests/functions/options-analysis/start.test.ts — importing start.ts
  // here double-instantiates firebase-admin-init (settings() once-only).

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('verify crashed:', e);
  process.exit(1);
});
