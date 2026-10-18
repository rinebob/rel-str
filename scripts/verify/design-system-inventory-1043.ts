/**
 * #1043 — DS inventory catalog doc + mockup convention.
 *
 * Checks docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md:
 *   1. Doc exists at the issue-specified path (per-Topic naming convention).
 *   2. Header carries the canonical field block (two-space line breaks).
 *   3. Mockup convention is stated in the header area (/dev/ds screenshots
 *      or token-built SVGs, cited by element name).
 *   4. Extracted-element rows cite real source files — every path mentioned
 *      in the Extracted + Infrastructure tables resolves on disk (rel-str
 *      or the sibling savant-ds/av-proxy-api checkouts).
 *   5. Both tables are populated: extracted elements AND next-thread
 *      candidate rows present.
 *
 * Run from repo root:
 *   npx tsx scripts/verify/design-system-inventory-1043.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REL = path.resolve('.');
const DS = path.resolve('..', 'savant-ds');
const SA = path.resolve('..', 'av-proxy-api');

let checks = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── 1. doc exists at the conventional path ──────────────────────────────────
const docPath = path.join(
  REL, 'docs', 'topics', '1024-design-system', '1024-1025-DS-INVENTORY.md');
check('inventory doc exists at conventional path', existsSync(docPath), docPath);
if (!existsSync(docPath)) process.exit(1);

const doc = readFileSync(docPath, 'utf8');

// ── 2. canonical header fields ──────────────────────────────────────────────
for (const field of ['**Topic:**', '**Topic Slug:**', '**Thread:**',
  '**Issue:** #1043', '**Thread Parent:** #1025', '**Topic Parent:** #1024',
  '**Type:**', '**Status:**']) {
  check(`header field ${field.replace(/\*\*/g, '')}`, doc.includes(field));
}

// ── 3. mockup convention stated ─────────────────────────────────────────────
check('mockup convention states /dev/ds screenshots', /\/dev\/ds`?\s+screenshots?/i.test(doc));
check('mockup convention states token-built SVGs', /token-built SVGs?/i.test(doc));
check('mockups cited by element name', /cited by element name/i.test(doc));

// ── 4. cited source paths resolve on disk ───────────────────────────────────
// Paths cited with repo-name prefixes map to real checkouts.
const CROSS_ROOTS: [string, string][] = [
  ['savant-ds/', DS],
  ['av-proxy-api/', SA],
];
const cited = new Set<string>();
for (const m of doc.matchAll(
  /`((?:savant-ds|av-proxy-api|src|vendor|scripts)\/[^`]+|(?:angular|package)\.json)`/g)) {
  cited.add(m[1]);
}
check('doc cites at least one source path', cited.size > 0);
let unresolved = 0;
for (const c of cited) {
  const cross = CROSS_ROOTS.find(([prefix]) => c.startsWith(prefix));
  const p = cross
    ? path.join(cross[1], c.slice(cross[0].length))  // sibling repo: strip prefix
    : path.join(REL, c);                            // rel-str-relative as written
  if (!existsSync(p)) { unresolved++; console.log(`     unresolved: ${c}`); }
}
check('every cited source path resolves on disk', unresolved === 0,
  `${unresolved} unresolved`);

// ── 5. both tables populated ────────────────────────────────────────────────
const extracted = doc.split('## Extracted elements')[1]?.split('##')[0] ?? '';
const candidates = doc.split('## Candidate elements')[1] ?? '';
const rows = (s: string) => (s.match(/^\| [^|-]/gm) ?? []).length - 1; // minus header
check('extracted-element rows present (>= 8)', rows(extracted) >= 8,
  `${rows(extracted)} rows`);
check('candidate rows present (>= 5)', rows(candidates) >= 5,
  `${rows(candidates)} rows`);

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
