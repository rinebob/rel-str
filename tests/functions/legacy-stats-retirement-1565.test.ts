/**
 * @topic #984 — ST Firestore Reorg (task #1565)
 *
 * Legacy stats writers + read-path retirement pin — asserts the deleted
 * legacy stats surface has ZERO references left in deployed code
 * (functions/src):
 *
 * - `runStatsPass` / `createDefaultStatsPassDeps` — the per-instance
 *   legacy stats pass (paper-stats-pass is now THE writer).
 * - `incrementStatsOnOpen` — the pre-ledger increment seam (deleted in
 *   #1563; pinned here so it can't come back).
 * - `handleGetStrategyEquityCurve` / `getStrategyEquityCurve` +
 *   `GetStrategyEquityCurveRequest` / `StrategyEquityCurveResponse` —
 *   the legacy dashboard callable the FE migrated off in #1564.
 * - `defaultReadStatsDoc` / `paperStatsToLegacy` — read-side legacy
 *   adapters (the write-side adapter legacyToPaperStats stays).
 * - `getStats` / `getEquityCurve` — the engine dep seams whose only
 *   caller was the deleted callable. NOTE: the canonical
 *   `getStats(db, statsId)` in paper-trading/repository.ts is a
 *   different function — pinned by the engine export form, not the
 *   bare name.
 * - `'ALL'` scope literals — the legacy combined scope; canonical is
 *   `all` (built by statsScopeAll). Scanned per-line inside
 *   functions/src/paper-trading so `stopType:'ALL'` (a different
 *   domain) doesn't false-positive.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC_ROOT = join(REPO_ROOT, 'functions', 'src');
const PT_ROOT = join(SRC_ROOT, 'paper-trading');

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (entry.endsWith('.ts')) yield p;
  }
}

const hits = (needle: string, root = SRC_ROOT): string[] => {
  const out: string[] = [];
  for (const f of tsFiles(root)) {
    if (readFileSync(f, 'utf8').includes(needle)) {
      out.push(f.slice(root.length + 1));
    }
  }
  return out;
};

const DELETED_FILES = [
  'paper-trading/engine/passes/stats-pass.ts',
  'options-strategy-engine/passes/stats-pass.ts',
];

const FORBIDDEN_SYMBOLS = [
  'runStatsPass',
  'createDefaultStatsPassDeps',
  'incrementStatsOnOpen',
  'handleGetStrategyEquityCurve',
  'getStrategyEquityCurve',
  'GetStrategyEquityCurveRequest',
  'StrategyEquityCurveResponse',
  'defaultReadStatsDoc',
  'paperStatsToLegacy',
];

describe('legacy stats writers + read-path retirement (#1565)', () => {
  for (const rel of DELETED_FILES) {
    it(`file deleted: ${rel}`, () => {
      assert.equal(existsSync(join(SRC_ROOT, rel)), false, `${rel} still exists`);
    });
  }

  for (const sym of FORBIDDEN_SYMBOLS) {
    it(`zero references to ${sym}`, () => {
      assert.deepEqual(hits(sym), [], `${sym} still referenced`);
    });
  }

  it('zero engine dep-seam exports (getStats/getEquityCurve)', () => {
    const engineRepo = join(PT_ROOT, 'engine', 'stats-repository.ts');
    if (existsSync(engineRepo)) {
      const src = readFileSync(engineRepo, 'utf8');
      assert.ok(!src.includes('export async function getStats'), 'engine getStats seam still exported');
      assert.ok(!src.includes('export async function getEquityCurve'), 'engine getEquityCurve seam still exported');
    }
  });

  // Radius: paper-trading only — 'ALL' is a legitimate literal in other
  // domains (heatmap, registry, stopType), so widening the scan would
  // pin foreign code; a regression under functions/src elsewhere escapes.
  // The stopType exemption exists for manage-exit-scan-pass.ts:12's
  // `stopType:'ALL'` doc comment — the only in-radius 'ALL' today.
  it("zero 'ALL' scope literals in the paper-trading stats path", () => {
    const offenders: string[] = [];
    for (const f of tsFiles(PT_ROOT)) {
      const rel = f.slice(PT_ROOT.length + 1);
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes("'ALL'") && !line.includes('stopType')) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    assert.deepEqual(offenders, [], `'ALL' scope literals remain`);
  });

  // `stats-ALL` — the legacy doc-id literal. Nothing in deployed code
  // may name the doc — functions/src AND shared/ (which compiles into
  // the deployed bundle); the #1566 cleanup script lives under
  // functions/scripts, outside this scan's radius.
  it("zero 'stats-ALL' doc-id literals", () => {
    const sharedHits = hits('stats-ALL', join(REPO_ROOT, 'shared'))
      .filter((f) => !f.endsWith('.spec.ts'));
    assert.deepEqual(
      [...hits('stats-ALL'), ...sharedHits],
      [],
      `'stats-ALL' literals remain`,
    );
  });
});
