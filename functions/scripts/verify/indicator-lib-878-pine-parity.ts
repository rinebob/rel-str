/**
 * indicator-lib-878-pine-parity.ts — static parity audit for
 * rb-ps/rb-ta/ind/rb-st-trigger-bands.pine (task #878).
 *
 * Pine can't be compiled locally (TradingView-only runtime — the manual
 * TV-vs-web check is the UAT leg), so this script pins what IS checkable:
 * the #878 cleanup (no rbLib import, offsets, midpoint, retrace, wick
 * variants, constant markers, debug logging, v5-only nz()), the v6
 * structure (hoisted ta.* calls — `and` short-circuits), and the
 * engine-parity contract (na warm-up, expansion-gated arming, band
 * precondition, body cross, breakout-only envelope dots ∓ 1.5*ATR).
 *
 * Usage:  npx tsx scripts/verify/indicator-lib-878-pine-parity.ts
 *   run from functions/ — no args, read-only, ~instant.
 * PASS: every check prints PASS and the summary shows 0 failures.
 * FAIL: prints the offending pattern/line — fix the .pine file (or update
 *   this audit if the contract intentionally changed) and re-run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pinePath = resolve(here, '../../../rb-ps/rb-ta/ind/rb-st-trigger-bands.pine');
const src = readFileSync(pinePath, 'utf8');
const lines = src.split('\n');

// Strip comments so commented-out cruft can't trip the FORBIDDEN checks —
// but a commented REQUIRED expression doesn't count either (it must be live).
// Handles trailing `//` too, quote-aware so a `//` inside a string literal
// doesn't truncate the line.
const stripComments = (line: string): string => {
  let quote: string | null = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const c = line[i];
    if (quote === null) {
      if (c === '"' || c === "'") quote = c;
      else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    } else if (c === '\\') {
      i++; // skip the escaped char — \" or \' doesn't toggle the string
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

// ---------- #878 cleanup (must NOT appear in live code) ----------
check('Pine v6 header', /\/\/@version=6/.test(src));
check('no rbLib import', !/import\s+rinebob\//.test(live));
check('no horzOffset', !/horzOffset/.test(live));
check('no vertOffset', !/vertOffset/.test(live));
check('no midpoint', !/\bmidpoint\b/i.test(live));
check('no retrace logic', !/\bretrace\b/i.test(live));
check('no debug logging', !/log\.(info|warn|error)/.test(live));
check('no constant-value markers', !/\?\s*-?\d+\s*:\s*na/.test(live),
  'plot(… ? <number> : na) emits a constant — dots must anchor to the envelope');
check('no nz() — v6 removed the bool overload (won\'t compile)',
  !/\bnz\(/.test(live));
check('no wick variants — bands/dots reference body + band, not raw high/low',
  !/\b(?:high|low)\s*(?:\[|,|\)|\s)/.test(live.replace(/bodyHigh|bodyLow/g, 'B')));

// ---------- engine-parity contract (must appear in live code) ----------
check('na warm-up on bands', /bar_index\s*>=\s*length\s*-\s*1/.test(live));
check('body-based bands (open/close max/min)', /bodyHigh\s*=\s*open\s*<\s*close/.test(live)
  && /bodyLow\s*=\s*open\s*>\s*close/.test(live));
check('long pullback flag', /longPullback\s*=\s*upper\s*<=\s*upper\[1\]/.test(live));
check('short pullback flag', /shortPullback\s*=\s*lower\s*>=\s*lower\[1\]/.test(live));
check('long expansion latch', /upper\s*>\s*upper\[1\]\s*\?\s*true/.test(live));
check('short expansion latch', /lower\s*<\s*lower\[1\]\s*\?\s*true/.test(live));
check('crosses hoisted to global scope (lazy `and` → inconsistent history)',
  /crossUp\s*=\s*ta\.crossover\(bodyHigh,\s*upper\[1\]\)/.test(live)
  && /crossDn\s*=\s*ta\.crossunder\(bodyLow,\s*lower\[1\]\)/.test(live));
check('bands computed unconditionally (no ta.* behind the ternary)',
  /upperRaw\s*=\s*ta\.highest\(bodyHigh/.test(live)
  && /lowerRaw\s*=\s*ta\.lowest\(bodyLow/.test(live));
check('long breakout: band precondition + crossover + armed',
  /upper\[2\]\s*>=\s*upper\[1\]\s+and\s+crossUp\s+and\s+longPullbackState\[1\]/.test(live));
check('short breakout: band precondition + crossunder + armed',
  /lower\[2\]\s*<=\s*lower\[1\]\s+and\s+crossDn\s+and\s+shortPullbackState\[1\]/.test(live));
check('arming requires flag AND expansion',
  /longPullback\s+and\s+longExpanded/.test(live)
  && /shortPullback\s+and\s+shortExpanded/.test(live));
check('breakout resets latch + state (reset-before-expansion)',
  /longExpanded\s*:=\s*longBreakout\s*\?\s*false/.test(live)
  && /longPullbackState\s*:=\s*longBreakout\s*\?\s*false/.test(live)
  && /shortExpanded\s*:=\s*shortBreakout\s*\?\s*false/.test(live)
  && /shortPullbackState\s*:=\s*shortBreakout\s*\?\s*false/.test(live));
check('var bool state machines with plain [1] carry (v6 bools are never na)',
  /var bool longExpanded/.test(live)
  && /var bool longPullbackState/.test(live)
  && /var bool shortExpanded/.test(live)
  && /var bool shortPullbackState/.test(live)
  && /:\s*longExpanded\[1\]/.test(live)
  && /:\s*longPullbackState\[1\]/.test(live));
check('dots are breakout-only (no state-dot plots)',
  !/plot\([^)]*PullbackState/.test(live));
check('ATR via ta.atr(14) (documented lookahead gap pre-bar-14)',
  /ta\.atr\(14\)\s*\*\s*1\.5/.test(live));
check('statement order: breakout -> expansion latch -> armed state',
  (() => {
    const i = (re: RegExp) => liveLines.findIndex((l) => re.test(l));
    const lb = i(/longBreakout\s*=/), le = i(/longExpanded\s*:=/), ls = i(/longPullbackState\s*:=/);
    const sb = i(/shortBreakout\s*=/), se = i(/shortExpanded\s*:=/), ss = i(/shortPullbackState\s*:=/);
    return lb >= 0 && lb < le && le < ls && sb >= 0 && sb < se && se < ss;
  })());
check('dot anchor = band ∓ 1.5*ATR',
  /\*\s*1\.5/.test(live)
  && /longBreakout\s*\?\s*lower\s*-/.test(live)
  && /shortBreakout\s*\?\s*upper\s*\+/.test(live));
check('band stepline plots with flag colouring',
  /plot\(upper,/.test(live) && /plot\(lower,/.test(live)
  && /longPullback\s*\?/.test(live) && /shortPullback\s*\?/.test(live));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
