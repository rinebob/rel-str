/**
 * Verify — #1502 expression-fill-pass re-target to shared selection.
 *
 * DRY stage (default, no credentials): drives `runExpressionFillPass` with
 * a fake `callTool` through the REAL shared coordinate selector —
 * nearest-DTE expiration (no band), signed-delta argmin, mark-gated skip,
 * no-chain skip — plus the staged-ticket `no_contract` error path.
 *
 * LIVE stage (`--live`): fetches a REAL SPY chain through the prod KMS
 * session manager (ADC + `RH_CREDENTIAL_KEY_NAME` — auto-loaded from
 * `functions/.env` when run from `functions/`), runs the REAL pass
 * against it with all ledger/ticket deps stubbed (nothing writes), and
 * asserts the minted contract is identical to `selectContractAtCoordinate`
 * applied to the same live fetch set — the pass-vs-selector parity proof
 * on real data.
 */

import { OptionType, selectContractAtCoordinate } from '@options/common';
import { TradeSide } from '@common';
import type { SignalExpressionTemplate } from '@paper-trading/contracts';
import type { HistoricalOptionContract } from '../../src/types/partner';
import type {
  ExpressionFillPassDeps,
} from '../../src/paper-trading/passes/expression-fill-pass';
import { runExpressionFillPass } from '../../src/paper-trading/passes/expression-fill-pass';
import {
  fetchAllOptionInstruments,
  fetchOptionExpirations,
  fetchOptionQuotes,
  parseNum,
} from '../../src/paper-trading/engine/rh-mcp-shapes';
import { calendarDaysBetween } from '../../src/common/pt-date-utils';
import { buildOccContractId } from '@options/common';
import type { StOrderTicket } from '@st/order-tickets';
import type { PaperTrade } from '@paper-trading/contracts';
import type { EntryFillInput, PendingFillInput } from '../../src/paper-trading/ledger';

const LIVE = process.argv.includes('--live');
let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const MARKET = '2026-09-25';
const NOW = new Date('2026-09-25T19:00:00Z');
const TICKET_ID = 'pap_verify-1502';

const CSP: SignalExpressionTemplate = {
  key: 'csp-030-45',
  expression: 'CSP',
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  targetDelta: 0.3,
  targetDte: 45,
  minDte: 30,
  maxDte: 60,
};

function makeTicket(template: SignalExpressionTemplate = CSP): StOrderTicket {
  return {
    id: TICKET_ID,
    origin: { type: 'signal', signalId: 'sig-verify', positionGroupId: 'grp-verify' },
    auto: false,
    mode: 'paper',
    terms: {
      symbol: 'QQQM',
      side: 'sell',
      instrument: 'option',
      quantity: 1,
      expression: template.expression,
      expressionTemplate: template,
    },
    state: 'staged',
    refId: 'ref-verify',
    accountTarget: 'acct-verify',
    userId: 'verify-user',
    cohortId: 'cohort-verify',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

interface Captured {
  calls: { name: string; args: Record<string, unknown> }[];
  entryFills: EntryFillInput[];
  pendingFills: PendingFillInput[];
  ticketErrors: { ticketId: string; category: string; message: string }[];
  ticketFills: { ticketId: string; price: number }[];
}

function makeDeps(opts: {
  callTool: ExpressionFillPassDeps['callTool'];
  tickets?: StOrderTicket[];
  pendings?: PaperTrade[];
}): { deps: ExpressionFillPassDeps; captured: Captured } {
  const captured: Captured = {
    calls: [],
    entryFills: [],
    pendingFills: [],
    ticketErrors: [],
    ticketFills: [],
  };
  const deps: ExpressionFillPassDeps = {
    listStagedExpressionTickets: async () => opts.tickets ?? [],
    listPendingTrades: async () => opts.pendings ?? [],
    getTrade: async () => null,
    listTradesByTicketId: async () => [],
    listTradeDocIdsByPrefix: async () => [],
    callTool: async (name, args) => {
      captured.calls.push({ name, args });
      return opts.callTool(name, args);
    },
    applyPendingFill: async (input) => {
      captured.pendingFills.push(input);
      return {};
    },
    applyEntryFill: async (input) => {
      captured.entryFills.push(input);
      return {};
    },
    getTicket: async (ticketId) =>
      (opts.tickets ?? []).find((t) => t.id === ticketId) ?? null,
    recordTicketError: async (ticketId, error) => {
      captured.ticketErrors.push({ ticketId, category: error.category, message: error.message });
    },
    markTicketFilled: async (ticketId, fill) => {
      captured.ticketFills.push({ ticketId, price: fill.averagePrice });
    },
    markTicketCancelled: async () => {},
    groups: { addMembers: async () => true },
    now: () => NOW,
  };
  return { deps, captured };
}

// Fixture: nearest-to-45 expirations 42d (in-band), 15d + 86d (out-of-band).
// Instruments exist for ALL three — the coordinate must still pick the
// nearest expiration, 42d.
const CHAIN = {
  data: {
    chains: [
      {
        id: 'c1',
        symbol: 'QQQM',
        expiration_dates: ['2026-10-10', '2026-11-06', '2026-12-20'],
      },
    ],
  },
};

const instrumentsByExpiration: Record<string, object[]> = {
  '2026-10-10': [
    { id: 'i-570-15d', chain_symbol: 'QQQM', expiration_date: '2026-10-10', strike_price: '570', type: 'put' },
  ],
  '2026-11-06': [
    { id: 'i-570p', chain_symbol: 'QQQM', expiration_date: '2026-11-06', strike_price: '570', type: 'put' },
    { id: 'i-580p', chain_symbol: 'QQQM', expiration_date: '2026-11-06', strike_price: '580', type: 'put' },
    { id: 'i-560p', chain_symbol: 'QQQM', expiration_date: '2026-11-06', strike_price: '560', type: 'put' },
  ],
  '2026-12-20': [
    { id: 'i-600-86d', chain_symbol: 'QQQM', expiration_date: '2026-12-20', strike_price: '600', type: 'put' },
  ],
};

const quotesById: Record<string, { mark?: number; delta?: number }> = {
  'i-570-15d': { mark: 9.9, delta: -0.29 },
  'i-570p': { mark: 4.1, delta: -0.45 },
  'i-580p': { mark: 2.8, delta: -0.31 },
  'i-560p': { mark: 1.5, delta: -0.18 },
  'i-600-86d': { mark: 0.9, delta: -0.295 },
};

function fakeCallTool(overrides: {
  quotes?: Record<string, { mark?: number; delta?: number }>;
  instruments?: Record<string, object[]>;
  chain?: object;
} = {}): ExpressionFillPassDeps['callTool'] {
  const chain = overrides.chain ?? CHAIN;
  const instruments = overrides.instruments ?? instrumentsByExpiration;
  const quotes = overrides.quotes ?? quotesById;
  return async (name, args) => {
    if (name.endsWith('get_option_chains')) return chain;
    if (name.endsWith('get_option_instruments')) {
      return { data: { instruments: instruments[String(args.expiration_dates)] ?? [] } };
    }
    if (name.endsWith('get_option_quotes')) {
      const ids = (args.instrument_ids as string[]) ?? [];
      return {
        data: {
          results: ids.map((id) => {
            const q = quotes[id] ?? {};
            return {
              instrument_id: id,
              quote: {
                ...(q.mark !== undefined ? { adjusted_mark_price: String(q.mark) } : {}),
                ...(q.delta !== undefined ? { delta: String(q.delta) } : {}),
              },
              close: q.mark !== undefined ? { price: String(q.mark) } : {},
            };
          }),
        },
      };
    }
    throw new Error(`unexpected tool ${name}`);
  };
}

async function dry(): Promise<void> {
  console.log('DRY — fake chain through the real pass + shared selector');

  // 1. Coordinate pick: nearest expiration (42d) wins even though
  //    out-of-band expirations also carry instruments; signed argmin picks
  //    −0.31 over −0.45/−0.18 for |target|=0.3.
  {
    const { deps, captured } = makeDeps({
      tickets: [makeTicket()],
      callTool: fakeCallTool(),
    });
    const s = await runExpressionFillPass(MARKET, deps);
    ok('fill mints', s.filled === 1 && captured.entryFills.length === 1, JSON.stringify(s));
    const leg = captured.entryFills[0]?.legs[0];
    ok(
      'pick = QQQM 2026-11-06 580P (nearest expiry, −0.31Δ)',
      leg?.kind === 'option' && leg.contractID === 'QQQM261106P00580000' && leg.strike === 580,
      JSON.stringify(leg),
    );
    ok('fill price = RH quote mark 2.80', captured.entryFills[0]?.fill.price === 2.8);
    ok(
      'instruments fetched for all nearest-N expirations — no band',
      captured.calls.filter((c) => c.name.endsWith('get_option_instruments')).length === 3,
    );
    ok('ticket marked filled at the same mark', captured.ticketFills[0]?.price === 2.8);
  }

  // 2. Out-of-band fill: expirations only outside the old 30–60d window —
  //    the coordinate still picks the nearer one.
  {
    const { deps, captured } = makeDeps({
      tickets: [makeTicket()],
      callTool: fakeCallTool({
        chain: {
          data: { chains: [{ id: 'c', symbol: 'QQQM', expiration_dates: ['2026-10-01', '2027-06-01'] }] },
        },
        instruments: {
          '2026-10-01': [
            { id: 'i-oob', chain_symbol: 'QQQM', expiration_date: '2026-10-01', strike_price: '575', type: 'put' },
          ],
        },
        quotes: { 'i-oob': { mark: 3.25, delta: -0.29 } },
      }),
    });
    const s = await runExpressionFillPass(MARKET, deps);
    ok('out-of-band chain still fills', s.filled === 1, JSON.stringify(s));
    const leg = captured.entryFills[0]?.legs[0];
    ok(
      'pick = nearest expiration 2026-10-01',
      leg?.kind === 'option' && leg.expiration === '2026-10-01' && leg.strike === 575,
      JSON.stringify(leg),
    );
  }

  // 3. Signed argmin: a positive-delta put row closer in absolute terms
  //    must lose — the template's magnitude is signed by type upstream.
  {
    const { deps, captured } = makeDeps({
      tickets: [makeTicket()],
      callTool: fakeCallTool({
        quotes: { ...quotesById, 'i-560p': { mark: 1.5, delta: 0.29 } },
      }),
    });
    const s = await runExpressionFillPass(MARKET, deps);
    const leg = captured.entryFills[0]?.legs[0];
    ok(
      'positive-delta put row never wins a PUT coordinate',
      s.filled === 1 && leg?.kind === 'option' && leg.contractID === 'QQQM261106P00580000',
      JSON.stringify(leg),
    );
  }

  // 4. Unpriceable pick: selected contract has no mark → skip, no mint,
  //    ticket records no_contract (never a silent second choice).
  {
    const { deps, captured } = makeDeps({
      tickets: [makeTicket()],
      callTool: fakeCallTool({
        quotes: {
          'i-570-15d': { delta: -0.29 },
          'i-570p': { delta: -0.45 },
          'i-580p': { delta: -0.31 },
          'i-560p': { delta: -0.18 },
          'i-600-86d': { delta: -0.295 },
        },
      }),
    });
    const s = await runExpressionFillPass(MARKET, deps);
    ok('unpriceable pick skips — no mint', s.filled === 0 && captured.entryFills.length === 0);
    ok(
      'ticket records no_contract',
      captured.ticketErrors.length === 1 && captured.ticketErrors[0].category === 'no_contract',
      JSON.stringify(captured.ticketErrors),
    );
  }

  // 5. Empty chain → skip, no instrument fetches.
  {
    const { deps, captured } = makeDeps({
      tickets: [makeTicket()],
      callTool: fakeCallTool({
        chain: { data: { chains: [{ id: 'c', symbol: 'QQQM', expiration_dates: [] }] } },
      }),
    });
    const s = await runExpressionFillPass(MARKET, deps);
    ok('empty chain skips', s.skipped === 1 && s.filled === 0);
    ok(
      'no instrument fetches on an empty chain',
      captured.calls.every((c) => !c.name.endsWith('get_option_instruments')),
    );
  }
}

// ==========================
// LIVE — real RH chain, pass pick ≡ raw selector pick
// ==========================

async function live(): Promise<void> {
  console.log('LIVE — real RH chain via the prod KMS session manager');
  // functions/.env carries RH_CREDENTIAL_KEY_NAME — load it when the
  // caller didn't export it (script convention: run from functions/).
  try {
    process.loadEnvFile?.('.env');
  } catch {
    /* absent .env is fine — the guard below reports the real gap */
  }
  if (!process.env.RH_CREDENTIAL_KEY_NAME) {
    console.error('RH_CREDENTIAL_KEY_NAME is not set — source functions/.env or export it');
    failed++;
    return;
  }
  process.env.GOOGLE_CLOUD_PROJECT ??= 'rel-str';

  const { createRobinhoodMcpSessionManagerFromKms } = await import(
    '../../src/options-strategy-engine/mcp/robinhood-mcp-session-manager'
  );
  const { getMarketDatePT } = await import('../../src/common/pt-date-utils');
  const manager = await createRobinhoodMcpSessionManagerFromKms();

  const callTool: ExpressionFillPassDeps['callTool'] = async (name, args) =>
    manager.callTool(name, args);

  const symbol = 'SPY';
  const marketDate = getMarketDatePT();
  console.log(`  marketDate=${marketDate} symbol=${symbol}`);

  try {
    // Rebuild the pass's exact candidate set: nearest-4 expirations →
  // instruments → quotes → HistoricalOptionContract rows.
  const template = { ...CSP, targetDte: 30 };
  const rhType = 'put';
  const nearest = (await fetchOptionExpirations(callTool, symbol))
    .map((expiration) => ({ expiration, dte: calendarDaysBetween(marketDate, expiration) }))
    .filter((e) => e.dte > 0) // mirrors the pass same-day floor
    .sort((a, b) =>
      Math.abs(a.dte - template.targetDte) - Math.abs(b.dte - template.targetDte) || b.dte - a.dte)
    .slice(0, 4); // mirrors the pass MAX_EXPIRATIONS bound
  ok('live chain lists expirations', nearest.length > 0, JSON.stringify(nearest));
  console.log(`  nearest-4: ${nearest.map((e) => `${e.expiration}(${e.dte}d)`).join(', ')}`);

  const pages = await Promise.all(
    nearest.map(({ expiration }) =>
      fetchAllOptionInstruments(callTool, {
        chain_symbol: symbol,
        expiration_dates: expiration,
        type: rhType,
      })),
  );
  const instruments = pages.flat();
  const quotes = await fetchOptionQuotes(
    callTool,
    instruments.map((i) => i.id).filter((id): id is string => !!id),
  );
  ok('live instruments + quotes fetched', instruments.length > 0 && quotes.size > 0,
    `${instruments.length} instruments, ${quotes.size} quotes`);

  const candidates: HistoricalOptionContract[] = [];
  for (const inst of instruments) {
    const strike = parseNum(inst.strike_price);
    const q = inst.id ? quotes.get(inst.id) : undefined;
    if (!inst.expiration_date || strike === undefined || !q) continue;
    candidates.push({
      contractID: buildOccContractId(symbol, inst.expiration_date, OptionType.PUT, strike),
      symbol,
      expiration: inst.expiration_date,
      strike: String(strike),
      type: OptionType.PUT,
      mark: q.mark === undefined ? undefined : String(q.mark),
      delta: q.delta === undefined ? undefined : String(q.delta),
    });
  }

  const direct = selectContractAtCoordinate(marketDate, candidates, {
    type: OptionType.PUT,
    targetDelta: -Math.abs(template.targetDelta),
    dte: template.targetDte,
  });
  ok('selector picks a contract on the live chain', direct !== null,
    `${candidates.length} candidates`);
  if (direct) {
    console.log(`  selector pick: ${direct.contractId} Δ${direct.delta} mark=${direct.mark ?? 'n/a'} dte=${direct.dte}`);
  }

  // The real pass over the same live data — all ledger deps stubbed, so
  // the minted fill is captured, never written.
  const ticket = makeTicket({ ...template });
  ticket.terms.symbol = symbol;
  const { deps, captured } = makeDeps({ tickets: [ticket], callTool });
  const summary = await runExpressionFillPass(marketDate, deps);
  ok('live pass minted a fill', summary.filled === 1 && captured.entryFills.length === 1,
    JSON.stringify(summary));
  const mintedId =
    captured.entryFills[0]?.legs[0]?.kind === 'option'
      ? captured.entryFills[0].legs[0].contractID
      : undefined;
  ok('pass pick ≡ selector pick on live data', mintedId === direct?.contractId,
    `pass=${mintedId} selector=${direct?.contractId}`);
  ok(
    'fill price = the picked quote mark',
    direct?.mark !== undefined && captured.entryFills[0]?.fill.price === direct.mark,
    `price=${captured.entryFills[0]?.fill.price} mark=${direct?.mark}`,
  );
  ok('nothing written — applyEntryFill was captured, not committed', captured.entryFills.length === 1);
  } finally {
    await manager.close();
  }
}

async function main(): Promise<void> {
  await dry();
  if (LIVE) await live();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
