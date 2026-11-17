/**
 * indicator-lib-873-pine-parity.ts — static parity audit for
 * rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine (task #873).
 *
 * Pine can't be compiled locally (TradingView-only runtime — the manual
 * TV-vs-web checklist is the UAT leg), so this script pins what IS
 * checkable: the causal no-backfill contract, surviving-vertex
 * supersession handling, scaffold removal, the polyline/label budgets,
 * input surface, and the #873 review fix-set (drawing-lifecycle guards,
 * bar_time anchors, volume gating).
 *
 * Usage:  npx tsx scripts/verify/indicator-lib-873-pine-parity.ts
 *   run from functions/ — no args, read-only, ~instant.
 * PASS: every check prints PASS and the summary shows 0 failures.
 * FAIL: prints the offending pattern — fix the .pine file (or update
 *   this audit if the contract intentionally changed) and re-run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pinePath = resolve(here, '../../../rb-ps/rb-ta/ind/rb-st-anchored-vwap.pine');
const src = readFileSync(pinePath, 'utf8');
const lines = src.split('\n');

// Strip comments — quote-aware so a `//` inside a string literal doesn't
// truncate the line. A commented-out expression doesn't count as live.
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

console.log('— Scaffold removal (AC3) —');
check('no plot() outputs remain', !/\bplot\(/.test(live));
check('no plotshape markers remain', !/plotshape\(/.test(live));
check('no debug table remains', !/\btable[.(]/.test(live) && !/\bdbg\b/.test(live));
check('no debug flag remains', !/debugOn/.test(live));

console.log('— Header / attribution —');
check('MPL-2.0 header retained', /Mozilla Public License 2\.0/.test(src));
check('ZigZag Library v9 attribution retained', /ZigZag Library v9/.test(src));
check('Pine v6', /^\/\/@version=6/m.test(src));
check('overlay indicator declared', /indicator\("ST Anchored VWAP",\s*overlay\s*=\s*true/.test(live));

console.log('— Causal contract (AC1/AC2) —');
check('surviving-vertex refinement overwrites pivot end', /lastPivot\.end\s*:=\s*point/.test(live));
check('trigger scan-back over [pendBar, bar_index]', /scanTrigger\(b,\s*this\.pendBar,\s*bar_index/.test(live));
check('trigger scan includes the pivot bar (from pendBar)', /for j = fromBar to toBar/.test(live));
check('segments draw from triggerBar, anchored at pivotBar',
  /buildPoints\(b, s\.pivotBar, s\.price, s\.triggerBar,/.test(live));
check('VWAP via cumPV/cumV prefix sums', /cumPV\.get\(j\)\s*-\s*basePV\)\s*\/\s*dv/.test(live));
check('zero-volume flat carry reuses previous value', /nz\(vwapAt\(b, aIdx, j\), last\)/.test(live));
check('volume/na guard feeds the cumulative sums', /okVol = not na\(tpBar\) and nz\(volume\) > 0/.test(live));

console.log('— Supersession reconciliation (#873 review fix-set) —');
check('Seg carries endBar for the predecessor guard', /int\s+endBar\s*=\s*na/.test(live));
check('Seg carries its trigger dot', /label\s+dot\s*=\s*na/.test(live));
check('stale dot dropped via dropDot before rescan resolves', /this\.dropDot\(this\.cur\)/.test(live));
check('re-anchor re-pushes dot at the refined trigger', /this\.cur\.dot\s*:=\s*label\.new\(b\.ts\.get\(t\)/.test(live));
check('predecessor re-ends at refined trigger, guarded by endBar == oldT',
  /pred\.endBar\s*==\s*oldT/.test(live) && /pred\.endBar\s*:=\s*t/.test(live));
check('untriggered supersession demotes cur to pend', /this\.hasPend\s*:=\s*true/.test(live));
check('previous triggered vertex resurrected via popPred', /Seg pred = this\.popPred\(oldT\)/.test(live));
check('popPred identifies the true predecessor by lastFired.endBar',
  /Seg pred = this\.lastFired/.test(live) && /pred\.endBar == endT/.test(live));
check('popPred pops the container only on endBar+pivotBar identity',
  /tail\.endBar == endT and tail\.pivotBar == pred\.pivotBar/.test(live));

console.log('— Same-bar collapse (round-2 fix-set) —');
check('pre-update last vertex index snapshotted (preLastIdx)', /preLastIdx = this\.zz\.pivots/.test(live));
check('collapse gated on consecutive same-index chain vertices (sameIdx)',
  /sameIdx = k > 0 and this\.zz\.pivots\.get\(k - 1\)\.end\.index == p\.end\.index/.test(live));
check('collapse matches pre-refinement index too', /this\.cur\.pivotBar == p\.end\.index or this\.cur\.pivotBar == preLastIdx/.test(live));
check('collapsed cur drops its dot (no orphan)', /this\.dropDot\(this\.cur\)/.test(live));
check('collapsed vertex resurrects its predecessor via popPred', /this\.popPred\(deadT\)/.test(live));
check('re-anchor syncs lastFired.endBar (window-dropped predecessor keeps its resurrect key)',
  /this\.lastFired\.endBar == oldT/.test(live) && /this\.lastFired\.endBar := t/.test(live));

console.log('— Dot bookkeeping —');
check('dropDot removes the handle from the dots array (indexof/remove)',
  /this\.dots\.indexof\(s\.dot\)/.test(live) && /this\.dots\.remove\(di\)/.test(live));
check('dot cap is a named constant tied to the label budget', /int DOT_CAP = 50/.test(live));

console.log('— Drawing lifecycle / budgets (AC4 + review fixes) —');
check('polyline budget declared', /max_polylines_count\s*=\s*100/.test(live));
check('label budget declared', /max_labels_count\s*=\s*100/.test(live));
check('per-scale cap = min(maxHist, 46)', /cap\s*=\s*math\.min\(maxHist,\s*46\)/.test(live));
check('trigger dots capped at DOT_CAP/scale', (live.match(/this\.dots\.size\(\)\s*>\s*DOT_CAP/g) ?? []).length === 2);
check('persist+era keeps FIRST cap (room gate)', /room\s*=\s*not histOn or this\.fan\.size\(\)\s*<\s*cap/.test(live));
check('persist bookkeeping: endBar + lastFired set before the window gate',
  /this\.cur\.endBar := T/.test(live) && /this\.lastFired := this\.cur/.test(live));
check('dropped persist seg deletes its committed polyline',
  /inWindow and room/.test(live) && /else\s*\n\s+if not na\(this\.cur\.pl\)\s*\n\s+polyline\.delete\(this\.cur\.pl\)/.test(live));
check('archive admits every in-window seg (hidden/degenerate count against the cap)',
  /this\.lastFired := s/.test(live) && /this\.hist\.push\(s\)/.test(live));
check('archive evicts inside the inWindow gate, before the push',
  /if inWindow\s*\n\s+if this\.hist\.size\(\) >= cap/.test(live));
check('hist stores Seg objects and both constructors allocate array<Seg>',
  /array<Seg>\s+hist/.test(live) && (live.match(/hist = array\.new<Seg>\(\)/g) ?? []).length === 2);
check('buildPoints refuses an inverted span', /if endIdx >= startIdx/.test(live));
check('drawSeg clears the deleted handle (s.pl := na)', /polyline\.delete\(s\.pl\)\s*\n\s+s\.pl := na/.test(live));
check('all drawings anchored by time, not bar_index',
  /xloc\s*=\s*xloc\.bar_time/.test(live) && !/xloc\.bar_index/.test(live));
check('points built with from_time', /chart\.point\.from_time\(b\.ts\.get\(j\), v\)/.test(live));
check('no 1-point polylines (>1 guards everywhere)', !/pts\.size\(\)\s*>\s*0/.test(live) && (live.match(/pts\.size\(\)\s*>\s*1/g) ?? []).length >= 2);
check('live/fan drawing gated to the last bar', /barstate\.islast/.test(live));

console.log('— Input surface (AC5) —');
check('retracement inputs for both scales (0.1–50)',
  (live.match(/input\.float\(\d+(\.\d+)?,\s*"Retracement %",\s*0\.1,\s*50/g) ?? []).length === 2);
check('depth inputs capped at 100',
  (live.match(/input\.int\(\d+,\s*"(Left|Right) Depth",\s*2,\s*100/g) ?? []).length === 4);
check('four color inputs', (live.match(/input\.color\(#[0-9A-Fa-f]{6}/g) ?? []).length === 4);
check('per-scale show-hi/show-lo toggles',
  /"Show highs"/.test(live) && /"Show lows"/.test(live));
check('per-scale persist toggles', (live.match(/"Persist lines"/g) ?? []).length === 2);
check('per-scale dot toggles', (live.match(/"Show trigger dots"/g) ?? []).length === 2);
check('historyStart + maxHistory inputs', /input\.time\(timestamp\(/.test(live) && /"Max history segments \/ scale",\s*1,\s*100/.test(live));

console.log('— Web-parity spots —');
check('default palette matches live web (#FF8CFF/#FFFF00, #00C853/#FF0000)',
  /#FF8CFF/.test(live) && /#FFFF00/.test(live) && /#00C853/.test(live) && /#FF0000/.test(live));
check('default weights match web (line1=3, line2=1)',
  /w1\s*=\s*input\.int\(3,/.test(live) && /w2\s*=\s*input\.int\(1,/.test(live));
check('default retracements 2% / 5%',
  /retr1\s*=\s*input\.float\(2\.0/.test(live) && /retr2\s*=\s*input\.float\(5\.0/.test(live));
check('gap-through dots use the bar open', /\? level : b\.opn\.get\(j\)/.test(live));
check('at most one live line per scale (cur state)', /Seg\s+cur\s*=\s*na/.test(live));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
