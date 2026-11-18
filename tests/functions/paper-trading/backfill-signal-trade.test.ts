/**
 * @topic #553 — Paper Trading Infra (task #1575)
 *
 * Integration tests for the historical backfill mint: a picked signal
 * occurrence becomes a real PaperTrade — entry fill at the signal-bar
 * close (SDS_BARS), marks backfilled over stored bars, all curated
 * variant runs walked forward in memory, committed once, then the real
 * ledger close when the walk fires. Deps are injected; the ledger runs
 * REAL applyEntryFill/applyExitFill over an in-memory txn store so the
 * consistency pin against replaySignalToRow is honest.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  AUTO_PAPER_USER_ID,
  CURATED_GOVERNING_POLICY,
  CURATED_VARIANT_KEYS,
  DEFAULT_TRAILING_STOP_KEY,
  PaperTradeSource,
  PaperTradeStatus,
  type PaperAccount,
  type PaperTrade,
  type SignalPick,
} from '../../../shared/paper-trading-contracts';
import {
  buildAccountId,
  buildTradeId,
  EQUITY_TRADE_DESC,
  signalDedupeKey,
  signalTradeDesc,
} from '../../../shared/paper-trading-ids';
import { stSignalOccurrenceId } from '../../../shared/st-ids';
import type { OhlcBar } from '../../../functions/src/common/market-data-types';
import type { StSignal } from '../../../shared/st-signals';
import { StSignalDirection } from '../../../functions/src/st-cloud-function/signals';
import { applyEntryFill, applyExitFill, type EntryFillInput, type ExitFillInput } from '../../../functions/src/paper-trading/ledger';
import { backfillSignalTrade, type BackfillSignalTradeDeps } from '../../../functions/src/paper-trading/passes/backfill-signal-trade';
import { handleGeneratePaperSignalTrades, type GeneratePaperSignalTradesDeps } from '../../../functions/src/paper-trading/signal-trade-callables';
import { replaySignalToRow } from '../../../functions/src/paper-trading/analysis/replay';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SYM = 'QQQM';
const BAR_DATE = '2026-01-05'; // entry (signal) bar
const SIG_TYPE = 'D_ST_TREND_RIDER_V2_LONG';
const PICK: SignalPick = { symbol: SYM, signalBarDate: BAR_DATE, signalType: SIG_TYPE };

function bar(d: string, c: number): OhlcBar {
  return { d, o: c, h: c, l: c, c };
}

function makeSignal(overrides: Partial<StSignal> = {}): StSignal {
  return {
    symbol: SYM,
    signalType: SIG_TYPE,
    barDate: BAR_DATE,
    marketDate: BAR_DATE,
    direction: TradeSide.LONG,
    timeframe: 'D' as StSignal['timeframe'],
    indicators: { zoneV1: 3 },
    status: 'CONFIRMED' as StSignal['status'],
    sourceRunId: 'run-1',
    runIds: ['run-1'],
    ticketIds: [],
    positionGroupIds: [],
    createdAt: '2026-01-05T00:00:00Z',
    updatedAt: '2026-01-05T00:00:00Z',
    ...overrides,
  };
}

// ── Faithful in-memory ledger (real applyEntryFill/applyExitFill) ────────────

interface Store {
  trades: Map<string, PaperTrade>;
  accounts: Map<string, PaperAccount>;
  backfillCommits: { tradeId: string; update: Record<string, unknown> }[];
  ticketsEmitted: Record<string, unknown>[];
  ticketsFilled: string[];
  ticketsFailed: string[];
  entryInputs: EntryFillInput[];
  exitInputs: ExitFillInput[];
}

function makeDeps(opts: {
  signal?: StSignal | null;
  bars?: OhlcBar[];
  ticketsFail?: boolean;
}) {
  const store: Store = {
    trades: new Map(),
    accounts: new Map(),
    backfillCommits: [],
    ticketsEmitted: [],
    ticketsFilled: [],
    ticketsFailed: [],
    entryInputs: [],
    exitInputs: [],
  };

  const txn = {
    getTrade: async (id: string) => store.trades.get(id) ?? null,
    getAccount: async (uid: string) => store.accounts.get(buildAccountId(uid)) ?? null,
    write: async (plan: { accountId: string; account: PaperAccount; tradeId: string; trade: PaperTrade }) => {
      store.accounts.set(plan.accountId, plan.account);
      store.trades.set(plan.tradeId, plan.trade);
    },
  };
  const ledger = { transact: async <T>(cb: (t: typeof txn) => Promise<T>) => cb(txn) };

  const deps: BackfillSignalTradeDeps = {
    getSignal: async () => opts.signal === undefined ? makeSignal() : opts.signal,
    getBars: async () => opts.bars ?? [],
    getTrade: async (id) => store.trades.get(id) ?? null,
    applyEntryFill: async (input) => {
      store.entryInputs.push(input);
      return applyEntryFill(input, ledger);
    },
    applyExitFill: async (input) => {
      store.exitInputs.push(input);
      return applyExitFill(input, ledger);
    },
    commitBackfill: async (tradeId, update) => {
      store.backfillCommits.push({ tradeId, update: update as Record<string, unknown> });
      const t = store.trades.get(tradeId)!;
      store.trades.set(tradeId, { ...t, ...update });
    },
    tickets: {
      emit: async (input) => {
        if (opts.ticketsFail) throw new Error('tickets down');
        store.ticketsEmitted.push(input as unknown as Record<string, unknown>);
        return `pap_${input.idSeed}`;
      },
      markFilled: async (ticketId: string) => {
        store.ticketsFilled.push(ticketId);
        return { applied: true, ticketId, to: 'filled' as const };
      },
      markFailed: async (ticketId: string) => {
        store.ticketsFailed.push(ticketId);
        return { applied: true, ticketId, to: 'failed' as const };
      },
    } satisfies NonNullable<BackfillSignalTradeDeps['tickets']>,
    now: () => new Date('2026-02-01T12:00:00Z'),
  };
  return { deps, store };
}

function tradeIdFor(pick: SignalPick = PICK): string {
  return buildTradeId(
    new Date(`${pick.signalBarDate}T12:00:00Z`),
    'sig',
    pick.symbol,
    signalTradeDesc(pick.signalType),
  );
}

// ── backfillSignalTrade ──────────────────────────────────────────────────────

describe('backfillSignalTrade', () => {
  it('mints entry at signal-bar close via SDS_BARS with the curated set + policy marker', async () => {
    // 30 prior flat bars (SMA-20 = 100), entry at 100, then a rising tape.
    const bars = [
      ...Array.from({ length: 30 }, (_, i) => bar(`2025-12-${String(i + 1).padStart(2, '0')}`, 100)),
      bar(BAR_DATE, 100),
      bar('2026-01-06', 110),
      bar('2026-01-07', 120),
      bar('2026-01-08', 130),
      bar('2026-01-09', 140),
      bar('2026-01-12', 155), // target-50 (150) fires here
      bar('2026-01-13', 160),
    ];
    const { deps, store } = makeDeps({ bars });
    const res = await backfillSignalTrade(PICK, deps);

    assert.equal(res.status, 'created');
    assert.equal(res.tradeId, tradeIdFor());
    assert.equal(res.signalId, signalDedupeKey(SYM, SIG_TYPE, BAR_DATE));

    const entry = store.entryInputs[0];
    assert.equal(entry.tradeId, tradeIdFor());
    assert.equal(entry.userId, AUTO_PAPER_USER_ID);
    assert.equal(entry.fill.role, 'entry');
    assert.equal(entry.fill.price, 100); // signal-bar close
    assert.equal(entry.fill.date, BAR_DATE);
    assert.equal(entry.fill.quoteSource, OptionQuoteSource.SDS_BARS);
    assert.equal(entry.fill.rawQuoteRef, undefined);
    assert.equal(entry.underlyingClose, 100);
    assert.deepEqual(entry.dims.variantKeys, [...CURATED_VARIANT_KEYS]);
    assert.equal(entry.dims.governingVariant, 'trailing-8'); // policy fallback seed
    assert.equal(entry.dims.governingPolicy, CURATED_GOVERNING_POLICY);
    assert.equal(entry.dims.source, PaperTradeSource.SIGNAL);
    assert.equal(entry.dims.signalId, signalDedupeKey(SYM, SIG_TYPE, BAR_DATE));
    assert.equal(entry.order.side, TradeSide.LONG);
    assert.equal(entry.legs[0].kind, 'share');

    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.governingPolicy, CURATED_GOVERNING_POLICY); // marker on the doc
    assert.equal(minted.status, PaperTradeStatus.CLOSED); // target-50 fired
    const exitFill = minted.fills.find((f) => f.role === 'exit')!;
    assert.equal(exitFill.date, '2026-01-12');
    assert.equal(exitFill.price, 155);
    assert.equal(exitFill.quoteSource, OptionQuoteSource.SDS_BARS);
    assert.equal(minted.governingVariant, 'target-50'); // closer attribution mirror

    const target = minted.variantRuns.find((r) => r.variantKey === 'target-50')!;
    assert.equal(target.state, 'EXITED');
    assert.equal(target.exitEvent?.date, '2026-01-12');
    assert.equal(target.exitEvent?.price, 155);

    // Walk stopped at the firing bar — later bar's mark never lands.
    assert.equal(minted.marks['2026-01-13'], undefined);
    assert.equal(minted.marks['2026-01-12'].mark, 155);
  });

  it('governing trailing-8 closes on breach day; same-day triggers shadow-record', async () => {
    // 30 prior flat 100 bars → sma20=100. Entry 100, then gap to 90.
    const bars = [
      ...Array.from({ length: 30 }, (_, i) => bar(`2025-12-${String(i + 1).padStart(2, '0')}`, 100)),
      bar(BAR_DATE, 100),
      bar('2026-01-06', 90),
      bar('2026-01-07', 91),
    ];
    const { deps, store } = makeDeps({ bars });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');

    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.status, PaperTradeStatus.CLOSED);
    // Policy picked trailing-8 (deepest 92 < entry → fallback trailing-8):
    // trailing-5 fired first in array order → shadow; trailing-8 closes;
    // ma-close-20 (sma=100, mark 90 < 100) fires same-day → shadow.
    assert.equal(store.exitInputs.length, 1);
    assert.equal(store.exitInputs[0].fill.price, 90);
    assert.equal(store.exitInputs[0].fill.date, '2026-01-06');
    assert.equal(minted.governingVariant, 'trailing-8');

    const byKey = Object.fromEntries(minted.variantRuns.map((r) => [r.variantKey, r]));
    assert.equal(byKey['trailing-5'].state, 'EXITED');
    assert.equal(byKey['trailing-5'].exitEvent?.price, 90);
    assert.equal(byKey['trailing-8'].state, 'EXITED');
    assert.equal(byKey['ma-close-20'].state, 'EXITED');
    // Insufficient history → these runs stayed ACTIVE (no blind fire).
    assert.equal(byKey['ma-close-50'].state, 'ACTIVE');
    assert.equal(byKey['ma-close-100'].state, 'ACTIVE');
    assert.equal(byKey['target-50'].state, 'ACTIVE');
    // Only ONE commit carrying marks + final runs, before the exit fill.
    assert.equal(store.backfillCommits.length, 1);
    assert.equal(minted.marks['2026-01-07'], undefined);
  });

  it('never-fires stays OPEN with all marks committed and ratcheted runs', async () => {
    const bars = [
      ...Array.from({ length: 30 }, (_, i) => bar(`2025-12-${String(i + 1).padStart(2, '0')}`, 100)),
      bar(BAR_DATE, 100),
      bar('2026-01-06', 102),
      bar('2026-01-07', 104),
      bar('2026-01-08', 103),
      bar('2026-01-09', 106),
    ];
    const { deps, store } = makeDeps({ bars });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');

    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.status, PaperTradeStatus.OPEN);
    assert.equal(store.exitInputs.length, 0);
    assert.equal(store.backfillCommits.length, 1);
    // Every post-entry bar landed a mark.
    assert.deepEqual(Object.keys(minted.marks).sort(), [
      BAR_DATE, '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
    ]);
    // Trailing runs ratcheted the high watermark to the 106 peak.
    const t8 = minted.variantRuns.find((r) => r.variantKey === 'trailing-8')!;
    assert.equal(t8.state, 'ACTIVE');
    assert.equal(t8.workingState.highWaterMark, 106);
    // unrealizedPnl stamped from the last mark: (106 - 100) * 1 share.
    assert.equal(minted.unrealizedPnl, 6);
    // Leg mark + lastMarkedAt walked to the final bar (the resume seam's
    // walked discriminator lives on lastMarkedAt).
    assert.equal(minted.legs[0].lastMark, 106);
    assert.equal(minted.lastMarkedAt, '2026-01-09');
    // The mirror tracks the last policy pick, not a stale seed.
    assert.equal(typeof minted.governingVariant, 'string');
  });

  it('signal bar is the last stored bar → OPEN immediately, entry mark only', async () => {
    const bars = [bar(BAR_DATE, 100)];
    const { deps, store } = makeDeps({ bars });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');
    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.status, PaperTradeStatus.OPEN);
    assert.deepEqual(Object.keys(minted.marks), [BAR_DATE]);
    assert.equal(minted.unrealizedPnl, 0);
    assert.equal(minted.lastMarkedAt, BAR_DATE);
  });

  it('dedupes a re-minted pick — no second entry', async () => {
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 101)];
    const { deps, store } = makeDeps({ bars });
    const first = await backfillSignalTrade(PICK, deps);
    assert.equal(first.status, 'created');
    const second = await backfillSignalTrade(PICK, deps);
    assert.equal(second.status, 'deduped');
    assert.equal(second.tradeId, first.tradeId);
    assert.equal(store.entryInputs.length, 1);
  });

  it('dedupes a live auto-ingested trade sharing the id — never resumes foreign docs', async () => {
    // Live ingest fills on the dispatch date (after the signal bar)
    // with live-quote provenance. The marks audit alone would resume it
    // (bars between signal bar and fill date are unmarked) and replay
    // pre-entry history — possibly minting an exit dated before the
    // entry fill. The provenance gate must dedupe instead.
    const bars = [
      bar(BAR_DATE, 100),
      bar('2026-01-06', 102),
      bar('2026-01-07', 103),
      bar('2026-01-08', 104),
    ];
    const { deps, store } = makeDeps({ bars });
    // Seed the doc the way live ingest does — fill on the dispatch date.
    await deps.applyEntryFill({
      userId: AUTO_PAPER_USER_ID,
      tradeId: tradeIdFor(),
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      legs: [
        {
          kind: 'share',
          side: TradeSide.LONG,
          quantity: 1,
          multiplier: 1,
          entryMark: 103,
          lastMark: 103,
        },
      ],
      fill: {
        fillId: `entry-${tradeIdFor()}`,
        role: 'entry',
        date: '2026-01-07', // dispatch date ≠ signalBarDate
        price: 103,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      underlyingClose: 103,
      dims: {
        source: PaperTradeSource.SIGNAL,
        symbol: SYM,
        expression: EQUITY_TRADE_DESC,
        governingVariant: DEFAULT_TRAILING_STOP_KEY,
        variantKeys: [...CURATED_VARIANT_KEYS],
        signalId: signalDedupeKey(SYM, SIG_TYPE, BAR_DATE),
        governingPolicy: CURATED_GOVERNING_POLICY,
      },
      now: '2026-01-07T21:00:00Z',
    });
    assert.equal(store.entryInputs.length, 1); // the seed

    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'deduped');
    const doc = store.trades.get(tradeIdFor())!;
    assert.equal(doc.status, PaperTradeStatus.OPEN);
    assert.equal(doc.fills.length, 1); // no fabricated exit
    assert.equal(store.entryInputs.length, 1); // no second entry
    assert.equal(store.exitInputs.length, 0);
    assert.equal(store.backfillCommits.length, 0); // no walk commit
    assert.equal(store.ticketsEmitted.length, 0); // no pick ticket
  });

  it('resumes a crashed mint — commit throw leaves an unwalked doc a retry completes', async () => {
    // Never-fire tape: the commit throw strands an OPEN entry-only doc.
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 102), bar('2026-01-07', 103)];
    const { deps, store } = makeDeps({ bars });
    const realCommit = deps.commitBackfill;
    deps.commitBackfill = async () => {
      throw new Error('quota exceeded');
    };
    const first = await backfillSignalTrade(PICK, deps);
    assert.equal(first.status, 'error');
    // Entry committed, walk state never did — no lastMarkedAt.
    const half = store.trades.get(tradeIdFor())!;
    assert.equal(half.status, PaperTradeStatus.OPEN);
    assert.equal(half.lastMarkedAt, undefined);

    deps.commitBackfill = realCommit;
    const second = await backfillSignalTrade(PICK, deps);
    assert.equal(second.status, 'created');
    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.status, PaperTradeStatus.OPEN);
    assert.equal(minted.lastMarkedAt, '2026-01-07');
    assert.deepEqual(
      Object.keys(minted.marks).sort(),
      [BAR_DATE, '2026-01-06', '2026-01-07'].sort(),
    );
    assert.equal(store.entryInputs.length, 1); // no second entry fill
  });

  it('resumes a crashed mint even after the nightly mark-pass stamped it', async () => {
    // NEW-2 pin: lastMarkedAt is NOT the discriminator — the nightly
    // mark-pass stamps it on every OPEN signal trade. A crashed mint
    // that survived a nightly still misses the walk-owned marks.
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 102), bar('2026-01-07', 103)];
    const { deps, store } = makeDeps({ bars });
    const realCommit = deps.commitBackfill;
    deps.commitBackfill = async () => {
      throw new Error('quota exceeded');
    };
    await backfillSignalTrade(PICK, deps);
    // Simulate a nightly mark-pass on the unwalked doc.
    const half = store.trades.get(tradeIdFor())!;
    store.trades.set(tradeIdFor(), {
      ...half,
      lastMarkedAt: '2026-01-07',
      marks: { ...half.marks, '2026-01-07': { mark: 103, underlyingClose: 103 } },
    });

    deps.commitBackfill = realCommit;
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');
    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.status, PaperTradeStatus.OPEN);
    assert.deepEqual(
      Object.keys(minted.marks).sort(),
      [BAR_DATE, '2026-01-06', '2026-01-07'].sort(),
    );
    assert.equal(store.entryInputs.length, 1);
  });

  it('dedupes a mint that closed before its commit threw (nightly heals runs)', async () => {
    // Under the close→annotate order a commit throw AFTER the ledger
    // close leaves a CLOSED doc — correct to dedupe, not re-mint.
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 90)];
    const { deps, store } = makeDeps({ bars });
    deps.commitBackfill = async () => {
      throw new Error('quota exceeded');
    };
    const first = await backfillSignalTrade(PICK, deps);
    assert.equal(first.status, 'error');
    assert.equal(store.trades.get(tradeIdFor())?.status, PaperTradeStatus.CLOSED);
    const second = await backfillSignalTrade(PICK, deps);
    assert.equal(second.status, 'deduped');
    assert.equal(store.entryInputs.length, 1);
  });

  it('resumes after an exit-fill failure — OPEN seed walks to CLOSED on retry', async () => {
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 90)];
    const { deps, store } = makeDeps({ bars });
    const realExit = deps.applyExitFill;
    deps.applyExitFill = async () => {
      throw new Error('ledger busy');
    };
    const first = await backfillSignalTrade(PICK, deps);
    assert.equal(first.status, 'error');
    assert.equal(store.trades.get(tradeIdFor())?.status, PaperTradeStatus.OPEN);

    deps.applyExitFill = realExit;
    const second = await backfillSignalTrade(PICK, deps);
    assert.equal(second.status, 'created');
    assert.equal(store.trades.get(tradeIdFor())?.status, PaperTradeStatus.CLOSED);
    assert.equal(store.exitInputs.length, 1);
  });

  it('marks the staged ticket failed when the mint dies after emit', async () => {
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 101)];
    const { deps, store } = makeDeps({ bars });
    deps.applyEntryFill = async () => {
      throw new Error('ledger quota');
    };
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.deepEqual(store.ticketsFailed, [`pap_${tradeIdFor()}`]);
    assert.equal(store.ticketsFilled.length, 0);
  });

  it('leaves the ticket filled when the mint dies AFTER the entry lands', async () => {
    // A failure past the ledger entry is a resumable mint, not a failed
    // order — the ticket's "filled" stays the truth.
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 102)];
    const { deps, store } = makeDeps({ bars });
    deps.commitBackfill = async () => {
      throw new Error('quota exceeded');
    };
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.equal(store.ticketsEmitted.length, 1);
    assert.equal(store.ticketsFilled.length, 1);
    assert.equal(store.ticketsFailed.length, 0);
  });

  it('errors on a non-finite signal-bar close', async () => {
    const { deps, store } = makeDeps({ bars: [bar(BAR_DATE, NaN)] });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.equal(store.entryInputs.length, 0);
  });

  it('skips non-finite/interim bars mid-history instead of minting NaN marks', async () => {
    const bars = [
      bar(BAR_DATE, 100),
      { ...bar('2026-01-06', NaN) },
      { ...bar('2026-01-07', 103), barStatus: 0 as const },
      bar('2026-01-08', 104),
    ];
    const { deps, store } = makeDeps({ bars });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');
    const minted = store.trades.get(tradeIdFor())!;
    assert.equal(minted.marks['2026-01-06'], undefined);
    assert.equal(minted.marks['2026-01-07'], undefined);
    assert.equal(minted.marks['2026-01-08'].mark, 104);
    assert.equal(minted.lastMarkedAt, '2026-01-08');
  });

  it('errors when stored bars are not d-ascending', async () => {
    const { deps, store } = makeDeps({ bars: [bar(BAR_DATE, 100), bar('2026-01-03', 99)] });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.equal(store.entryInputs.length, 0);
  });

  it('errors when the signal doc identity disagrees with the pick', async () => {
    const { deps, store } = makeDeps({
      signal: makeSignal({ barDate: '2026-01-04' }),
      bars: [bar(BAR_DATE, 100)],
    });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.equal(store.entryInputs.length, 0);
  });

  it('errors without writes when the signal doc is missing', async () => {
    const { deps, store } = makeDeps({ signal: null, bars: [bar(BAR_DATE, 100)] });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.equal(store.entryInputs.length, 0);
    assert.equal(store.trades.size, 0);
  });

  it('errors when the signal bar is absent from stored bars', async () => {
    const { deps, store } = makeDeps({ bars: [bar('2026-01-04', 99), bar('2026-01-06', 101)] });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'error');
    assert.equal(store.entryInputs.length, 0);
  });

  it('emits the pick ticket auto:false + idSeed:tradeId and marks it filled', async () => {
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 101)];
    const { deps, store } = makeDeps({ bars });
    await backfillSignalTrade(PICK, deps);
    assert.equal(store.ticketsEmitted.length, 1);
    const t = store.ticketsEmitted[0] as {
      auto: boolean; idSeed: string; origin: { type: string; signalId: string };
    };
    assert.equal(t.auto, false);
    assert.equal(t.idSeed, tradeIdFor());
    assert.equal(t.origin.type, 'signal');
    assert.equal(t.origin.signalId, stSignalOccurrenceId(SYM, BAR_DATE, SIG_TYPE));
    assert.deepEqual(store.ticketsFilled, [`pap_${tradeIdFor()}`]);
  });

  it('still mints when the ticket emit fails (fail-soft)', async () => {
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 101)];
    const { deps, store } = makeDeps({ bars, ticketsFail: true });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');
    assert.equal(store.trades.get(tradeIdFor())?.status, PaperTradeStatus.OPEN);
  });

  it('short-side mirror: a SHORT signal mints a SHORT trade', async () => {
    const pick: SignalPick = {
      symbol: SYM,
      signalBarDate: BAR_DATE,
      signalType: 'D_ST_TREND_RIDER_V2_SHORT',
    };
    const bars = [bar(BAR_DATE, 100), bar('2026-01-06', 99)];
    const { deps, store } = makeDeps({
      signal: makeSignal({ signalType: pick.signalType, direction: TradeSide.SHORT }),
      bars,
    });
    const res = await backfillSignalTrade(pick, deps);
    assert.equal(res.status, 'created');
    const minted = store.trades.get(res.tradeId!)!;
    assert.equal(minted.order.side, TradeSide.SHORT);
    assert.equal(minted.legs[0].side, TradeSide.SHORT);
  });

  it('consistency pin: minted outcome equals replaySignalToRow for the closing variant', async () => {
    const bars = [
      ...Array.from({ length: 30 }, (_, i) => bar(`2025-12-${String(i + 1).padStart(2, '0')}`, 100)),
      bar(BAR_DATE, 100),
      bar('2026-01-06', 90),
      bar('2026-01-07', 91),
    ];
    const { deps, store } = makeDeps({ bars });
    const res = await backfillSignalTrade(PICK, deps);
    assert.equal(res.status, 'created');
    const minted = store.trades.get(res.tradeId!)!;

    const i0 = bars.findIndex((b) => b.d === BAR_DATE);
    const row = replaySignalToRow(
      { action: StSignalDirection.LONG, signalType: SIG_TYPE, reason: '', index: i0, indicators: {} },
      SYM,
      bars.slice(0, i0 + 2), // replay slices at barRange.to
      null,
      {
        origin: 'replay',
        symbolScope: [SYM],
        signalTypes: [SIG_TYPE],
        exitRule: 'trailing-8',
        barRange: { from: '2025-12-01', to: '2026-01-07' },
        entryConvention: 'signal-bar-close',
      },
      'ds-1',
    );
    const exitFill = minted.fills.find((f) => f.role === 'exit')!;
    assert.equal(exitFill.date, row.exitDate);
    assert.equal(exitFill.price, row.exitPrice);
    // Same return, same exit reason (the mirror names the closer).
    assert.equal(minted.governingVariant, row.exitReason);
    const expectedRet = ((90 - 100) / 100) * 100;
    assert.ok(Math.abs(minted.realizedPnl - expectedRet) < 1e-9); // qty=1 share, multiplier=1
    assert.ok(Math.abs((row.tradeRetPct ?? 0) - expectedRet) < 1e-9);
  });
});

// ── generatePaperSignalTrades callable ───────────────────────────────────────

function callableDeps(overrides: Partial<GeneratePaperSignalTradesDeps> = {}) {
  const mints: SignalPick[] = [];
  const barLoads: string[] = [];
  const deps: GeneratePaperSignalTradesDeps = {
    mint: async (item, shared) => {
      mints.push(item);
      // Mirror the real mint — bars come through the call-scoped cache.
      await shared.getBars(item.symbol);
      return { signalId: signalDedupeKey(item.symbol, item.signalType, item.signalBarDate), tradeId: `t-${item.symbol}`, status: 'created' };
    },
    getBars: async (symbol) => {
      barLoads.push(symbol);
      return [];
    },
    ...overrides,
  };
  return { deps, mints, barLoads };
}

const REQ = (items: unknown, auth = { uid: 'u-1' }) => ({ data: { items }, auth });

describe('generatePaperSignalTrades callable', () => {
  it('requires auth', async () => {
    const { deps } = callableDeps();
    await assert.rejects(
      handleGeneratePaperSignalTrades({ data: { items: [PICK] } }, deps),
      (e: { code?: string }) => e.code === 'unauthenticated',
    );
  });

  it('rejects a non-array items payload', async () => {
    const { deps } = callableDeps();
    await assert.rejects(handleGeneratePaperSignalTrades(REQ('x'), deps), (e: { code?: string }) => e.code === 'invalid-argument');
  });

  it('rejects a batch over 50 items', async () => {
    const { deps } = callableDeps();
    const items = Array.from({ length: 51 }, () => PICK);
    await assert.rejects(handleGeneratePaperSignalTrades(REQ(items), deps), (e: { code?: string }) => e.code === 'invalid-argument');
  });

  it('rejects malformed item shapes', async () => {
    const { deps } = callableDeps();
    await assert.rejects(
      handleGeneratePaperSignalTrades(REQ([{ symbol: '', signalBarDate: '2026-01-05', signalType: 'X' }]), deps),
      (e: { code?: string }) => e.code === 'invalid-argument',
    );
    await assert.rejects(
      handleGeneratePaperSignalTrades(REQ([{ symbol: 'A', signalBarDate: 'bad', signalType: 'X' }]), deps),
      (e: { code?: string }) => e.code === 'invalid-argument',
    );
    // A MISSING signalBarDate must reject with invalid-argument, not a
    // TypeError escaping as internal.
    await assert.rejects(
      handleGeneratePaperSignalTrades(REQ([{ symbol: 'A', signalType: 'X' }]), deps),
      (e: { code?: string }) => e.code === 'invalid-argument',
    );
  });

  it('normalizes symbol casing before minting', async () => {
    const { deps, mints } = callableDeps();
    await handleGeneratePaperSignalTrades(
      REQ([{ symbol: ' qqqm ', signalBarDate: BAR_DATE, signalType: SIG_TYPE }]),
      deps,
    );
    assert.equal(mints[0].symbol, 'QQQM');
  });

  it('collects per-item results without failing the call', async () => {
    const { deps } = callableDeps({
      mint: async (item) =>
        item.symbol === 'BAD'
          ? { signalId: 'x', status: 'error' as const, error: 'no signal doc' }
          : { signalId: 'y', tradeId: 't', status: 'created' as const },
    });
    const res = await handleGeneratePaperSignalTrades(
      REQ([PICK, { ...PICK, symbol: 'BAD' }]),
      deps,
    );
    assert.equal(res.results.length, 2);
    assert.equal(res.results[0].status, 'created');
    assert.equal(res.results[1].status, 'error');
  });

  it('caches bars per symbol across items', async () => {
    const { deps, barLoads } = callableDeps();
    const p2: SignalPick = { symbol: SYM, signalBarDate: '2026-01-06', signalType: SIG_TYPE };
    const p3: SignalPick = { symbol: 'OTHER', signalBarDate: '2026-01-05', signalType: SIG_TYPE };
    await handleGeneratePaperSignalTrades(REQ([PICK, p2, p3]), deps);
    assert.deepEqual(barLoads.sort(), ['OTHER', SYM]);
  });
});
