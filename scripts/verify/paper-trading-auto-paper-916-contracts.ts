/**
 * Verification: auto-paper signal-trade contracts (task #916, Thread #904).
 *
 * Exercises the new shared surface — deterministic signal desc/dedupe keys,
 * the six slice-dimension stats scopes, and the dedicated auto-paper
 * identity — through the real module imports. No credentials needed.
 *
 * Usage: npx tsx scripts/verify/paper-trading-auto-paper-916-contracts.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  buildAccountId,
  buildTradeId,
  parseTradeId,
  signalTradeDesc,
  signalDedupeKey,
  statsScopeSignalType,
  statsScopeDirection,
  statsScopeSector,
  statsScopeIndustry,
  statsScopeCapTier,
  statsScopeSignalStatus,
} from '../../shared/paper-trading-ids';
import { AUTO_PAPER_USER_ID } from '../../shared/paper-trading-contracts';
import { TradeSide } from '../../shared/common';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

const DAY = new Date('2026-10-08T19:00:00Z');

// ── signalTradeDesc ────────────────────────────────────────────────────────

check('V1 long desc', signalTradeDesc('D_ST_TREND_RIDER_V1_LONG'), 'EQV1L');
check('V1 short desc', signalTradeDesc('D_ST_TREND_RIDER_V1_SHORT'), 'EQV1S');
check('V2 long desc', signalTradeDesc('D_ST_TREND_RIDER_V2_LONG'), 'EQV2L');
check('V2 short desc', signalTradeDesc('D_ST_TREND_RIDER_V2_SHORT'), 'EQV2S');

let threw = false;
try { signalTradeDesc('SOME_OTHER_SIGNAL'); } catch { threw = true; }
check('unknown signal type throws', threw, true);

// ── TradeId determinism = doc-existence dedupe ─────────────────────────────

const t1 = buildTradeId(DAY, 'sig', 'AAPL', signalTradeDesc('D_ST_TREND_RIDER_V1_LONG'));
const t2 = buildTradeId(DAY, 'sig', 'AAPL', signalTradeDesc('D_ST_TREND_RIDER_V2_LONG'));
check('V1 long tradeId', t1, '261008-sig-AAPL-EQV1L');
check('V1 vs V2 same symbol/day are distinct', t1 !== t2, true);
check('tradeId parses back', parseTradeId(t1)?.desc, 'EQV1L');
check('long vs short same type-family distinct', buildTradeId(DAY, 'sig', 'AAPL', signalTradeDesc('D_ST_TREND_RIDER_V1_SHORT')), '261008-sig-AAPL-EQV1S');

// ── Dedupe key ─────────────────────────────────────────────────────────────

check(
  'dedupe key',
  signalDedupeKey('aapl', 'D_ST_TREND_RIDER_V1_LONG', '2026-10-08'),
  'AAPL_D_ST_TREND_RIDER_V1_LONG_2026-10-08',
);
check(
  'next-day re-fire is a new key',
  signalDedupeKey('AAPL', 'D_ST_TREND_RIDER_V1_LONG', '2026-10-09') !==
    signalDedupeKey('AAPL', 'D_ST_TREND_RIDER_V1_LONG', '2026-10-08'),
  true,
);

// ── Stats scopes ───────────────────────────────────────────────────────────

check('sigtype scope', statsScopeSignalType('D_ST_TREND_RIDER_V1_LONG'), 'sigtype-d-st-trend-rider-v1-long');
check('dir scope long', statsScopeDirection(TradeSide.LONG), 'dir-long');
check('dir scope short', statsScopeDirection(TradeSide.SHORT), 'dir-short');
check('sector scope', statsScopeSector('Health Care'), 'sector-health-care');
check('industry scope', statsScopeIndustry('Medical Devices'), 'ind-medical-devices');
check('industry scope punct', statsScopeIndustry('Banks—Diversified'), 'ind-banks-diversified');
check('captier scope', statsScopeCapTier('mega'), 'captier-mega');
check('sigstatus scope', statsScopeSignalStatus('INTERIM'), 'sigstatus-interim');
check('sigstatus confirmed', statsScopeSignalStatus('CONFIRMED'), 'sigstatus-confirmed');
check('scope deterministic', statsScopeSector('Health Care'), statsScopeSector('Health Care'));

// ── Auto-paper identity ────────────────────────────────────────────────────

check('auto-paper uid', AUTO_PAPER_USER_ID, 'auto-paper');
check('auto-paper account id', buildAccountId(AUTO_PAPER_USER_ID), 'acct-auto-paper');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
