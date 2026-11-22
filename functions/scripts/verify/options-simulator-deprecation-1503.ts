/**
 * #1503 — BE Task: Legacy simulator deprecation note.
 *
 * Verifies the two contract points of the deprecation task:
 *   1. The superseded marker is present on `runBacktestSimulation`
 *      (backtest-simulator.ts) and on its task-queue callable entry
 *      `stBacktestPermutation` (backtest-worker.ts) — naming the
 *      superseding surface (Selection Replay + Backtest Analytics,
 *      Threads #1240/#1266/#1270) and the "retained / do not extend" policy.
 *   2. No callers were removed or changed — the worker still imports and
 *      invokes `runBacktestSimulation`, and the public signature is intact.
 *
 * Static source assertions: read-only, no env, no Firestore.
 *
 *   npx tsx scripts/verify/options-simulator-deprecation-1503.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'src', 'st-cloud-function', 'backtest');
const simulatorSrc = readFileSync(join(SRC, 'backtest-simulator.ts'), 'utf8');
const workerSrc = readFileSync(join(SRC, 'backtest-worker.ts'), 'utf8');

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

/**
 * The JSDoc block immediately above a declaration — matches the last
 * doc-comment that directly precedes it (only trailing whitespace allowed,
 * so an unrelated earlier comment can't satisfy the check).
 */
function docAbove(src: string, declarationRe: RegExp): string | null {
  const m = declarationRe.exec(src);
  if (!m) return null;
  const head = src.slice(0, m.index);
  // The doc block must be the LAST `/**` before the declaration and extend
  // unbroken to it — otherwise an unrelated earlier comment could satisfy
  // the phrase checks.
  const tail = head.slice(head.lastIndexOf('/**'));
  if (!/^\/\*\*[\s\S]*\*\/\s*$/.test(tail)) return null;
  // Collapse comment continuation lines + newlines so phrases that wrap
  // mid-sentence still match single-line patterns.
  return tail.replace(/\s*\*?\s+/g, ' ');
}

console.log('— Superseded marker on runBacktestSimulation —');
const simDoc = docAbove(simulatorSrc, /export async function runBacktestSimulation\b/);
check('JSDoc directly above runBacktestSimulation', simDoc !== null);
check(
  'marker names the superseding surface (Selection Replay + Backtest Analytics)',
  !!simDoc && /superseded by Selection Replay \+ Backtest Analytics/i.test(simDoc),
);
check(
  'marker names the superseding Threads #1240/#1266/#1270',
  !!simDoc && /#1240/.test(simDoc) && /#1266/.test(simDoc) && /#1270/.test(simDoc),
);
check(
  'marker states the policy (retained for reference, do not extend)',
  !!simDoc && /retained for reference/i.test(simDoc) && /do not extend/i.test(simDoc),
);
check('marker carries the @deprecated tag', !!simDoc && /@deprecated/.test(simDoc));

console.log('— Superseded marker on stBacktestPermutation callable —');
const callableDoc = docAbove(workerSrc, /export const stBacktestPermutation\b/);
check('JSDoc directly above stBacktestPermutation', callableDoc !== null);
check(
  'callable marker names the superseding surface',
  !!callableDoc && /superseded by Selection Replay \+ Backtest Analytics/i.test(callableDoc),
);
check(
  'callable marker names the superseding Threads',
  !!callableDoc && /#1240/.test(callableDoc) && /#1266/.test(callableDoc) && /#1270/.test(callableDoc),
);
check(
  'callable marker states the policy',
  !!callableDoc && /retained for reference/i.test(callableDoc) && /do not extend/i.test(callableDoc),
);
check('callable marker carries the @deprecated tag', !!callableDoc && /@deprecated/.test(callableDoc));

console.log('— No callers removed or changed —');
check(
  'worker still imports runBacktestSimulation',
  /import\s*\{\s*runBacktestSimulation\s*\}\s*from\s*'\.\/backtest-simulator'/.test(workerSrc),
);
check(
  'worker still invokes runBacktestSimulation',
  /await runBacktestSimulation\(/.test(workerSrc),
);
check(
  'simulator export still exists with the same signature head',
  /export async function runBacktestSimulation\(\s*symbol: string,\s*strategy: StrategyAdapter,\s*config: StrategyConfig,\s*dailyBars: OHLCV\[\],/.test(simulatorSrc),
);
check(
  'callable still re-exported from functions/src/index.ts',
  /export\s*\{\s*stBacktestPermutation\s*\}\s*from\s*'\.\/st-cloud-function\/backtest\/backtest-worker'/.test(
    readFileSync(join(here, '..', '..', 'src', 'index.ts'), 'utf8'),
  ),
);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
