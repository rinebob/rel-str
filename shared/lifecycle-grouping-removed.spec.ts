/**
 * Task #1667 grep-pin — the hand-maintained topic-grouping mechanism is
 * deleted end-to-end. Any reintroduction of a group field, the inventory
 * doc fetch, the FE sort modes, or the doc itself fails here.
 *
 * The scan is recursive over every directory the machinery touched —
 * a whitelist would miss exactly the stragglers it exists to catch
 * (a fetchInventoryDoc stub survived in tests/functions/ + functions/
 * scripts/verify/ on the first pass of this task's review).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const SPEC_SELF = 'lifecycle-grouping-removed.spec.ts';

/** Directories swept recursively for banned-symbol references. */
const SCAN_DIRS = [
  'shared',
  'functions/src',
  'functions/scripts',
  'tests/functions',
  'src/app/features/topic-viewer',
  'scripts/verify',
];

const BANNED = [
  'groupOrder',
  'groupingWarning',
  'parseInventoryGroups',
  'assignGroups',
  'foldGroups',
  'UNGROUPED_SECTION',
  'LifecycleInventoryGroup',
  'INVENTORY_PATH',
  'fetchInventoryDoc',
  'sortMode',
  'setSortMode',
  'TopicSortMode',
  'VisibleTopics',
  'TopicSectionVm',
  'topicSections',
  'allTopicsSections',
  'TOPICS-INVENTORY',
  'sort-grouped',
  'grouping-warning',
];

/** Legitimate mentions — negative pins asserting the machinery is gone,
 *  keyed by repo-relative path → symbols allowed in that file. */
const ALLOWED: Record<string, string[]> = {
  // Spec asserts the grouped-sort pill testid no longer renders.
  'src/app/features/topic-viewer/topic-viewer-page.component.spec.ts': ['sort-grouped'],
};

/** Skill docs that described the deleted inventory doc + `list --doc`. */
const DOC_FILES = [
  '.devin/skills/proj/README.md',
  '.devin/skills/proj/skill.md',
  '.devin/skills/proj/proj-list.md',
  '.devin/skills/docs/proj-skill-design.md',
];

const DOC_BANNED = ['TOPICS-INVENTORY', 'list --doc'];

function* tsFiles(dir: string): Generator<string> {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* tsFiles(p);
    else if (e.name.endsWith('.ts') && e.name !== SPEC_SELF) yield p;
  }
}

describe('topic grouping excision (#1667)', () => {
  const files = [...SCAN_DIRS].flatMap(d => [...tsFiles(d)]);
  // Guard: a renamed/moved scan dir must not silently shrink the sweep.
  it.each(SCAN_DIRS)('scan dir %s exists', d => {
    expect(existsSync(join(ROOT, d))).toBe(true);
  });

  for (const file of files) {
    const rel = relative(ROOT, join(ROOT, file)).split(sep).join('/');
    const src = readFileSync(join(ROOT, file), 'utf8');
    const allowed = new Set(ALLOWED[rel] ?? []);
    const banned = BANNED.filter(s => !allowed.has(s));
    it.each(banned)(`${rel} — no reference to %s`, symbol => {
      expect(src).not.toMatch(new RegExp(`\\b${symbol}\\b`));
    });
    it(`${rel} — LifecycleTopic interface is gone`, () => {
      // \bLifecycleTopic\b — word boundary keeps LifecycleTopicTreeRequest legal.
      expect(src).not.toMatch(/\bLifecycleTopic\b/);
    });
  }

  for (const doc of DOC_FILES) {
    const src = readFileSync(join(ROOT, doc), 'utf8');
    it.each(DOC_BANNED)(`${doc} — no reference to %s`, literal => {
      expect(src).not.toContain(literal);
    });
  }

  it('docs/dev-notes/TOPICS-INVENTORY.md is deleted', () => {
    expect(existsSync(join(ROOT, 'docs/dev-notes/TOPICS-INVENTORY.md'))).toBe(false);
  });
});
