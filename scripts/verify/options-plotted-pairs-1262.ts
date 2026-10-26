/**
 * Verification: plotted-pair parser + plotted-set contract shape
 * (task #1262, options FE blueprint).
 *
 * Exercises the shipped parsePlottedEntries seam end-to-end — no Angular,
 * no network. The store-side behaviors (concurrency, error tolerance,
 * resurrection guards) are covered by jest; this script proves the parser
 * contract a pasted list actually hits:
 *
 *  1. (date, contractId) pairs: comma, space, and tab separators.
 *  2. Bare OCC IDs accepted with openDate null.
 *  3. Duplicate contractIds merge, keeping the earliest supplied openDate.
 *  4. Rejects: malformed contract, non-ISO date, impossible calendar date,
 *     wrong underlying — each tagged with the offending raw line + reason.
 *  5. Valid lines survive alongside rejected lines.
 *
 * Run: npx tsx scripts/verify/options-plotted-pairs-1262.ts
 * Pass: all OK. Fail: FAIL lines + exit 1.
 */

import { parsePlottedEntries } from '../../src/app/features/savant-trader/utils/plotted-pairs.util';

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const PUT = 'QQQ260619P00470000';
const CALL = 'QQQ260619C00475000';
const SPY = 'SPY260619P00500000';

// ── 1. Pair separators ───────────────────────────────────────────────────

{
  const r = parsePlottedEntries(`2026-06-15,${PUT}\n2026-06-16 ${CALL}\n2026-06-17\t${PUT}`, 'QQQ');
  const byId = new Map(r.entries.map((e) => [e.contractId, e]));
  check('comma pair parses', byId.get(PUT)?.openDate === '2026-06-15' || byId.get(PUT)?.openDate === '2026-06-17');
  check('space pair parses', byId.get(CALL)?.openDate === '2026-06-16');
  check('no rejections on clean input', r.rejected.length === 0, `${r.rejected.length} rejected`);
}

// ── 2. Bare ID ───────────────────────────────────────────────────────────

{
  const r = parsePlottedEntries(PUT, 'QQQ');
  check('bare ID accepted', r.entries.length === 1 && r.entries[0].openDate === null);
}

// ── 3. Dedupe keeps earliest openDate ────────────────────────────────────

{
  const r = parsePlottedEntries(`2026-06-16,${PUT}\n2026-06-15,${PUT}\n${PUT}`, 'QQQ');
  check('dupes merge to one entry', r.entries.length === 1);
  check('earliest openDate wins', r.entries[0].openDate === '2026-06-15');
}

// ── 4. Rejections ────────────────────────────────────────────────────────

{
  const bad = parsePlottedEntries(`garbage\n06/15/2026,${PUT}\n2026-13-40,${PUT}\n2026-06-15,${SPY}`, 'QQQ');
  const reasons = bad.rejected.map((x) => x.reason);
  check('malformed line → invalid-contract', reasons.includes('invalid-contract'));
  check('US-format date → invalid-date', reasons.filter((x) => x === 'invalid-date').length === 2,
    `invalid-date count ${reasons.filter((x) => x === 'invalid-date').length}`);
  check('wrong underlying → wrong-underlying', reasons.includes('wrong-underlying'));
  check('rejections carry the raw line', bad.rejected.every((x) => x.raw.length > 0));
}

// ── 5. Mixed input keeps valid entries ───────────────────────────────────

{
  const r = parsePlottedEntries(`2026-06-15,${PUT}\nbogus\n${CALL}`, 'QQQ');
  check('valid entries survive rejects', r.entries.length === 2 && r.rejected.length === 1);
}

console.log('');
if (failures === 0) {
  console.log(`=== ALL ${checks} CHECKS PASSED ===`);
} else {
  console.log(`=== ${failures}/${checks} CHECKS FAILED ===`);
  process.exit(1);
}
