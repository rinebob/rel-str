/**
 * Retirement audit for #1009 — savant-trader/data/review-list +
 * savant-trader/data/occurrence-decisions. Checks the BE half of the
 * retirement contract:
 *
 *   1. CODE — no functions/src file references either retired collection
 *      path. The single whitelisted reference is the TTL sweeper's
 *      hardcoded path (it must keep reading the legacy collection until
 *      it drains — #1013 deletes the collection and the sweeper).
 *      FAIL: any other file contains a retired-path literal.
 *
 *   2. TTL DRAIN — cleanupStOccurrenceDecisions stays exported from
 *      index.ts (the drain mechanism; "TTL keeps draining decisions").
 *      FAIL: export missing.
 *
 *   3. PROD (read-only) — reports doc counts for both collections and
 *      the decidedAt range in occurrence-decisions. Fresh decisions
 *      (decidedAt within the last day) are WARN, not FAIL: the FE still
 *      writes until #1016/#1017 land — this audit verifies the BE
 *      contract, and a fresh-write WARN is the expected pre-#1017 state.
 *      After #1017 ships, a fresh-write WARN becomes a regression signal.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-decisions-retirement-1009.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../../src/firebase-admin-init';

// Scan radius = deployed function code (functions/src) — ops scripts
// under functions/scripts/ are intentionally outside it.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const REVIEW_LIST = 'savant-trader/data/review-list';
const OCCURRENCE_DECISIONS = 'savant-trader/data/occurrence-decisions';
const RETIRED_PATHS = [REVIEW_LIST, OCCURRENCE_DECISIONS];
const WHITELIST_SUFFIXES = ['/scheduled/cleanup-st-occurrence-decisions.ts'];
const FRESH_WRITE_WINDOW_MS = 24 * 60 * 60 * 1000;

let fails = 0;
let warns = 0;
const ok = (m: string) => console.log(`OK   ${m}`);
const warn = (m: string) => { warns++; console.log(`WARN ${m}`); };
const fail = (m: string) => { fails++; console.log(`FAIL ${m}`); };

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry).replaceAll('\\', '/');
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

async function main() {
  console.log('#1009 review-list + occurrence-decisions retirement audit\n');

  // ── 1. code invariant — no BE references outside the sweeper ──────────
  const offenders: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    if (WHITELIST_SUFFIXES.some((s) => file.endsWith(s))) continue;
    const text = readFileSync(file, 'utf8');
    for (const path of RETIRED_PATHS) {
      if (text.includes(path)) offenders.push(`${file} → ${path}`);
    }
  }
  if (offenders.length === 0) {
    ok('no functions/src reference to retired paths (sweeper whitelisted)');
  } else {
    for (const o of offenders) fail(`BE reference to retired path: ${o}`);
  }

  // ── 2. TTL drain intact ────────────────────────────────────────────────
  const index = readFileSync(`${SRC_ROOT}/index.ts`, 'utf8');
  if (/^export \{[^}]*cleanupStOccurrenceDecisions[^}]*\}/m.test(index)) {
    ok('cleanupStOccurrenceDecisions still exported (TTL drain registered)');
  } else {
    fail('cleanupStOccurrenceDecisions export missing — TTL drain dead');
  }

  // ── 3. prod state (read-only) ──────────────────────────────────────────
  const lists = await db.collection(REVIEW_LIST).count().get();
  const listCount = lists.data().count;
  console.log(`INFO review-list docs: ${listCount} (FE writes stop at #1016; collection dies at #1013)`);

  const decisions = await db
    .collection(OCCURRENCE_DECISIONS)
    .select('decidedAt')
    .get();
  if (decisions.empty) {
    ok('occurrence-decisions empty — drain complete ahead of #1013 delete');
  } else {
    let newest = '';
    let oldest = '';
    let missingTs = 0;
    for (const d of decisions.docs) {
      const ts = String(d.data().decidedAt ?? '');
      if (!ts) {
        missingTs++;
        continue; // invisible to the sweeper's decidedAt<cutoff query — drains only at #1013 wholesale delete
      }
      if (newest === '' || ts > newest) newest = ts;
      if (oldest === '' || ts < oldest) oldest = ts;
    }
    if (missingTs > 0) {
      warn(`${missingTs}/${decisions.size} decision docs missing decidedAt — undrainable by TTL, wait for #1013 delete`);
    }
    const oldestMs = new Date(oldest).getTime();
    const newestMs = new Date(newest).getTime();
    if (oldest === '' || !Number.isFinite(oldestMs) || !Number.isFinite(newestMs)) {
      fail(`unparseable decidedAt range '${oldest}' → '${newest}' — audit cannot assess drain health`);
    } else {
      const ageDays = (Date.now() - oldestMs) / (24 * 60 * 60 * 1000);
      console.log(
        `INFO occurrence-decisions docs: ${decisions.size}; decidedAt range ${oldest} → ${newest}`,
      );
      if (ageDays > 9) {
        warn(`oldest decision ${ageDays.toFixed(1)}d > TTL 7d + buffer — sweeper may not be running; check scheduler`);
      } else {
        ok(`decision window ${ageDays.toFixed(1)}d within TTL 7d + buffer — drain healthy`);
      }
      const newestAge = Date.now() - newestMs;
      if (newestAge < FRESH_WRITE_WINDOW_MS) {
        warn(`fresh decision write ${(newestAge / 3600000).toFixed(1)}h ago — FE writer still live (expected until #1017; WARN becomes a regression signal after)`);
      } else {
        ok('no fresh decision writes in the last 24h — write-stop holding');
      }
    }
  }

  console.log(`\n— audit —\n${fails} FAIL, ${warns} WARN`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('AUDIT CRASH:', e);
  process.exit(1);
});
