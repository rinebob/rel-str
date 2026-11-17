/**
 * #1573 — SHARED Task: Signal-replay contracts.
 *
 * Verifies the runtime-verifiable surface of the merged-ledger contracts
 * (Thread #906): the curated variant set + governing-policy marker, the
 * SDS_BARS quote source, the callable batch bounds, and — the contract
 * that makes live capture and historical mint collide-free — that a
 * SignalPick's fields are exactly what `signalDedupeKey` + `buildTradeId`
 * need to reproduce the live ingest's deterministic ids.
 *
 * Pure contract surface: read-only, no env, no Firestore.
 *
 *   npx tsx scripts/verify/paper-trading-curated-contracts-1573.ts
 */

import {
  CURATED_VARIANT_KEYS,
  CURATED_GOVERNING_POLICY,
  GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS,
  DELETE_PAPER_TRADES_MAX_ITEMS,
  type SignalPick,
} from '../../../shared/paper-trading-contracts';
import {
  buildTradeId,
  signalDedupeKey,
  signalTradeDesc,
} from '../../../shared/paper-trading-ids';
import { stSignalOccurrenceId } from '../../../shared/st-ids';
import { OptionQuoteSource } from '../../../shared/options-common';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('— Curated variant set —');
check(
  'CURATED_VARIANT_KEYS is the pinned 7-key set',
  [...CURATED_VARIANT_KEYS].sort().join(',') ===
    'ma-close-100,ma-close-20,ma-close-50,target-100,target-50,trailing-5,trailing-8',
  JSON.stringify(CURATED_VARIANT_KEYS),
);
check('variant keys unique', new Set(CURATED_VARIANT_KEYS).size === CURATED_VARIANT_KEYS.length);
check('trailing-8 present (policy fallback resolves)', CURATED_VARIANT_KEYS.includes('trailing-8'));
check(
  'every key matches the {family}-{param} grammar shape',
  CURATED_VARIANT_KEYS.every((k) => /^(trailing|ma-close|target)-\d+$/.test(k)),
);

console.log('— Governing policy —');
check('CURATED_GOVERNING_POLICY pinned', CURATED_GOVERNING_POLICY === 'deepest-stop-else-trailing-8');

console.log('— Quote source —');
check('OptionQuoteSource.SDS_BARS present', OptionQuoteSource.SDS_BARS === 'SDS_BARS');
check(
  'existing members unchanged',
  OptionQuoteSource.AV_EOD === 'AV_EOD' &&
    OptionQuoteSource.RH_MCP === 'RH_MCP' &&
    OptionQuoteSource.AV_REALTIME === 'AV_REALTIME',
);

console.log('— Batch bounds —');
check('GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS = 50', GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS === 50);
check('DELETE_PAPER_TRADES_MAX_ITEMS = 50', DELETE_PAPER_TRADES_MAX_ITEMS === 50);

console.log('— Id determinism (live ingest ⇄ backfill mint) —');
// A picked signal occurrence — the shared boundary shape.
const pick: SignalPick = {
  symbol: 'aapl', // lowercase on purpose — ids must normalize
  signalBarDate: '2024-03-11',
  signalType: 'D_ST_TREND_RIDER_V1_LONG',
};
// What the live ingest computes from its inputs (symbol, signalType, barDate).
const liveSignalId = signalDedupeKey('AAPL', pick.signalType, pick.signalBarDate);
const liveTradeId = buildTradeId(
  new Date(`${pick.signalBarDate}T12:00:00Z`),
  'sig',
  'AAPL',
  signalTradeDesc(pick.signalType),
);
// What the backfill mint computes from the pick itself.
const mintSignalId = signalDedupeKey(pick.symbol, pick.signalType, pick.signalBarDate);
const mintTradeId = buildTradeId(
  new Date(`${pick.signalBarDate}T12:00:00Z`),
  'sig',
  pick.symbol,
  signalTradeDesc(pick.signalType),
);
check('signalId identical across live and mint paths', liveSignalId === mintSignalId, `${liveSignalId} != ${mintSignalId}`);
// MintResult.signalId is the DEDUPE key ({SYM}_{type}_{date}) — the value
// written to trade.signalId — NOT stSignalOccurrenceId
// ({SYM}_{date}_{type}). st-ids.ts warns the layouts are not
// interchangeable; pin the trap so a mint implementer can't conflate them.
check(
  'dedupe signalId ≠ stSignalOccurrenceId (swapped-layout trap stays distinct)',
  mintSignalId !== stSignalOccurrenceId('AAPL', pick.signalBarDate, pick.signalType),
);
check('tradeId identical across live and mint paths', liveTradeId === mintTradeId, `${liveTradeId} != ${mintTradeId}`);
check('tradeId is the literal {YYMMDD}-sig-{SYM}-{desc} layout', mintTradeId === '240311-sig-AAPL-EQV1L', mintTradeId);
check(
  'unsupported signal types still throw (desc grammar gate intact)',
  (() => {
    try {
      signalTradeDesc('D_ST_RS_WEEKLY_LONG');
      return false;
    } catch {
      return true;
    }
  })(),
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
