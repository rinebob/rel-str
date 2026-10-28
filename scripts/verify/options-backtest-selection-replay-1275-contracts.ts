/**
 * Verification: selection-replay shared contracts (task #1275).
 *
 * Exercises `shared/options-replay-contracts.ts` through the real
 * `@options-replay/contracts` tsconfig alias — a passing run proves alias
 * resolution under tsx as well as the fixture shapes the BE mapper and FE
 * table will consume.
 *
 * Usage: npx tsx scripts/verify/options-backtest-selection-replay-1275-contracts.ts
 *
 * No credentials, no Firestore — pure types + structural checks only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import {
  isPickDocPick,
  OPTIONS_CONTRACT_LIST_STATUSES,
  OPTIONS_REPLAY_RUN_STATUSES,
} from '@options-replay/contracts';
import type {
  ContractListRow,
  OptionsContractListDoc,
  OptionsReplayPermutationPayload,
  OptionsReplayRun,
  OptionsReplayStartRequest,
  PickDocDay,
  PickDocument,
  ReplayTemplate,
} from '@options-replay/contracts';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// ── Template ────────────────────────────────────────────────────────────────

const template: ReplayTemplate = {
  id: 'csp-45-20',
  name: '45DTE 20Δ put (CSP)',
  description: 'Sell one 45DTE 20-delta put daily',
  side: TradeSide.SHORT,
  coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
};
check('template id', template.id, 'csp-45-20');
check('template side stamped SHORT', template.side, 'short');
check('coordinate put delta negative', Math.sign(template.coordinate.targetDelta), -1);
check('coordinate nearestDte dte', template.coordinate.expiry.dte, 45);

// ── Pick doc (SA wire shape) ───────────────────────────────────────────────

const day: PickDocDay = {
  underlyingClose: 603.21,
  contractId: 'QQQ260130P00578000',
  expiration: '2026-01-30',
  dte: 45,
  strike: 578,
  delta: -0.148,
  iv: 0.213,
  mark: 3.01,
  bid: 2.98,
  ask: 3.05,
  volume: 412,
  openInterest: 5331,
};
const doc: PickDocument = {
  symbol: 'QQQ',
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte', dte: 45 },
  gridVersion: 3,
  firstDate: '2025-12-15',
  lastDate: '2026-03-20',
  pickCount: 64,
  missCount: 3,
  days: { '2025-12-15': day },
};
const dayEntry = doc.days['2025-12-15'];
check('pick-doc day narrows to pick', isPickDocPick(dayEntry), true);
check('pick-doc day contractId', isPickDocPick(dayEntry) ? dayEntry.contractId : null, 'QQQ260130P00578000');
check('pick-doc day field count', Object.keys(day).length, 12);
check('pick-doc meta fields', [doc.gridVersion, doc.pickCount, doc.missCount], [3, 64, 3]);

// ── Contract list rows ─────────────────────────────────────────────────────

const pickRow: ContractListRow = {
  kind: 'pick',
  entryDate: '2025-12-15',
  side: TradeSide.SHORT,
  ...day,
  repeatsPrevious: false,
};
const markerRow: ContractListRow = { kind: 'no-selection', entryDate: '2025-12-16' };
check('pick row kind', pickRow.kind, 'pick');
check('pick row spreads all day fields', pickRow.kind === 'pick' && pickRow.mark === day.mark, true);
check('marker row kind', markerRow.kind, 'no-selection');
check('marker row keys (order-independent)', Object.keys(markerRow).sort(), ['entryDate', 'kind']);

// ── Run + list doc ─────────────────────────────────────────────────────────

const run: OptionsReplayRun = {
  runId: 'or-verify-1275',
  templateId: template.id,
  symbols: ['QQQ'],
  startDate: '2026-01-05',
  status: 'running',
  totalLists: 1,
  completedLists: 0,
  failedLists: 0,
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:05:00Z',
};
check('run progress fields', [run.totalLists, run.completedLists, run.failedLists], [1, 0, 0]);
check('run status vocabulary', OPTIONS_REPLAY_RUN_STATUSES.includes(run.status), true);

const listDoc: OptionsContractListDoc = {
  runId: run.runId,
  symbol: 'QQQ',
  templateId: template.id,
  status: 'success',
  rows: [pickRow, markerRow],
  pickDocMeta: {
    coordinate: template.coordinate,
    gridVersion: doc.gridVersion,
    pickCount: doc.pickCount,
    missCount: doc.missCount,
    firstDate: doc.firstDate,
    lastDate: doc.lastDate,
  },
  generatedAt: '2026-10-25T00:05:00Z',
};
check('list doc status vocabulary', OPTIONS_CONTRACT_LIST_STATUSES.includes(listDoc.status), true);
check('list doc row count', listDoc.rows.length, 2);
check('list doc meta carries coordinate', listDoc.pickDocMeta.coordinate.expiry.dte, 45);

// ── Payloads ───────────────────────────────────────────────────────────────

const startReq: OptionsReplayStartRequest = { templateId: template.id, symbols: ['QQQ'], startDate: '2026-01-05' };
const perm: OptionsReplayPermutationPayload = { runId: run.runId, symbol: 'QQQ', templateId: template.id, startDate: '2026-01-05' };
check('start request shape', Object.keys(startReq).sort(), ['startDate', 'symbols', 'templateId']);
check('task payload shape', Object.keys(perm).sort(), ['runId', 'startDate', 'symbol', 'templateId']);

if (failures === 0) {
  console.log('=== ALL CHECKS PASSED ===');
} else {
  console.log(`=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
