/**
 * indicator-lib-1676-pine-parity.ts — static parity audit for the IBS filter
 * in rb-ps/rb-ta/ind/rb-st-zones.pine (task #1676, Thread #1665).
 *
 * Pine can't be compiled locally (TradingView-only runtime — the manual
 * TV-vs-web check is the UAT leg), so this script pins what IS checkable:
 * the three gate inputs, the IBS formula + availability approximation, the
 * emit/suppressed partition, emission-only suppression (state vars still
 * latch unconditionally), ghost-marker wiring, and zero-cross ungated
 * parity with the TS gates in shared/st-ibs.ts + signal-detection.ts +
 * st-trend-rider-dots.indicator.ts.
 *
 * Usage:  npx tsx scripts/verify/indicator-lib-1676-pine-parity.ts
 *   run from functions/ — no args, read-only, ~instant.
 * PASS: every check prints PASS and the summary shows 0 failures.
 * FAIL: prints the offending pattern/line — fix the .pine file (or update
 *   this audit if the contract intentionally changed) and re-run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pinePath = resolve(here, '../../../rb-ps/rb-ta/ind/rb-st-zones.pine');
const src = readFileSync(pinePath, 'utf8');
const lines = src.split('\n');

// Strip comments — see indicator-lib-878-pine-parity.ts for the contract.
const stripComments = (line: string): string => {
  let quote: string | null = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const c = line[i];
    if (quote === null) {
      if (c === '"' || c === "'") quote = c;
      else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    } else if (c === '\\') {
      i++;
    } else if (c === quote) {
      quote = null;
    }
  }
  return line;
};
const liveLines = lines.map(stripComments).filter((l) => l.trim() !== '');
const live = liveLines.join('\n');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log(`auditing ${pinePath}\n`);

// ---------- inputs ----------
check('Pine v6 header', /\/\/@version=6/.test(src));
check('ET timezone hoisted to ST_ET_TZ',
  /const string ST_ET_TZ = "America\/New_York"/.test(live));
check('IBS Threshold input — float 0.5, 0..1, step 0.05',
  /input\.float\(0\.5, "IBS Threshold"[^)]*minval=0\.0[^)]*maxval=1\.0[^)]*step=0\.05/.test(live));
check('daily activation-hour input — int 12, 0..23',
  /input\.int\(12, "Daily IBS Available From \(ET hour\)", minval=0, maxval=23/.test(live));
check('Show Suppressed Signals input — bool false',
  /input\.bool\(false, "Show Suppressed Signals"/.test(live));

// ---------- IBS formula + availability ----------
check('na-OHLC pass-through guard (TS non-finite parity)',
  /stIbs = na\(high\) or na\(low\) or na\(close\)/.test(live));
check('zero/inverted range → 0.5 (st-ibs.ts:117 parity)',
  /\(high - low\) <= 0 \? 0\.5 : \(close - low\) \/ \(high - low\)/.test(live));
check('Sunday → week-tail 7 normalization (st-ibs.ts Sunday→7 parity)',
  /dayofweek\(timenow, ST_ET_TZ\) == dayofweek\.sunday \? 7/.test(live));
check('weekly activation ≥ Wednesday (Pine 1-based dayofweek)',
  /stIbsEtDow >= dayofweek\.wednesday/.test(live));
check('daily activation on wall-clock ET hour — timenow not time',
  /hour\(timenow, ST_ET_TZ\) >= stIbsActivateHourEt/.test(live));
check('availability — completed bars always defined',
  /stIbsAvailable = not barstate\.isrealtime or/.test(live));
check('long gate — available + defined → ibs ≥ threshold (inclusive)',
  /stIbsLongPass = not stIbsAvailable or na\(stIbs\) or stIbs >= stIbsThreshold/.test(live));
check('short gate — ≤ 1−threshold + ulp guard (TS Number.EPSILON parity)',
  /stIbsShortPass = not stIbsAvailable or na\(stIbs\) or stIbs <= 1\.0 - stIbsThreshold \+ 1e-15/.test(live));

// ---------- emit/suppressed partition ----------
for (const [v, d] of [['V1', 'Long'], ['V1', 'Short'], ['V2', 'Long'], ['V2', 'Short']] as const) {
  const pass_ = d === 'Long' ? 'stIbsLongPass' : 'stIbsShortPass';
  check(`st${v}${d}Emit = event AND gate`,
    new RegExp(`st${v}${d}Emit = st${v}${d}Event and ${pass_}`).test(live));
  check(`st${v}${d}Supp = event AND NOT gate`,
    new RegExp(`st${v}${d}Supp = st${v}${d}Event and not ${pass_}`).test(live));
}

// ---------- emission-only suppression ----------
// The state vars must still latch unconditionally inside the event blocks —
// no IBS token may appear on any state-assignment line.
check('state vars latch unconditionally (suppressed candidates consume FIRED)',
  ['stV1LongState', 'stV1ShortState', 'stV2LongState', 'stV2ShortState']
    .every((v) => liveLines.some((l) => l.includes(`${v} := 1`) && !l.includes('Ibs'))));
check('no IBS token in runtime assignments before the gate (gate is downstream)',
  (() => {
    const gateStart = liveLines.findIndex((l) => /float stIbs = /.test(l));
    return !liveLines.slice(0, gateStart).some((l) => l.includes(':=') && l.includes('Ibs'));
  })());

// ---------- plots ----------
check('emitted plots use *Emit conditions (gate applied)',
  /plot\(stV1LongEmit \? low - stDotOffset/.test(live)
  && /plot\(stV1ShortEmit \? high \+ stDotOffset/.test(live)
  && /plot\(stV2LongEmit \? low - stDotOffset/.test(live)
  && /plot\(stV2ShortEmit \? high \+ stDotOffset/.test(live));
check('ghost plots gated behind stShowSuppressed + *Supp conditions',
  (live.match(/stShowSuppressed and stV\d(?:Long|Short)Supp \?/g) ?? []).length === 4);
check('ghost styles mirror emitted families (V1 circles / V2 cross, linewidth 2)',
  [['V1', 'style_circles'], ['V2', 'style_cross']].every(([v, s]) =>
    liveLines.some((l) => l.includes(`stShowSuppressed and st${v}LongSupp`)
      && l.includes(`style=plot.${s}`) && l.includes('linewidth=2'))
    && liveLines.some((l) => l.includes(`stShowSuppressed and st${v}ShortSupp`)
      && l.includes(`style=plot.${s}`) && l.includes('linewidth=2'))));
check('ghost colors ~35% opacity (FE hex-8 59 parity)',
  (live.match(/color\.new\(color\.(green|red|lime|orange), 65\)/g) ?? []).length === 4);
check('all signal + ghost plots force_overlay (main-pane markers)',
  (() => {
    const sigPlots = liveLines.filter((l) => /^plot\(.*stV\d(Long|Short)(Emit|Supp) \?/.test(l));
    return sigPlots.length === 8 && sigPlots.every((l) => l.includes('force_overlay=true'));
  })());

// ---------- ungated parity ----------
check('zero-cross markers stay ungated (BE detectAllZoneZeroCrossSignals parity)',
  /plot\(stV1ZeroCrossLong \?/.test(live)
  && !/stV1ZeroCross(Long|Short)\s*=\s*[^=]*Ibs/.test(live)
  && !/stV2ZeroCross(Long|Short)\s*=\s*[^=]*Ibs/.test(live));
check('no lookahead introduced', !/lookahead_on/.test(live));

// ---------- summary ----------
console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
