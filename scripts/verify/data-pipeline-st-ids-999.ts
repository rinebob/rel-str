/**
 * Verification: canonical st- ID builders + order-intents migration mappers
 * (task #999).
 *
 * Exercises @st/ids and the mapper helpers through the real tsconfig
 * aliases — id layout, origin-code mapping, NN padding/rollover, equity
 * contract omission, asymmetric/dash-bearing contract rejection, arg-swap
 * barDate validation, legacy source/status mapping, and barStatus →
 * signal-status delegation.
 *
 * Usage: npx tsx scripts/verify/data-pipeline-st-ids-999.ts
 *
 * No credentials, no Firestore — pure builders/mappers only.
 * Pass: every check prints OK and the script exits 0.
 */

import {
  ORIGIN_TYPE_TO_TRADE_CODE,
  stPositionGroupId,
  stSignalOccurrenceId,
  stTicketId,
  stTradeId,
} from '@st/ids';
import { stSignalStatusFromBarStatus } from '@st/signals';
import {
  mapLegacyTicketStatus,
  mapOrderSourceToOriginType,
} from '@st/order-tickets';
import type { StTicketOriginType } from '@st/order-tickets';

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

const DATE = new Date(Date.UTC(2026, 8, 27)); // 260927

// ── ID builders ────────────────────────────────────────────────────────────

check(
  'signal occurrence id',
  stSignalOccurrenceId('adpt', '2026-10-14', 'D_ST_TREND_RIDER_V2_LONG'),
  'ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG',
);
check(
  'signalType-in-barDate-slot throws (dedupeKey arg-order trap)',
  threw(() => stSignalOccurrenceId('ADPT', 'D_ST_TREND_RIDER_V2_LONG', '2026-10-14')),
  true,
);
check(
  'malformed barDate throws',
  threw(() => stSignalOccurrenceId('ADPT', '2026-1-4', 'X')),
  true,
);
check(
  'empty symbol/signalType throws',
  threw(() => stSignalOccurrenceId('', '2026-10-14', 'X')) &&
    threw(() => stSignalOccurrenceId('ADPT', '2026-10-14', '')),
  true,
);
check(
  "'_' or '/' in occurrence-id segments throws",
  threw(() => stSignalOccurrenceId('BRK_B', '2026-10-14', 'X')) &&
    threw(() => stSignalOccurrenceId('BRK/B', '2026-10-14', 'X')) &&
    threw(() => stSignalOccurrenceId('ADPT', '2026-10-14', 'A/B')),
  true,
);

check('live ticket id', stTicketId('live', 'abc123'), 'liv_abc123');
check('paper ticket id', stTicketId('paper', 'ADPT-260927-sig-EQ-01'), 'pap_ADPT-260927-sig-EQ-01');
check('ticketId rejects bad mode', threw(() => stTicketId('sandbox' as never, 'x')), true);
check('ticketId rejects empty id', threw(() => stTicketId('paper', '')), true);

check(
  'equity trade id omits contract',
  stTradeId('ADPT', DATE, 'signal', 'EQ', undefined, undefined, 1),
  'ADPT-260927-sig-EQ-01',
);
check(
  'option trade id carries contract',
  stTradeId('ADPT', DATE, 'signal', 'CSP', '260116', '10.00', 1),
  'ADPT-260927-sig-CSP-260116-10.00-01',
);
check('origin codes', ORIGIN_TYPE_TO_TRADE_CODE, {
  signal: 'sig', program: 'prg', manual: 'man', management: 'mgmt',
});
check(
  'unknown origin throws (toString poison key)',
  threw(() => stTradeId('ADPT', DATE, 'toString' as StTicketOriginType, 'EQ', undefined, undefined, 1)),
  true,
);
check(
  'NN rolls past 99',
  stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, 100),
  'ADPT-260927-man-EQ-100',
);
check(
  'bad seq (0) throws',
  threw(() => stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, 0)),
  true,
);
check(
  'unsafe seq (1e21) throws — would render as 1e+21',
  threw(() => stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, 1e21)),
  true,
);
check(
  "'/' in symbol/expr/id throws; invalid Date throws; non-digit exp throws",
  threw(() => stTradeId('A/B', DATE, 'manual', 'EQ', undefined, undefined, 1)) &&
    threw(() => stTradeId('ADPT', DATE, 'manual', 'C/D', undefined, undefined, 1)) &&
    threw(() => stTradeId('ADPT', new Date(NaN), 'manual', 'EQ', undefined, undefined, 1)) &&
    threw(() => stTradeId('ADPT', DATE, 'manual', 'CSP', '030', '10.00', 1)) &&
    threw(() => stPositionGroupId('A/B', DATE, 1)) &&
    threw(() => stPositionGroupId('ADPT', new Date(NaN), 1)) &&
    threw(() => stTicketId('paper', 'a/b')),
  true,
);
check(
  'expr uppercased like symbol',
  stTradeId('adpt', DATE, 'signal', 'csp-030-45', '260116', '10.00', 1),
  'ADPT-260927-sig-CSP-030-45-260116-10.00-01',
);
for (const [exp, strike] of [['260116', undefined], [undefined, '10.00']] as const) {
  check(
    `asymmetric contract (${exp ?? '∅'}/${strike ?? '∅'}) throws`,
    threw(() => stTradeId('ADPT', DATE, 'signal', 'CSP', exp, strike, 1)),
    true,
  );
}
check(
  'ISO exp (2026-01-16) rejected — phantom segments',
  threw(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '2026-01-16', '10.00', 1)),
  true,
);
check(
  'dash-bearing strike rejected',
  threw(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '260116', '10-00', 1)),
  true,
);
check('position group id', stPositionGroupId('ADPT', DATE, 1), 'ADPT-260927-grp-01');
check('group NN rolls past 99', stPositionGroupId('ADPT', DATE, 100), 'ADPT-260927-grp-100');
check('empty symbol throws', threw(() => stPositionGroupId('', DATE, 1)), true);

// ── Migration mappers ──────────────────────────────────────────────────────

check('source signal_pipeline → signal', mapOrderSourceToOriginType('signal_pipeline'), 'signal');
check('source manual → manual', mapOrderSourceToOriginType('manual'), 'manual');
check('source position_management → management', mapOrderSourceToOriginType('position_management'), 'management');
check('unknown source → null', mapOrderSourceToOriginType('webhook'), null);

check('legacy paper → paper/submitted', mapLegacyTicketStatus('paper'), { mode: 'paper', state: 'submitted' });
check('legacy resting → live/submitted', mapLegacyTicketStatus('resting'), { mode: 'live', state: 'submitted' });
check('legacy filled → live/filled', mapLegacyTicketStatus('filled'), { mode: 'live', state: 'filled' });
check('legacy failed → live/failed', mapLegacyTicketStatus('failed'), { mode: 'live', state: 'failed' });
check('legacy expired → live/expired', mapLegacyTicketStatus('expired'), { mode: 'live', state: 'expired' });
check('unknown status → null', mapLegacyTicketStatus('bogus'), null);

check('barStatus 1 → CONFIRMED', stSignalStatusFromBarStatus(1), 'CONFIRMED');
check('barStatus 0 → INTERIM', stSignalStatusFromBarStatus(0), 'INTERIM');
check('barStatus undefined → INTERIM', stSignalStatusFromBarStatus(undefined), 'INTERIM');

if (failures === 0) {
  console.log('=== ALL CHECKS PASSED ===');
} else {
  console.log(`=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
