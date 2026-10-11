/**
 * @topic #553 — Paper Trading Infra (task #917)
 *
 * Auto-paper ingest pass gates: config doc presence/enabled and the
 * live-market-date check — the work (selection, quotes, fills) lands in
 * #918. These tests pin the gate contract that keeps historical/replay
 * runs and disabled deployments from touching quotes or trades.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_PAPER_DEFAULT_SIGNAL_TYPES,
  resolveAutoPaperScope,
  runAutoPaperIngestFill,
  runAutoPaperIngestPass,
  signalEntriesFromRunDoc,
  type AutoPaperIngestDeps,
  type AutoPaperIngestFillDeps,
  type AutoPaperScope,
} from '../../../functions/src/paper-trading/passes/auto-paper-ingest-pass';
import type { AutoPaperConfig } from '../../../functions/src/common/st-collections';
import { AUTO_PAPER_USER_ID } from '../../../shared/paper-trading-contracts';

const TODAY = '2026-10-08';

function depsWith(config: AutoPaperConfig | null, todayPT = TODAY): AutoPaperIngestDeps {
  return {
    loadConfig: async () => config,
    todayPT: () => todayPT,
  };
}

const ENABLED: AutoPaperConfig = { enabled: true, lists: ['PRIMARY'] };

describe('runAutoPaperIngestPass gates', () => {
  it('skips cleanly when the config doc is missing', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith(null),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing-config');
    assert.equal(result.scope, undefined);
  });

  it('skips cleanly when disabled', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith({ enabled: false, lists: ['PRIMARY'] }),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'disabled');
  });

  it('skips historical/replay runs (marketDate ≠ today PT)', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: '2020-01-02' },
      depsWith(ENABLED),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'historical-run');
  });

  it('skips when the payload has no marketDate', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1' },
      depsWith(ENABLED),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'historical-run');
  });

  it('skips an enabled config with an empty lists scope', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith({ enabled: true, lists: [] }),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'empty-scope');
  });

  it('skips a malformed config whose lists field is not an array', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith({ enabled: true } as AutoPaperConfig),
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'empty-scope');
  });

  it('passes the gates on a live-date enabled config', async () => {
    const result = await runAutoPaperIngestPass(
      { runId: 'r1', marketDate: TODAY },
      depsWith(ENABLED),
    );
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.scope?.lists, ['PRIMARY']);
    assert.equal(result.scope?.global, false);
  });
});

describe('resolveAutoPaperScope', () => {
  it("treats lists: ['*'] as global capture", () => {
    const scope = resolveAutoPaperScope({ enabled: true, lists: ['*'] });
    assert.equal(scope.global, true);
    assert.deepEqual(scope.lists, []);
  });

  it("drops '*' from the list set when mixed with named lists", () => {
    const scope = resolveAutoPaperScope({ enabled: true, lists: ['PRIMARY', '*'] });
    assert.equal(scope.global, true);
    assert.deepEqual(scope.lists, ['PRIMARY']);
  });

  it('defaults signalTypes to the four trend-rider daily types', () => {
    const scope = resolveAutoPaperScope(ENABLED);
    assert.deepEqual(scope.signalTypes, [...AUTO_PAPER_DEFAULT_SIGNAL_TYPES]);
    assert.deepEqual(AUTO_PAPER_DEFAULT_SIGNAL_TYPES, [
      'D_ST_TREND_RIDER_V1_LONG',
      'D_ST_TREND_RIDER_V1_SHORT',
      'D_ST_TREND_RIDER_V2_LONG',
      'D_ST_TREND_RIDER_V2_SHORT',
    ]);
  });

  it('honors a config signalTypes override', () => {
    const scope = resolveAutoPaperScope({
      enabled: true,
      lists: ['PRIMARY'],
      signalTypes: ['D_ST_TREND_RIDER_V1_LONG'],
    });
    assert.deepEqual(scope.signalTypes, ['D_ST_TREND_RIDER_V1_LONG']);
  });

  it('carries ownerUid through to the scope', () => {
    const scope = resolveAutoPaperScope({ enabled: true, lists: ['PRIMARY'], ownerUid: 'u1' });
    assert.equal(scope.ownerUid, 'u1');
  });
});

// ── runAutoPaperIngestFill — selection → quote → fill (#918) ─────────────

const V1L = 'D_ST_TREND_RIDER_V1_LONG';
const V2S = 'D_ST_TREND_RIDER_V2_SHORT';
const BARDATE = '2026-10-08';
const NOW = new Date('2026-10-09T20:00:00Z');

const SCOPE: AutoPaperScope = { global: false, lists: ['PRIMARY'], signalTypes: [V1L, V2S] };
const GLOBAL: AutoPaperScope = { global: true, lists: [], signalTypes: [V1L, V2S] };

function entry(over: Record<string, unknown> = {}) {
  return {
    direction: 'LONG',
    status: 'CONFIRMED',
    timeframe: 'D',
    barDate: BARDATE,
    marketDate: TODAY,
    indicators: { zone: 2 },
    ...over,
  };
}

/** Quoted-wire shape extractEquityPrice reads. */
function quotesFor(prices: Record<string, number>) {
  return {
    results: Object.entries(prices).map(([symbol, p]) => ({
      quote: { symbol, last_trade_price: p },
    })),
  };
}

function fillDeps(over: Partial<AutoPaperIngestFillDeps> = {}) {
  const fills: any[] = [];
  const rawQuotes: any[] = [];
  const deps: AutoPaperIngestFillDeps = {
    listCandidates: async () => [],
    listMembers: async () => [],
    getSignals: async () => ({}),
    getSymbolMeta: async () => ({}),
    getEquityQuotes: async () => quotesFor({}),
    getTrade: async () => null,
    applyEntryFill: async (input) => {
      fills.push(input);
      return {} as any;
    },
    writeRawQuote: async (doc) => {
      rawQuotes.push(doc);
    },
    now: () => NOW,
    ...over,
  };
  return { deps, fills, rawQuotes };
}

describe('runAutoPaperIngestFill', () => {
  it('creates one OPEN 1-share trade per qualifying signal', async () => {
    const { deps, fills, rawQuotes } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getSymbolMeta: async () => ({ sector: 'TECHNOLOGY', industry: 'SOFTWARE', marketCapTier: 'mega' }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250.5 }),
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);

    assert.equal(summary.created, 1);
    assert.equal(fills.length, 1);
    const f = fills[0];
    assert.equal(f.userId, AUTO_PAPER_USER_ID);
    assert.equal(f.order.quantity, 1);
    assert.equal(f.order.type, 'MARKET');
    assert.equal(f.order.side, 'long');
    assert.equal(f.legs.length, 1);
    assert.equal(f.legs[0].kind, 'share');
    assert.equal(f.fill.price, 250.5);
    assert.equal(f.fill.role, 'entry');
    assert.equal(f.fill.rawQuoteRef.startsWith('rq-'), true);
    assert.equal(f.underlyingClose, 250.5); // seeds marks[fill.date]
    assert.equal(f.dims.source, 'signal');
    assert.equal(f.dims.governingVariant, 'trailing-8');
    assert.equal(f.dims.expression, 'EQ');
    assert.equal(f.dims.signalId, `AAPL_${V1L}_${BARDATE}`);
    // stamp fields
    assert.equal(f.tradeOverrides.signalType, V1L);
    assert.equal(f.tradeOverrides.signalTimeframe, 'D');
    assert.equal(f.tradeOverrides.signalBarDate, BARDATE);
    assert.equal(f.tradeOverrides.signalStatus, 'CONFIRMED');
    assert.equal(f.tradeOverrides.signalRunId, 'r1');
    assert.equal(f.tradeOverrides.sector, 'TECHNOLOGY');
    assert.equal(f.tradeOverrides.marketCapTier, 'mega');
    assert.equal(f.tradeOverrides.captureList, 'PRIMARY');
    // raw quote audit written per created trade — verbatim quote item,
    // id matches the fill's rawQuoteRef
    assert.equal(rawQuotes.length, 1);
    assert.equal(rawQuotes[0].id.startsWith('rq-'), true);
    assert.equal(rawQuotes[0].id, f.fill.rawQuoteRef);
    const rr = rawQuotes[0].rawResponse as any;
    assert.equal(rr.tool, 'mcp__robinhood-trading__get_equity_quotes');
    assert.deepEqual(rr.quote, { quote: { symbol: 'AAPL', last_trade_price: 250.5 } });
  });

  it('same symbol V1 + V2 same day → two trades', async () => {
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry(), [V2S]: entry({ direction: 'SHORT' }) }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.created, 2);
    assert.equal(fills[0].tradeId !== fills[1].tradeId, true);
    assert.equal(fills[0].order.side, 'long');
    assert.equal(fills[1].order.side, 'short');
  });

  it('list membership filters candidates; global admits all', async () => {
    const { deps: d1, fills: f1 } = fillDeps({
      listCandidates: async () => ['AAPL', 'MSFT'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 1, MSFT: 1 }),
    });
    const s1 = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, d1);
    assert.equal(s1.created, 1);
    assert.equal(f1[0].dims.symbol, 'AAPL');

    const { deps: d2 } = fillDeps({
      listCandidates: async () => ['AAPL', 'MSFT'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 1, MSFT: 1 }),
    });
    const s2 = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, GLOBAL, d2);
    assert.equal(s2.created, 2);
  });

  it('dedupes on existing tradeId — rerun creates nothing and burns no quote call', async () => {
    let quoteCalls = 0;
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => {
        quoteCalls++;
        return quotesFor({ AAPL: 250 });
      },
      getTrade: async () => ({ id: 'exists' } as any),
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.created, 0);
    assert.equal(summary.deduped, 1);
    assert.equal(fills.length, 0);
    assert.equal(quoteCalls, 0); // dedupe runs before the batch quote
  });

  it('a getSignals failure errors that symbol, others proceed', async () => {
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL', 'BADDOC'],
      listMembers: async () => ['AAPL', 'BADDOC'],
      getSignals: async (sym) => {
        if (sym === 'BADDOC') throw new Error('corrupt doc');
        return { [V1L]: entry() };
      },
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.created, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].symbol, 'BADDOC');
    assert.equal(fills[0].dims.symbol, 'AAPL');
  });

  it('symbol meta fetched once per symbol across multiple signal types', async () => {
    let metaCalls = 0;
    const { deps } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry(), [V2S]: entry({ direction: 'SHORT' }) }),
      getSymbolMeta: async () => {
        metaCalls++;
        return { sector: 'TECHNOLOGY' };
      },
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.created, 2);
    assert.equal(metaCalls, 1);
  });

  it('tradeId is keyed on barDate — a next-day re-dispatch dedupes', async () => {
    const lookedUp: string[] = [];
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
      getTrade: async (id) => {
        lookedUp.push(id);
        return null;
      },
      now: () => new Date('2026-10-09T20:00:00Z'), // dispatch day ≠ bar day
    });
    await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(lookedUp[0], `261008-sig-AAPL-EQV1L`); // 261008 = barDate
    assert.equal(fills[0].tradeId, lookedUp[0]);
  });

  it('passes scope.ownerUid to listMembers (pin the user-scoped list doc)', async () => {
    const ownerUids: (string | undefined)[] = [];
    const { deps } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async (_key, uid) => {
        ownerUids.push(uid);
        return ['AAPL'];
      },
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
    });
    await runAutoPaperIngestFill(
      { runId: 'r1', marketDate: TODAY },
      { ...SCOPE, ownerUid: 'u1' },
      deps,
    );
    assert.deepEqual(ownerUids, ['u1']);
  });

  it('a writeRawQuote failure blocks that signal (errors, no fill) — retry self-heals', async () => {
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
      writeRawQuote: async () => {
        throw new Error('firestore unavailable');
      },
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.created, 0);
    assert.equal(summary.errors.length, 1);
    assert.equal(fills.length, 0); // no dangling rawQuoteRef on a committed trade
  });

  it('invalid barDate is filtered, not crashed on', async () => {
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry({ barDate: 'bogus' }) }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.filtered, 1);
    assert.equal(fills.length, 0);
  });

  it('a concurrent-create throw counts as deduped, not a failure', async () => {
    const { deps } = fillDeps({
      listCandidates: async () => ['AAPL'],
      listMembers: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
      applyEntryFill: async () => {
        throw new Error('paper trade x already exists');
      },
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.deduped, 1);
    assert.equal(summary.created, 0);
  });

  it('quote failure skips the symbol, others proceed', async () => {
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL', 'NOPE'],
      listMembers: async () => ['AAPL', 'NOPE'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }), // NOPE missing
    });
    const summary = await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, SCOPE, deps);
    assert.equal(summary.created, 1);
    assert.equal(summary.quoteFailed, 1);
    assert.equal(fills[0].dims.symbol, 'AAPL');
  });

  it('global capture stamps captureList=*', async () => {
    const { deps, fills } = fillDeps({
      listCandidates: async () => ['AAPL'],
      getSignals: async () => ({ [V1L]: entry() }),
      getEquityQuotes: async () => quotesFor({ AAPL: 250 }),
    });
    await runAutoPaperIngestFill({ runId: 'r1', marketDate: TODAY }, GLOBAL, deps);
    assert.equal(fills[0].tradeOverrides.captureList, '*');
  });
});

describe('signalEntriesFromRunDoc', () => {
  it('reads flattened signals.* keys (prod shape)', () => {
    const doc = { [`signals.${V1L}`]: entry(), other: 1 };
    const out = signalEntriesFromRunDoc(doc);
    assert.deepEqual(Object.keys(out), [V1L]);
    assert.equal(out[V1L].direction, 'LONG');
  });

  it('reads a nested signals map (backfill shape)', () => {
    const doc = { signals: { [V2S]: entry({ direction: 'SHORT' }) } };
    const out = signalEntriesFromRunDoc(doc);
    assert.deepEqual(Object.keys(out), [V2S]);
  });

  it('merges both shapes and ignores non-entry values', () => {
    const doc = {
      [`signals.${V1L}`]: entry(),
      signals: { [V2S]: entry({ direction: 'SHORT' }) },
      'signals.notAnEntry': null,
    };
    const out = signalEntriesFromRunDoc(doc);
    assert.deepEqual(Object.keys(out).sort(), [V1L, V2S].sort());
  });
});
