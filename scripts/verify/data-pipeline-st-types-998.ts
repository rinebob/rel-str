/**
 * Verification: canonical st- type shapes (task #998).
 *
 * Exercises every canonical type module through the real `@st/*` tsconfig
 * aliases — a passing run proves alias resolution under tsx plus the pinned
 * shapes, value sets, and terms validation.
 *
 * Usage: npx tsx scripts/verify/data-pipeline-st-types-998.ts
 *
 * No credentials, no Firestore — contracts and pure helpers only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { ST_MODES } from '@st/types';
import {
  ST_SIGNAL_STATUSES,
  ST_SIGNAL_TIMEFRAMES,
  normalizeStSignalDirection,
  StSignal,
} from '@st/signals';
import {
  ST_TICKET_INSTRUMENTS,
  ST_TICKET_ORIGIN_TYPES,
  ST_TICKET_SIDES,
  ST_TICKET_STATES,
  StOrderTicket,
  validateStTicketTerms,
} from '@st/order-tickets';
import {
  ST_GROUP_ORIGIN_TYPES,
  ST_POSITION_GROUP_STATUSES,
  StPositionGroup,
} from '@st/position-groups';
import { StStrategyInstance } from '@st/strategy-instances';
import {
  PAPER_TRADE_WRITABLE_STATUSES,
  PaperTradeStatus,
} from '@paper-trading/contracts';
import { TradeSide } from '@common';
import { LifecycleState } from '@options-strategy-engine/contracts';
import { OptionType, PositionSpreadType, StrategyFrequency } from '@options/common';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

function threw(fn: () => void): boolean {
  try { fn(); return false; } catch { return true; }
}

// ── Shared scalars ─────────────────────────────────────────────────────────

check('StMode value set', ST_MODES, ['live', 'paper']);

// ── StSignal ───────────────────────────────────────────────────────────────

const signal: StSignal = {
  symbol: 'ADPT',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  barDate: '2026-10-14',
  marketDate: '2026-10-14',
  direction: TradeSide.LONG,
  timeframe: 'D',
  indicators: { close: 17.42 },
  status: 'INTERIM',
  sourceRunId: 'run-abc',
  runIds: ['run-abc'],
  ticketIds: [],
  positionGroupIds: [],
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
};
check('StSignal statuses', ST_SIGNAL_STATUSES, ['INTERIM', 'CONFIRMED']);
check('StSignal timeframes', ST_SIGNAL_TIMEFRAMES, ['D', 'W', 'M']);
check(
  'StSignal required keys',
  Object.keys(signal).sort(),
  ['barDate', 'createdAt', 'direction', 'indicators', 'marketDate',
   'positionGroupIds', 'runIds', 'signalType', 'sourceRunId', 'status',
   'symbol', 'ticketIds', 'timeframe', 'updatedAt'].sort(),
);
check('StSignal JSON round-trip', JSON.parse(JSON.stringify(signal)), signal);
check(
  'legacy direction mapping LONG→long',
  normalizeStSignalDirection('LONG'),
  TradeSide.LONG,
);
check(
  'legacy direction mapping SHORT→short',
  normalizeStSignalDirection('SHORT'),
  TradeSide.SHORT,
);
check(
  'unknown direction → null',
  normalizeStSignalDirection('sideways'),
  null,
);

// ── StOrderTicket ──────────────────────────────────────────────────────────

const ticket: StOrderTicket = {
  id: 'pap_ADPT-260927-sig-EQ-01',
  origin: { type: 'signal', signalId: 'ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG', runId: 'run-abc' },
  auto: true,
  mode: 'paper',
  terms: { symbol: 'ADPT', side: 'buy', instrument: 'equity', quantity: 10 },
  state: 'staged',
  refId: 'ref-123',
  accountTarget: 'acct-u1',
  userId: 'u1',
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
};
check('StTicketState value set', ST_TICKET_STATES, [
  'staged', 'submitted', 'cancel_pending', 'filled', 'cancelled', 'expired', 'failed',
]);
check('StTicketOriginType value set', ST_TICKET_ORIGIN_TYPES, [
  'signal', 'program', 'manual', 'management',
]);
check('StTicketSide value set', ST_TICKET_SIDES, ['buy', 'sell']);
check('StTicketInstrument value set', ST_TICKET_INSTRUMENTS, ['equity', 'etf', 'option']);
check(
  'StOrderTicket required keys',
  Object.keys(ticket).sort(),
  ['accountTarget', 'auto', 'createdAt', 'id', 'mode', 'origin',
   'refId', 'state', 'terms', 'updatedAt', 'userId'].sort(),
);
check('StOrderTicket terms carry symbol', ticket.terms.symbol, 'ADPT');
check('StOrderTicket JSON round-trip', JSON.parse(JSON.stringify(ticket)), ticket);

const optionTicket: StOrderTicket = {
  ...ticket,
  id: 'liv_ADPT-260927-sig-CSP-01',
  mode: 'live',
  terms: {
    symbol: 'ADPT',
    side: 'sell',
    instrument: 'option',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'gfd',
    limits: { limitPrice: 0.25 },
    legs: [{
      side: 'sell',
      occSymbol: 'ADPT 260116P00010000',
      optionId: 'opt-uuid-1',
      positionEffect: 'open',
    }],
  },
};
check(
  'option ticket leg carries RH contract identity',
  optionTicket.terms.legs?.[0].optionId,
  'opt-uuid-1',
);

check(
  'terms: quantity only validates',
  threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity: 10 })),
  false,
);
check(
  'terms: dollarAmount only validates',
  threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', dollarAmount: 100 })),
  false,
);
check(
  'terms: both sizing fields throws (mutually exclusive)',
  threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity: 10, dollarAmount: 100 })),
  true,
);
check(
  'terms: no sizing throws',
  threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy' })),
  true,
);
for (const quantity of [0, -5, NaN]) {
  check(
    `terms: bad quantity ${quantity} throws`,
    threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity })),
    true,
  );
}
// #1003: fractional quantity is legal on non-option terms (prod fractional
// shares); integer rule applies to option/expressionTemplate tickets only.
check(
  'terms: fractional quantity without instrument passes (#1003 relax)',
  threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', quantity: 1.5 })),
  false,
);
check(
  'terms: fractional option quantity still throws',
  threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', instrument: 'option', quantity: 1.5 })),
  true,
);
for (const dollarAmount of [0, -100, NaN]) {
  check(
    `terms: bad dollarAmount ${dollarAmount} throws`,
    threw(() => validateStTicketTerms({ symbol: 'ADPT', side: 'buy', dollarAmount })),
    true,
  );
}

// ── StPositionGroup ────────────────────────────────────────────────────────

const group: StPositionGroup = {
  id: 'ADPT-260927-grp-01',
  origin: { type: 'signal', signalId: 'ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG' },
  mode: 'paper',
  userId: 'u1',
  memberTicketIds: ['pap_ADPT-260927-sig-EQ-01'],
  memberTradeIds: ['ADPT-260927-sig-EQ-01'],
  brokerOrderIds: [],
  status: 'open',
  rollups: { openCount: 1, closedCount: 0 },
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
};
check('StPositionGroup statuses', ST_POSITION_GROUP_STATUSES, ['open', 'closed']);
check('StGroupOriginType value set', ST_GROUP_ORIGIN_TYPES, ['signal', 'program', 'manual']);
check(
  'StPositionGroup required keys',
  Object.keys(group).sort(),
  ['brokerOrderIds', 'createdAt', 'id', 'memberTicketIds', 'memberTradeIds',
   'mode', 'origin', 'rollups', 'status', 'updatedAt', 'userId'].sort(),
);
check('StPositionGroup JSON round-trip', JSON.parse(JSON.stringify(group)), group);

// ── StStrategyInstance ─────────────────────────────────────────────────────

const instance: StStrategyInstance = {
  id: 'inst-1',
  symbol: 'ADPT',
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  phases: [{ spreadType: PositionSpreadType.CASH_SECURED_PUT, targetDelta: 0.3, dteMin: 30, dteMax: 60 }],
  frequency: StrategyFrequency.DAILY,
  openTimePT: '13:00',
  exitPolicies: [],
  lifecycleState: LifecycleState.ACTIVE,
  userId: 'u1',
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
  mode: 'paper',
  paperAccountId: 'acct-paper-u1',
  enabled: true,
};
check('StStrategyInstance inherits engine config', [instance.symbol, instance.frequency], ['ADPT', 'DAILY']);
check('StStrategyInstance mode + enabled', [instance.mode, instance.enabled], ['paper', true]);
check('StStrategyInstance paperAccountId', instance.paperAccountId, 'acct-paper-u1');
check('StStrategyInstance JSON round-trip', JSON.parse(JSON.stringify(instance)), instance);

// ── PaperTrade extensions ──────────────────────────────────────────────────

check(
  'writable statuses exclude PENDING',
  PAPER_TRADE_WRITABLE_STATUSES.includes(PaperTradeStatus.PENDING),
  false,
);
check(
  'writable status set',
  [...PAPER_TRADE_WRITABLE_STATUSES].sort(),
  ['ASSIGNED', 'CANCELLED', 'CLOSED', 'EXPIRED', 'OPEN'],
);
check('PENDING stays in PaperTradeStatus', Object.values(PaperTradeStatus).includes('PENDING'), true);

if (failures === 0) {
  console.log('=== ALL CHECKS PASSED ===');
} else {
  console.log(`=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
