/**
 * @topic #984 — ST Firestore Reorg (task #1661)
 *
 * Legacy `paper-trading/cohorts/items` retirement pin — asserts the
 * deleted cohort surface has ZERO references left in deployed code
 * (functions/src + shared/, which compiles into the bundle):
 *
 * - `PaperTradingKind.COHORT` / `PaperCohort` / `isPaperCohort` — the
 *   kind + doc contract for the retired collection; the canonical
 *   record is `st-position-groups` (the group doc already covers the
 *   cohort's fan-out anchor via memberTicketIds).
 * - `buildCohortId` / `buildCohortDoc` / `resolveCohortId` /
 *   `getCohort` / `setCohort` — the mint + read + write + seq-scan
 *   path the signal-order accept ran on the legacy root.
 * - `paperTradingItemsPath` / `itemsPathFor` — the legacy path builder
 *   + kind-routing shim; COHORT was the last un-routed kind, so both
 *   collapse to the unconditional st- path.
 * - `'paper-trading/cohorts'` path literals — nothing may name the
 *   dead collection.
 * - `cohortId` inside order-tickets code + contract — the #1005 soak
 *   bridge (`ticket.cohortId` → minted `trade.cohortId`) retires;
 *   `origin.positionGroupId` is the join.
 *
 * Deliberately NOT pinned: `cohort-*` stats-scope ids (canonical
 * family), `trade.cohortId` union-read fallbacks (pre-#1661 docs keep
 * the vestigial field until the backfill in purge-legacy-cohorts-1661
 * stamps `positionGroupId` everywhere), `AnalysisCohort`, and the
 * 'cohort' UI group-by label — none of those touch the collection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC_ROOT = join(REPO_ROOT, 'functions', 'src');
const SHARED_ROOT = join(REPO_ROOT, 'shared');

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) yield p;
  }
}

const hitsIn = (needle: string, root: string): string[] => {
  const out: string[] = [];
  for (const f of tsFiles(root)) {
    if (readFileSync(f, 'utf8').includes(needle)) {
      out.push(f.slice(root.length + 1));
    }
  }
  return out;
};

/** Both deployed roots — shared/ compiles into the functions bundle. */
const hits = (needle: string): string[] => [
  ...hitsIn(needle, SRC_ROOT).map((f) => `functions/src/${f}`),
  ...hitsIn(needle, SHARED_ROOT).map((f) => `shared/${f}`),
];

const FORBIDDEN_SYMBOLS = [
  'PaperTradingKind.COHORT',
  'PaperCohort',
  'isPaperCohort',
  'buildCohortId',
  'buildCohortDoc',
  'resolveCohortId',
  'getCohort',
  'setCohort',
  'paperTradingItemsPath',
  'itemsPathFor',
  "'paper-trading/cohorts'",
  '"paper-trading/cohorts"',
  '`paper-trading/cohorts`',
];

describe('legacy paper-trading/cohorts retirement (#1661)', () => {
  for (const sym of FORBIDDEN_SYMBOLS) {
    it(`zero references to ${sym}`, () => {
      assert.deepEqual(hits(sym), [], `${sym} still referenced`);
    });
  }

  it('zero cohortId references in order-tickets code', () => {
    const offenders: string[] = [];
    for (const f of tsFiles(join(SRC_ROOT, 'order-tickets'))) {
      const rel = f.slice(SRC_ROOT.length + 1);
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('cohortId')) offenders.push(`${rel}:${i + 1}`);
        });
    }
    const contract = join(SHARED_ROOT, 'st-order-tickets.ts');
    readFileSync(contract, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (line.includes('cohortId')) offenders.push(`shared/st-order-tickets.ts:${i + 1}`);
      });
    assert.deepEqual(offenders, [], `cohortId bridge remains in order-tickets`);
  });
});
