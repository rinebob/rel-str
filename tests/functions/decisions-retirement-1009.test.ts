/**
 * @topic #984 — ST Firestore Reorg (task #1009)
 *
 * review-list + occurrence-decisions retirement coverage (BE side):
 * - Neither collection has any BE reader or writer — the last BE surface
 *   was the two deprecated path constants; both are gone. A source scan
 *   pins the invariant so a future stray reference fails here, not at
 *   audit time.
 * - The TTL sweeper stays: `cleanupStOccurrenceDecisions` remains
 *   exported from index.ts — "TTL keeps draining decisions" until #1013
 *   deletes the emptied collections. Its hardcoded legacy path is the
 *   single whitelisted reference.
 * - Write-stop on the FE side (triage.service, occurrence-decision.store)
 *   and reader/UI removal are #1016/#1017 scope — this suite asserts the
 *   BE half only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as stCollections from '../../functions/src/common/st-collections';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC_ROOT = join(REPO_ROOT, 'functions', 'src');

/** Scan radius = deployed function code — every .ts file under
 *  functions/src — using a plain substring match, so even a comment
 *  carrying a retired literal in a .ts file fails here. Ops scripts
 *  under functions/scripts/ are intentionally outside the radius.
 *  The single whitelisted file is the TTL sweeper — its hardcoded legacy
 *  path is by design. When #1013 deletes the collection + sweeper, this
 *  spec and scripts/verify/data-pipeline-decisions-retirement-1009.ts
 *  (its prod twin — keep them in sync) are deleted with them. */
const WHITELIST_SUFFIXES = ['/scheduled/cleanup-st-occurrence-decisions.ts'];

const RETIRED_PATHS = [
  'savant-trader/data/review-list',
  'savant-trader/data/occurrence-decisions',
] as const;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry).replaceAll('\\', '/');
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

describe('retired collection constants (#1009)', () => {
  it('ST_OCCURRENCE_DECISIONS_COLLECTION is gone', () => {
    assert.ok(
      !('ST_OCCURRENCE_DECISIONS_COLLECTION' in stCollections),
      'deprecated occurrence-decisions constant must be removed — no BE consumer exists',
    );
  });

  it('ST_REVIEW_LIST_COLLECTION is gone', () => {
    assert.ok(
      !('ST_REVIEW_LIST_COLLECTION' in stCollections),
      'deprecated review-list constant must be removed — no BE consumer exists',
    );
  });
});

describe('no BE readers/writers of retired collections', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC_ROOT)) {
    if (WHITELIST_SUFFIXES.some((s) => file.endsWith(s))) continue;
    const text = readFileSync(file, 'utf8');
    for (const path of RETIRED_PATHS) {
      if (text.includes(path)) offenders.push(`${file} → ${path}`);
    }
  }

  it('no functions/src file references a retired path (sweeper whitelisted)', () => {
    assert.deepEqual(offenders, []);
  });
});

describe('TTL drain preserved', () => {
  it('cleanupStOccurrenceDecisions is still exported from index.ts', () => {
    const index = readFileSync(join(SRC_ROOT, 'index.ts'), 'utf8');
    // Anchored — a commented-out export must not satisfy the drain check.
    assert.match(index, /^export \{[^}]*cleanupStOccurrenceDecisions[^}]*\}/m);
  });

  it('the sweeper still targets the legacy occurrence-decisions collection', () => {
    const sweeper = readFileSync(
      join(SRC_ROOT, 'scheduled', 'cleanup-st-occurrence-decisions.ts'),
      'utf8',
    );
    assert.ok(sweeper.includes('savant-trader/data/occurrence-decisions'));
    assert.match(sweeper, /schedule:\s*'30 3 \* \* \*'/);
  });
});
