/**
 * #1649 — SHARED Task: signal-selection review contracts (Thread #1117).
 *
 * Verifies the runtime-verifiable surface of the review-pane contracts:
 * the `st-config` doc id, the `signalPickFromReviewOccurrence` mapper
 * (the single site guarding the barDate/signalBarDate rename across the
 * seam), and — the hazard the server-side join exists to prevent — that
 * `signalDedupeKey` and `stSignalOccurrenceId` produce DIFFERENT
 * non-interchangeable layouts for the same logical occurrence.
 *
 * Pure contract surface: read-only, no env, no Firestore.
 *
 *   npx tsx scripts/verify/paper-trading-signal-review-contracts-1649.ts
 */

import {
  signalPickFromReviewOccurrence,
  type SignalPick,
  type SignalReviewOccurrence,
  type SignalReviewStateDoc,
  type GetSignalReviewBundleResponse,
} from '../../../shared/paper-trading-contracts';
import { signalDedupeKey } from '../../../shared/paper-trading-ids';
import { stSignalOccurrenceId } from '../../../shared/st-ids';
import { SIGNAL_REVIEW_CONFIG_DOC } from '../../../shared/st-collections';
import { TradeSide } from '../../../shared/common';

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

const OCC: SignalReviewOccurrence = {
  occurrenceId: 'AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG',
  symbol: 'AAPL',
  signalType: 'D_ST_TREND_RIDER_V1_LONG',
  signalBarDate: '2024-03-11',
  signalTimeframe: 'D',
  direction: TradeSide.LONG,
  signalStatus: 'CONFIRMED',
  signalIndicators: { sma20: 172.4 },
  sourceRunId: 'run-1',
  checked: true,
  tradeId: '240311-sig-AAPL-EQV1L',
};

console.log('— st-config doc id —');
check(
  'SIGNAL_REVIEW_CONFIG_DOC is signalReview',
  SIGNAL_REVIEW_CONFIG_DOC === 'signalReview',
  SIGNAL_REVIEW_CONFIG_DOC,
);
check(
  'doc id is a single path segment',
  SIGNAL_REVIEW_CONFIG_DOC.split('/').length === 1,
);

console.log('— signalPickFromReviewOccurrence —');
const pick: SignalPick = signalPickFromReviewOccurrence(OCC);
check(
  'maps {symbol, signalBarDate, signalType} exactly',
  pick.symbol === 'AAPL' &&
    pick.signalBarDate === '2024-03-11' &&
    pick.signalType === 'D_ST_TREND_RIDER_V1_LONG',
  JSON.stringify(pick),
);
check(
  'no join/identity fields leak into the pick',
  Object.keys(pick).sort().join(',') === 'signalBarDate,signalType,symbol',
  JSON.stringify(Object.keys(pick)),
);

console.log('— occurrence id layout (fixture sanity via canonical builder) —');
check(
  'fixture occurrenceId == stSignalOccurrenceId(symbol, barDate, type)',
  OCC.occurrenceId ===
    stSignalOccurrenceId(OCC.symbol, OCC.signalBarDate, OCC.signalType),
  OCC.occurrenceId,
);

console.log('— the layout trap the server-side join prevents —');
const dedupe = signalDedupeKey('AAPL', OCC.signalType, OCC.signalBarDate);
const occurrence = stSignalOccurrenceId('AAPL', OCC.signalBarDate, OCC.signalType);
check(
  'signalDedupeKey = {SYM}_{type}_{barDate}',
  dedupe === 'AAPL_D_ST_TREND_RIDER_V1_LONG_2024-03-11',
  dedupe,
);
check(
  'stSignalOccurrenceId = {SYM}_{barDate}_{type}',
  occurrence === 'AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG',
  occurrence,
);
check(
  'the two ids are NOT interchangeable for the same occurrence',
  dedupe !== occurrence,
  `${dedupe} vs ${occurrence}`,
);
check(
  'a pick still derives the trade-side signalId the join keys on',
  signalDedupeKey(pick.symbol, pick.signalType, pick.signalBarDate) === dedupe,
);

console.log('— response shape sanity (type-level round trip) —');
const state: SignalReviewStateDoc = { lastOpenedAt: { AAPL: '2026-11-20T18:00:00Z' } };
const bundle: GetSignalReviewBundleResponse = {
  symbol: 'AAPL',
  previousOpenedAt: null,
  openedAt: state.lastOpenedAt['AAPL'],
  occurrences: [OCC],
};
check('first-visit previousOpenedAt is null', bundle.previousOpenedAt === null);
const unchecked: SignalReviewOccurrence = { ...OCC, checked: false };
delete unchecked.tradeId;
check(
  'mapper ignores join fields — unchecked occurrence → identical pick',
  JSON.stringify(signalPickFromReviewOccurrence(unchecked)) === JSON.stringify(pick),
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
