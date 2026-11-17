/**
 * Verification: manage contract-list writer (task #1543).
 *
 * Exercises the real modules through the functions tsconfig aliases:
 * `appendManageContractListRows` (doc create/append, v1 pick rows per
 * leg, same-index repeatsPrevious, synthetic pickDocMeta, NaN handling)
 * and the `runManageOpenPass` → `appendContractListRows` seam end-to-end
 * with injected MCP + persistence fakes. Also asserts the doc satisfies
 * the `optionsAnalysisStart` gate contract (status:'success' + runId /
 * symbol / templateId) so the analysis route resolves.
 *
 * Importing the modules runs `firebase-admin-init` (parameterless
 * `initializeApp()` — no credentials needed; no Firestore call is made).
 *
 * Usage: npx tsx scripts/verify/strat-manage-contract-list-1543.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { appendManageContractListRows } from '../../functions/src/paper-trading/engine/passes/contract-list-writer';
import type { ContractListWriterDeps } from '../../functions/src/paper-trading/engine/passes/contract-list-writer';
import { runManageOpenPass } from '../../functions/src/paper-trading/engine/passes/manage-open-pass';
import type { RunnableManageInstance } from '../../functions/src/paper-trading/engine/manage-instance-reader';
import type { Position, PositionLeg } from '../../functions/src/paper-trading/engine/types';
import type {
  ContractListPickRowV1,
  OptionsContractListDocV1,
} from '@options-replay/contracts';
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

const MARKET_DATE = '2026-02-02';
const NEXT_DATE = '2026-02-03';
const EXPIRY = '2026-03-06'; // ~32 DTE — inside a 30-DTE leg's ±15d band

function cdsVariant(): ManageVariant {
  return {
    id: 'cds-30-50-40',
    name: 'call debit spread 50-40 30',
    templateId: 'cds',
    dte: 30,
    legs: [
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.4, dte: 30, side: TradeSide.SHORT },
    ],
  };
}

function makeInstance(): RunnableManageInstance {
  return {
    id: 'QQQ-CDS-30-50-40-ALL',
    variantRef: 'cds-30-50-40',
    variant: cdsVariant(),
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'ACTIVE',
    userId: 'test-user',
    paperAccountId: 'acct-1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  };
}

function legs(idA: string, idB: string) {
  const variant = cdsVariant();
  return [
    {
      leg: variant.legs[0],
      contract: {
        contractID: idA, strike: 450, expiration: EXPIRY, mark: 5.0,
        delta: 0.5, iv: 0.22, bid: 4.9, ask: 5.1, volume: 1200, openInterest: 9000,
      },
    },
    {
      leg: variant.legs[1],
      contract: {
        contractID: idB, strike: 455, expiration: EXPIRY, mark: 3.0,
        delta: 0.4, iv: 0.23, bid: 2.9, ask: 3.1, volume: 800, openInterest: 6000,
      },
    },
  ] as const;
}

function storeDeps(existing?: OptionsContractListDocV1) {
  const written: OptionsContractListDocV1[] = [];
  let current = existing;
  const deps: ContractListWriterDeps = {
    upsertDoc: async (_id, fn) => {
      current = fn(current);
      written.push(current);
    },
    fetchUnderlyingPrice: async () => 512.34,
    now: () => new Date('2026-02-02T20:00:00Z'),
  };
  return { deps, written };
}

async function main() {
  // ── Doc creation on first open ──
  {
    const { deps, written } = storeDeps();
    await appendManageContractListRows(makeInstance(), legs('QQQ260306C00450000', 'QQQ260306C00455000'), MARKET_DATE, deps);
    const doc = written[0];
    check('one write', written.length, 1);
    check('runId = instanceId', doc.runId, 'QQQ-CDS-30-50-40-ALL');
    check('symbol', doc.symbol, 'QQQ');
    check('templateId = variant.templateId', doc.templateId, 'cds');
    check('status success (analysis gate)', doc.status, 'success');
    check('no schemaVersion (v1)', doc.schemaVersion === undefined, true);
    check('two pick rows', doc.rows.length, 2);
    const r0 = doc.rows[0] as ContractListPickRowV1;
    check('row0 kind pick', r0.kind, 'pick');
    check('row0 contractId', r0.contractId, 'QQQ260306C00450000');
    check('row0 entryDate', r0.entryDate, MARKET_DATE);
    check('row0 side from leg', r0.side, TradeSide.LONG);
    check('row0 dte computed', r0.dte, 32);
    check('row0 mark', r0.mark, 5.0);
    check('row0 delta', r0.delta, 0.5);
    check('row0 iv', r0.iv, 0.22);
    check('row0 bid/ask/volume/OI populated',
      [r0.bid, r0.ask, r0.volume, r0.openInterest], [4.9, 5.1, 1200, 9000]);
    check('row0 underlyingClose live price', r0.underlyingClose, 512.34);
    check('row0 first-row repeatsPrevious', r0.repeatsPrevious, false);
    check('meta coordinate = leg0 (call/0.5/30d)',
      [doc.pickDocMeta.coordinate.type, doc.pickDocMeta.coordinate.targetDelta, doc.pickDocMeta.coordinate.expiry.dte],
      [OptionType.CALL, 0.5, 30]);
    check('meta synthetic gridVersion', doc.pickDocMeta.gridVersion, 0);
    check('meta pickCount', doc.pickDocMeta.pickCount, 2);
  }

  // ── Append on second open — same-index repeatsPrevious ──
  {
    const { deps, written } = storeDeps();
    const inst = makeInstance();
    await appendManageContractListRows(inst, legs('QQQ260306C00450000', 'QQQ260306C00455000'), MARKET_DATE, deps);
    await appendManageContractListRows(inst, legs('QQQ260306C00450000', 'QQQ260306C00460000'), NEXT_DATE, deps);
    const doc = written[1];
    check('four rows after second open', doc.rows.length, 4);
    const r2 = doc.rows[2] as ContractListPickRowV1;
    const r3 = doc.rows[3] as ContractListPickRowV1;
    check('leg0 same contract → repeatsPrevious', r2.repeatsPrevious, true);
    check('leg1 new contract → not repeat', r3.repeatsPrevious, false);
    check('meta firstDate kept', doc.pickDocMeta.firstDate, MARKET_DATE);
    check('meta lastDate advanced', doc.pickDocMeta.lastDate, NEXT_DATE);
  }

  // ── Missing numerics → NaN ──
  {
    const { deps, written } = storeDeps();
    const bare = [
      { leg: legs('a', 'b')[0].leg, contract: { contractID: 'QQQ260306C00450000', strike: 450, expiration: EXPIRY, mark: 5.0 } },
      { leg: legs('a', 'b')[1].leg, contract: { contractID: 'QQQ260306C00455000', strike: 455, expiration: EXPIRY, mark: 3.0 } },
    ] as const;
    await appendManageContractListRows(makeInstance(), bare, MARKET_DATE, {
      ...deps,
      fetchUnderlyingPrice: async () => undefined,
    });
    const r0 = written[0].rows[0] as ContractListPickRowV1;
    check('missing delta → NaN', Number.isNaN(r0.delta), true);
    check('missing iv → NaN', Number.isNaN(r0.iv), true);
    check('missing underlyingClose → NaN', Number.isNaN(r0.underlyingClose), true);
    check('mark still real', r0.mark, 5.0);
  }

  // ── Pass seam: open → append invoked; append failure tolerated ──
  {
    const appended: string[][] = [];
    const mcp = async (name: string, _args: Record<string, unknown>) => {
      if (name.endsWith('get_option_chains')) {
        return { chains: [{ symbol: 'QQQ', expiration_dates: [EXPIRY] }] };
      }
      if (name.endsWith('get_option_instruments')) {
        return {
          data: {
            instruments: [
              { id: 'inst-450', expiration_date: EXPIRY, strike_price: '450', type: 'call' },
              { id: 'inst-455', expiration_date: EXPIRY, strike_price: '455', type: 'call' },
            ],
          },
        };
      }
      if (name.endsWith('get_option_quotes')) {
        return {
          results: [
            { instrument_id: 'inst-450', quote: { mark_price: '5.00', delta: '0.50', bid_price: '4.9', ask_price: '5.1', implied_volatility: '0.22' } },
            { instrument_id: 'inst-455', quote: { mark_price: '3.00', delta: '0.40', implied_volatility: '0.23' } },
          ],
        };
      }
      throw new Error(`unexpected call ${name}`);
    };
    const created: Position[] = [];
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcp,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: async (position, _legs, _q, _inst, positionId) => {
        created.push({ ...position, id: positionId ?? 'pos-x' });
        return { ...position, id: positionId ?? 'pos-x' };
      },
      writeResult: async () => {},
      appendContractListRows: async (_inst, lgs, _md) => {
        appended.push(lgs.map((l) => l.contract.contractID));
      },
      now: () => new Date('2026-02-02T20:00:00Z'),
    });
    check('open succeeded', result.skipped, false);
    check('append invoked once', appended.length, 1);
    check('legs carry resolved OCC ids', appended[0], ['QQQ260306C00450000', 'QQQ260306C00455000']);

    // Append failure must not fail the pass.
    const result2 = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcp,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: async (position, _legs, _q, _inst, positionId) =>
        ({ ...position, id: positionId ?? 'pos-x' }) as Position,
      writeResult: async () => {},
      appendContractListRows: async () => {
        throw new Error('firestore write failed');
      },
      now: () => new Date('2026-02-02T20:00:00Z'),
    });
    check('append failure tolerated — open still succeeds', result2.skipped, false);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
