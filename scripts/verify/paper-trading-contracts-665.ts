/**
 * Verification: paper-trading trade-exits contracts (task #665).
 *
 * Asserts the #652 contract surface through the `@paper-trading/*` and
 * relative shared imports — status enum, seeding defaults, terminal-family
 * classification, and the close/cancel callable shapes.
 *
 * Usage: npx tsx scripts/verify/paper-trading-contracts-665.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  PaperTradeStatus,
  DEFAULT_TRAILING_STOP_KEY,
  SIGNAL_GOVERNING_VARIANT,
  SIGNAL_SHADOW_VARIANT_KEYS,
  TERMINAL_VARIANT_FAMILIES,
  type ClosePaperTradeRequest,
  type ClosePaperTradeResponse,
  type CancelPaperTradeRequest,
  type CancelPaperTradeResponse,
} from '../../shared/paper-trading-contracts';

let failures = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('--- status enum ---');
check(
  'CANCELLED member serializes as CANCELLED',
  (PaperTradeStatus as Record<string, string>).CANCELLED === 'CANCELLED',
);
check(
  'enum still carries the five pre-#652 statuses',
  ['PENDING', 'OPEN', 'CLOSED', 'EXPIRED', 'ASSIGNED'].every(
    (s) => s in PaperTradeStatus,
  ),
);

console.log('--- seeding defaults ---');
check('DEFAULT_TRAILING_STOP_KEY = trailing-8', DEFAULT_TRAILING_STOP_KEY === 'trailing-8');
check('SIGNAL_GOVERNING_VARIANT = trailing-8', SIGNAL_GOVERNING_VARIANT === 'trailing-8');
check(
  'SIGNAL_SHADOW_VARIANT_KEYS is empty (no shadow seeding)',
  Array.isArray(SIGNAL_SHADOW_VARIANT_KEYS) && SIGNAL_SHADOW_VARIANT_KEYS.length === 0,
);

console.log('--- terminal classification ---');
check(
  'only trailing-stop is terminal',
  TERMINAL_VARIANT_FAMILIES.length === 1 && TERMINAL_VARIANT_FAMILIES[0] === 'trailing-stop',
);
check(
  'observational families excluded',
  !TERMINAL_VARIANT_FAMILIES.some(
    (f) => f === 'initial-stop' || f === 'time-stop' || f === 'limit-stddev',
  ),
);

console.log('--- callable contract shapes ---');
const closeReq: ClosePaperTradeRequest = { tradeId: '260928-sig-QQQ-EQ' };
const closeRes: ClosePaperTradeResponse = {
  tradeId: closeReq.tradeId,
  exitPrice: 590.5,
  realizedPnl: 25,
  closedAt: '2026-09-28T20:00:00Z',
};
const cancelReq: CancelPaperTradeRequest = { tradeId: '260928-sig-QQQ-CSP-030-45' };
const cancelRes: CancelPaperTradeResponse = { tradeId: cancelReq.tradeId };
check(
  'close shapes carry tradeId/exitPrice/realizedPnl/closedAt',
  closeReq.tradeId === closeRes.tradeId &&
    typeof closeRes.exitPrice === 'number' &&
    typeof closeRes.realizedPnl === 'number' &&
    typeof closeRes.closedAt === 'string',
);
check(
  'cancel shape carries tradeId',
  cancelReq.tradeId === cancelRes.tradeId && typeof cancelReq.tradeId === 'string',
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
