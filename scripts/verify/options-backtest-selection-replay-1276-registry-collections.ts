/**
 * Verification: selection-replay template registry + collections (task #1276,
 * absorbs #1277).
 *
 * Single purpose: prove `shared/options-replay-templates.ts` and the new
 * `st-options-*` constants resolve through their real tsconfig aliases
 * (`@options-replay/templates`, `@st/collections`) under tsx — the import
 * path FE and BE will use. The specs use relative imports and never exercise
 * the aliases; this script is the only surface that does.
 *
 * Registry hygiene, rules blocks, and the composite index are already
 * covered for real — `options-replay-templates.spec.ts` / `st-collections.spec.ts`
 * (jest) and `tests/functions/firestore-rules-indexes-1012.test.ts`
 * (`cd functions && npm run test:st-rules-indexes`). Do not re-assert them here.
 *
 * Usage: npx tsx scripts/verify/options-backtest-selection-replay-1276-registry-collections.ts
 *
 * No credentials, no Firestore — alias resolution + smoke checks only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import { getReplayTemplate, REPLAY_TEMPLATES } from '@options-replay/templates';
import {
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  stOptionsContractListDocId,
} from '@st/collections';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// Alias smoke — if any import above resolved to the wrong module or a stale
// build, these representative values fail.

check('registry seeds', REPLAY_TEMPLATES.map((t) => t.id), ['csp-45-20', 'csp-30-30']);
check('getReplayTemplate hit coordinate', getReplayTemplate('csp-45-20')?.coordinate, {
  type: OptionType.PUT,
  targetDelta: -0.2,
  expiry: { mode: 'nearestDte', dte: 45 },
});
check('getReplayTemplate hit side', getReplayTemplate('csp-45-20')?.side, TradeSide.SHORT);
check('getReplayTemplate miss', getReplayTemplate('nope'), undefined);
check('replay runs root', ST_OPTIONS_REPLAY_RUNS_ROOT, 'st-options-replay-runs');
check('contract lists root', ST_OPTIONS_CONTRACT_LISTS_ROOT, 'st-options-contract-lists');
check('list doc id', stOptionsContractListDocId('or-abc', 'qqq'), 'or-abc_QQQ');

if (failures === 0) {
  console.log('=== ALL CHECKS PASSED ===');
} else {
  console.log(`=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
