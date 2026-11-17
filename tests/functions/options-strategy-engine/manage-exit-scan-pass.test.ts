import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNetSeries,
  positionExitRecord,
  runManageExitScan,
  scanPosition,
} from '../../../functions/src/options-strategy-engine/passes/manage-exit-scan-pass';
import type {
  ManageExitScanDeps,
  ManageOpenPosition,
} from '../../../functions/src/options-strategy-engine/passes/manage-exit-scan-pass';
import type { RunnableManageInstance } from '../../../functions/src/options-strategy-engine/manage-instance-reader';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';
import type { PositionLeg } from '../../../functions/src/options-strategy-engine/types';
import type { ManageVariant } from '../../../shared/manage-variant-contracts';
import type { ExitStrategyDef } from '../../../shared/options-analysis-registry';
import { EXIT_STRATEGIES } from '../../../shared/options-analysis-registry';
import type { AnalysisResultDoc } from '../../../shared/options-analysis-contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../shared/options-contract-contracts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MARKET_DATE = '2026-02-06'; // Friday — a week after open
const OPEN_DATE = '2026-01-30'; // Friday
const EXPIRY = '2026-02-27'; // 28 DTE at open

function pscVariant(): ManageVariant {
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

function makeInstance(overrides: Partial<RunnableManageInstance> = {}): RunnableManageInstance {
  return {
    id: 'QQQ-PCS-28-30-15-ALL',
    variantRef: 'pcs-28-30-15',
    variant: pscVariant(),
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'ACTIVE',
    userId: 'test-user',
    paperAccountId: 'acct-1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

const SHORT_LEG: PositionLeg = {
  id: 'leg-short',
  type: OptionType.PUT,
  side: TradeSide.SHORT,
  strike: 480,
  expiration: EXPIRY,
  openDate: OPEN_DATE,
  contractID: 'QQQ260227P00480000',
  premium: 2.5,
};
const LONG_LEG: PositionLeg = {
  id: 'leg-long',
  type: OptionType.PUT,
  side: TradeSide.LONG,
  strike: 470,
  expiration: EXPIRY,
  openDate: OPEN_DATE,
  contractID: 'QQQ260227P00470000',
  premium: 1.0,
};

function makePosition(overrides: Partial<ManageOpenPosition> = {}): ManageOpenPosition {
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
    ...overrides,
  };
}

/** Decaying short-put-spread marks — net cost-to-close falls from the
 *  1.50 entry credit toward ~0.20 (fires target-90 & price-50; 1.00
 *  exactly hits price-100 on day 3). */
function legSeries(shortMarks: number[], longMarks: number[], dates: string[]) {
  return { shortMarks, longMarks, dates };
}

const DATES = [
  OPEN_DATE,
  '2026-02-02',
  '2026-02-03',
  '2026-02-04',
  '2026-02-05',
  MARKET_DATE,
];
const DECAY = legSeries(
  [2.5, 2.25, 1.875, 1.625, 1.25, 0.75],
  [1.0, 0.875, 0.75, 0.625, 0.5, 0.625],
  DATES,
);
// Net (binary-exact): 1.50, 1.375, 1.125, 1.00, 0.75, 0.125

function seriesResp(marks: number[], dates: string[]): PartnerHistoricalOptionsContractV2Response {
  return {
    symbol: 'QQQ',
    contractID: 'X',
    series: dates.map((date, i) => ({ date, mark: String(marks[i]) })),
  } as PartnerHistoricalOptionsContractV2Response;
}

/** fetchSeries dep — routes by contractID to short/long mark lists. */
function fetcher(data = DECAY) {
  const calls: string[] = [];
  const fn: NonNullable<ManageExitScanDeps['fetchSeries']> = async ({ contractID }) => {
    calls.push(contractID);
    if (contractID === SHORT_LEG.contractID) return seriesResp(data.shortMarks, data.dates);
    if (contractID === LONG_LEG.contractID) return seriesResp(data.longMarks, data.dates);
    throw new Error(`unexpected contract ${contractID}`);
  };
  return { calls, fn };
}

const TARGET90 = EXIT_STRATEGIES.find((r) => r.exitId === 'target-90') as ExitStrategyDef;
const PRICE100 = EXIT_STRATEGIES.find((r) => r.exitId === 'price-100') as ExitStrategyDef;

// ── buildNetSeries ──────────────────────────────────────────────────────────

describe('buildNetSeries', () => {
  it('computes signed cost-to-close across legs (short +, long −)', () => {
    const bars = buildNetSeries(
      [SHORT_LEG, LONG_LEG],
      [
        [{ date: '2026-01-30', mark: 2.5 }],
        [{ date: '2026-01-30', mark: 1.0 }],
      ],
    );
    assert.deepEqual(bars, [{ date: '2026-01-30', mark: 1.5 }]);
  });

  it('inner-joins dates — a date missing from any leg drops out', () => {
    const bars = buildNetSeries(
      [SHORT_LEG, LONG_LEG],
      [
        [
          { date: '2026-01-30', mark: 2.5 },
          { date: '2026-02-02', mark: 2.2 },
        ],
        [{ date: '2026-01-30', mark: 1.0 }],
      ],
    );
    assert.equal(bars.length, 1);
    assert.equal(bars[0].date, '2026-01-30');
  });

  it('returns [] when leg/bar counts mismatch', () => {
    assert.deepEqual(buildNetSeries([SHORT_LEG, LONG_LEG], [[]]), []);
    assert.deepEqual(buildNetSeries([], []), []);
  });
});

// ── positionExitRecord ──────────────────────────────────────────────────────

describe('positionExitRecord', () => {
  const pos = makePosition();
  const inst = makeInstance();
  const net = buildNetSeries(
    [SHORT_LEG, LONG_LEG],
    [DECAY.dates.map((d, i) => ({ date: d, mark: DECAY.shortMarks[i] })), DECAY.dates.map((d, i) => ({ date: d, mark: DECAY.longMarks[i] }))],
  );
  const close = new Map([[EXPIRY, 500]]);

  it('fires a target exit with entry/exit marks + daysHeld', () => {
    const rec = positionExitRecord(pos, inst, 'target-90', TARGET90, net, EXPIRY, close, MARKET_DATE);
    assert.equal(rec.outcome, 'exit');
    if (rec.outcome !== 'exit') return;
    assert.equal(rec.contractId, pos.id); // position-level traceability
    assert.equal(rec.entryMark, 1.5);
    assert.equal(rec.exitDate, '2026-02-06');
    assert.equal(rec.exitPrice, 0.125);
    assert.equal(rec.daysHeld, 7);
    assert.equal(rec.mae.date >= rec.pickDate, true);
    assert.equal(rec.mfe.date >= rec.pickDate, true);
  });

  it('absolute-price fires on the first bar at/below the level', () => {
    const rec = positionExitRecord(pos, inst, 'price-100', PRICE100, net, EXPIRY, close, MARKET_DATE);
    assert.equal(rec.outcome, 'exit');
    if (rec.outcome !== 'exit') return;
    assert.equal(rec.exitDate, '2026-02-04'); // net 1.00 exactly
  });

  it('hold-to-expiry with a future expiry yields open', () => {
    const expiry = EXIT_STRATEGIES.find((r) => r.exitId === 'expiry') as ExitStrategyDef;
    const rec = positionExitRecord(pos, inst, 'expiry', expiry, net, EXPIRY, close, MARKET_DATE);
    assert.equal(rec.outcome, 'open');
    if (rec.outcome !== 'open') return;
    assert.equal(rec.lastBarDate, MARKET_DATE);
    assert.equal(rec.terminalMark, 0.125);
  });

  it('reaching the expiry bar yields expired with net intrinsic', () => {
    const expiry = EXIT_STRATEGIES.find((r) => r.exitId === 'expiry') as ExitStrategyDef;
    const past = '2026-03-02'; // after EXPIRY
    // Extend the net series to expiry — OTM expiry (underlying 500 > 480):
    const long = [
      ...net,
      { date: '2026-02-09', mark: 0.1 },
      { date: EXPIRY, mark: 0.0 },
    ];
    const rec = positionExitRecord(pos, inst, 'expiry', expiry, long, EXPIRY, close, past);
    assert.equal(rec.outcome, 'expired');
    if (rec.outcome !== 'expired') return;
    assert.equal(rec.expiredItm, false);
    assert.equal(rec.intrinsicAtExpiry, 0);
    assert.equal(rec.terminalMark, 0); // intrinsic, not last mark
    assert.equal(rec.daysHeld, 28);
  });

  it('net intrinsic at ITM expiry is the signed cost-to-close', () => {
    const expiry = EXIT_STRATEGIES.find((r) => r.exitId === 'expiry') as ExitStrategyDef;
    const itm = new Map([[EXPIRY, 460]]); // below both strikes
    const long = [...net, { date: EXPIRY, mark: 9.5 }];
    const rec = positionExitRecord(pos, inst, 'expiry', expiry, long, EXPIRY, itm, '2026-03-02');
    assert.equal(rec.outcome, 'expired');
    if (rec.outcome !== 'expired') return;
    // short 480p intrinsic 20, long 470p intrinsic 10 → net cost 10
    assert.equal(rec.intrinsicAtExpiry, 10);
    assert.equal(rec.terminalMark, 10); // intrinsic ≠ 9.5 last mark
    assert.equal(rec.expiredItm, true);
    assert.equal(rec.assignmentDistancePct, 20 / 460 * 100);
  });

  it('empty series → error record', () => {
    const rec = positionExitRecord(pos, inst, 'target-90', TARGET90, [], EXPIRY, close, MARKET_DATE);
    assert.equal(rec.outcome, 'error');
    if (rec.outcome !== 'error') return;
    assert.match(rec.error, /no net series/);
  });

  it('missing entry-day bar → error record', () => {
    const rec = positionExitRecord(
      pos, inst, 'target-90', TARGET90,
      [{ date: '2026-02-02', mark: 1.3 }],
      EXPIRY, close, MARKET_DATE,
    );
    assert.equal(rec.outcome, 'error');
    if (rec.outcome !== 'error') return;
    assert.match(rec.error, /entry-day bar/);
  });

  it('truncated series past expiry → error record', () => {
    const rec = positionExitRecord(
      pos, inst, 'target-90', TARGET90,
      [{ date: OPEN_DATE, mark: 1.5 }, { date: '2026-02-02', mark: 1.3 }],
      EXPIRY, close, '2026-03-05', // expiry already past
    );
    assert.equal(rec.outcome, 'error');
    if (rec.outcome !== 'error') return;
    assert.match(rec.error, /truncated/);
  });
});

// ── scanPosition ────────────────────────────────────────────────────────────

describe('scanPosition', () => {
  const inst = makeInstance();

  it('produces one record per rule', async () => {
    const { fn } = fetcher();
    const out = await scanPosition(makePosition(), inst, [TARGET90, PRICE100], MARKET_DATE,
      new Map([[EXPIRY, 500]]), { fetchSeries: fn });
    assert.ok(out);
    assert.deepEqual([...out.keys()].sort(), ['price-100', 'target-90']);
    assert.equal(out.get('target-90')?.outcome, 'exit');
    assert.equal(out.get('price-100')?.outcome, 'exit');
  });

  it('leg fetch failure → error record per rule (never throws)', async () => {
    const out = await scanPosition(makePosition(), inst, [TARGET90, PRICE100], MARKET_DATE,
      new Map(), {
        fetchSeries: async () => {
          throw new Error('upstream 500');
        },
      });
    assert.ok(out);
    for (const rec of out.values()) {
      assert.equal(rec.outcome, 'error');
      if (rec.outcome === 'error') assert.match(rec.error, /fetch failed/);
    }
  });

  it('missing leg contractID → null (caller skips)', async () => {
    const out = await scanPosition(
      makePosition({ legs: [{ ...SHORT_LEG, contractID: undefined }, LONG_LEG] }),
      inst, [TARGET90], MARKET_DATE, new Map(), { fetchSeries: fetcher().fn },
    );
    assert.equal(out, null);
  });

  it('opened today → null (EOD corpus cannot carry an entry-day bar yet)', async () => {
    const out = await scanPosition(
      makePosition({ openDate: MARKET_DATE }),
      inst, [TARGET90], MARKET_DATE, new Map(), { fetchSeries: fetcher().fn },
    );
    assert.equal(out, null);
  });

  it('resp ok:false → error record per rule', async () => {
    const out = await scanPosition(makePosition(), inst, [TARGET90], MARKET_DATE, new Map(), {
      fetchSeries: async () =>
        ({ ok: false, symbol: 'QQQ', contractID: 'X', series: [] }) as never,
    });
    assert.equal(out?.get('target-90')?.outcome, 'error');
  });
});

// ── runManageExitScan ───────────────────────────────────────────────────────

describe('runManageExitScan', () => {
  function makeDeps(overrides: Partial<ManageExitScanDeps> = {}) {
    const docs = new Map<string, AnalysisResultDoc>();
    const results: { instanceId: string; result: unknown }[] = [];
    const { fn } = fetcher();
    const d: ManageExitScanDeps = {
      listActiveInstances: async () => ({ daily: [makeInstance()], signal: [] }),
      listOpenPositions: async () => [makePosition()],
      fetchSeries: fn,
      loadUnderlyingClose: async () => new Map([[EXPIRY, 500]]),
      writeResultDoc: async (id, doc) => {
        docs.set(id, doc);
      },
      writeResult: async (instanceId, result) => {
        results.push({ instanceId, result });
      },
      now: () => new Date('2026-02-06T21:30:00Z'),
      ...overrides,
    };
    return { docs, results, deps: d };
  }

  it('writes one result doc per registry exit under {instanceId}_{exitId}', async () => {
    const { docs, deps } = makeDeps();
    await runManageExitScan(MARKET_DATE, deps);
    assert.equal(docs.size, EXIT_STRATEGIES.length);
    for (const rule of EXIT_STRATEGIES) {
      const doc = docs.get(`QQQ-PCS-28-30-15-ALL_${rule.exitId}`);
      assert.ok(doc, `missing doc for ${rule.exitId}`);
      assert.equal(doc.contractListDocId, 'QQQ-PCS-28-30-15-ALL');
      assert.equal(doc.exitId, rule.exitId);
      assert.equal(doc.status, 'success');
      assert.equal(doc.trades.length, 1);
    }
    // target-90 fired on the decaying series; expiry stayed open.
    assert.equal(docs.get('QQQ-PCS-28-30-15-ALL_target-90')?.trades[0].outcome, 'exit');
    assert.equal(docs.get('QQQ-PCS-28-30-15-ALL_expiry')?.trades[0].outcome, 'open');
  });

  it('stamps the observability result on daily-analysis/latest', async () => {
    const { results, deps } = makeDeps();
    await runManageExitScan(MARKET_DATE, deps);
    assert.equal(results.length, 1);
    const r = results[0].result as { positionsScanned: number; exitsEvaluated: number; resultDocIds: string[] };
    assert.equal(r.positionsScanned, 1);
    assert.equal(r.exitsEvaluated, EXIT_STRATEGIES.length);
    assert.equal(r.resultDocIds.length, EXIT_STRATEGIES.length);
  });

  it('skips positions with no usable series (missing contractID)', async () => {
    const { docs, results, deps } = makeDeps({
      listOpenPositions: async () => [
        makePosition({ legs: [{ ...SHORT_LEG, contractID: undefined }] }),
      ],
    });
    await runManageExitScan(MARKET_DATE, deps);
    assert.equal(docs.size, EXIT_STRATEGIES.length);
    for (const doc of docs.values()) assert.equal(doc.trades.length, 0);
    const r = results[0].result as { positionsSkipped: number };
    assert.equal(r.positionsSkipped, 1);
  });

  it('non-paper instances evaluate nothing (v2 real-mode seam)', async () => {
    const { docs, results, deps } = makeDeps({
      listActiveInstances: async () => ({
        daily: [makeInstance({ mode: 'real' })],
        signal: [],
      }),
    });
    await runManageExitScan(MARKET_DATE, deps);
    assert.equal(docs.size, 0);
    assert.equal(results.length, 0);
  });

  it('one instance failure does not abort later instances', async () => {
    const good = makeInstance({ id: 'GOOD-PCS-28-30-15-ALL' });
    const docs = new Map<string, AnalysisResultDoc>();
    const { fn } = fetcher();
    await runManageExitScan(MARKET_DATE, {
      listActiveInstances: async () => ({
        daily: [makeInstance(), good],
        signal: [],
      }),
      listOpenPositions: async (id) =>
        id === good.id ? [makePosition({ instanceId: good.id })] : [],
      fetchSeries: fn,
      loadUnderlyingClose: async () => new Map([[EXPIRY, 500]]),
      writeResultDoc: async (id, doc) => {
        if (id.startsWith('QQQ-')) throw new Error('firestore unavailable');
        docs.set(id, doc);
      },
      writeResult: async () => {},
      now: () => new Date('2026-02-06T21:30:00Z'),
    });
    // First instance's doc writes threw — the second still completed.
    assert.equal(docs.size, EXIT_STRATEGIES.length);
    for (const id of docs.keys()) assert.ok(id.startsWith('GOOD-'));
  });

  it('closed positions are excluded upstream by the OPEN filter', async () => {
    const { docs, deps } = makeDeps({
      listOpenPositions: async () => [], // repo filter already applied
    });
    await runManageExitScan(MARKET_DATE, deps);
    assert.equal(docs.size, EXIT_STRATEGIES.length);
    for (const doc of docs.values()) {
      assert.equal(doc.trades.length, 0);
      assert.equal(doc.status, 'success');
    }
  });
});
