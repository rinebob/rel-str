/**
 * Lifecycle-tree transforms — pure functions that turn fetched issue rows
 * into a topic-rooted lifecycle tree and order topics into inventory
 * sections. No I/O; shared by the getLifecycleTree callable and the
 * dev-lifecycle page (Blueprint #633 / task #637).
 */

import type {
  LifecycleNode,
  LifecycleTopicSection,
} from './lifecycle-contracts';

/** Closed stage-label vocabulary — repo-local copy because shared/ must not
 *  depend on project-config.json. Ordinal order matters: when an issue
 *  carries two stage labels (mid-transition leftovers exist in the repo),
 *  the highest ordinal wins and the stale one is dropped. */
const STAGE_LABELS = [
  '1_IDEA', '2_PLAN', '3_BLUEPRINT', '4_BACKLOG',
  '5_IMPLEMENT', '6_REVIEW', '7_QA', '8_LIVE',
] as const;

/** Title vocabulary for stage issues — deliberately not the stage-label
 *  vocabulary: `ship:` titles exist but there is no SHIP label, and
 *  `backlog:`-style titles are tasks, not stage issues. */
const STAGE_TITLE_PATTERN = /^(idea|plan|blueprint|implement|review|qa|ship):/i;
const BLUEPRINT_TITLE_PATTERN = /^[a-z-]+ blueprint:/i;
const THREAD_TITLE_PATTERN = /^thread:/i;

export const UNGROUPED_SECTION = 'Ungrouped';

/** Raw issue row shape the fetch shell produces (GitHub casing). */
export interface LifecycleRawIssue {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  labels: string[];
  /** ISO-8601 UTC (GitHub's format) — compared lexically for max propagation. */
  updatedAt: string;
}

export interface LifecycleInventoryGroup {
  name: string;
  topicNumbers: number[];
}

/** Split a label list into the stage label (if any) and remaining tags. */
export function decodeLabels(labels: string[]): {
  stageLabel?: string;
  tags: string[];
} {
  const stage = (l: string) => (STAGE_LABELS as readonly string[]).indexOf(l);
  const stageLabel = labels
    .filter(l => stage(l) >= 0)
    .sort((a, b) => stage(b) - stage(a))[0];
  return { stageLabel, tags: labels.filter(l => stage(l) < 0) };
}

/** Infer the lifecycle node type from title + depth in the tree. */
export function nodeTypeFor(
  title: string,
  depth: number,
): LifecycleNode['nodeType'] {
  if (depth === 0) return 'topic';
  if (THREAD_TITLE_PATTERN.test(title)) return 'thread';
  if (STAGE_TITLE_PATTERN.test(title) || BLUEPRINT_TITLE_PATTERN.test(title)) {
    return 'stage';
  }
  return 'task';
}

/**
 * Assemble topic-rooted trees from fetched rows. `childrenOf` and
 * `statusOf` are keyed by issue number. A node reached under two parents
 * is expanded only at its first occurrence; the same applies to a root
 * that is also a child of an earlier root (it is not re-emitted). The
 * direction is caller-order dependent — the BE should pass roots in a
 * stable order. Each node's `updatedAt` is the max of its subtree.
 */
export function buildTree(
  roots: LifecycleRawIssue[],
  childrenOf: Map<number, LifecycleRawIssue[]>,
  statusOf: Map<number, string>,
): LifecycleNode[] {
    const expanded = new Set<number>();
  /** Emitted subtree-max updatedAt per node — lets a deduped child still
   *  propagate its full subtree's max (not just its own timestamp). */
  const emittedUpdatedAt = new Map<number, string>();

  const toNode = (raw: LifecycleRawIssue, depth: number): LifecycleNode => {
    const { stageLabel, tags } = decodeLabels(raw.labels);
    const children: LifecycleNode[] = [];
    let updatedAt = raw.updatedAt;
    expanded.add(raw.number);
    for (const child of childrenOf.get(raw.number) ?? []) {
      // A deduped child still counts toward this node's max updatedAt —
      // the subissue relationship is real even if the node renders
      // elsewhere. Use its emitted subtree-max when available (absent for
      // an ancestor still mid-expansion on a cycle).
      if (expanded.has(child.number)) {
        const t = emittedUpdatedAt.get(child.number) ?? child.updatedAt;
        if (t > updatedAt) updatedAt = t;
        continue;
      }
      const node = toNode(child, depth + 1);
      children.push(node);
      if (node.updatedAt > updatedAt) updatedAt = node.updatedAt;
    }
    const status = statusOf.get(raw.number);
    const node: LifecycleNode = {
      number: raw.number,
      title: raw.title,
      // GitHub issues only have OPEN/CLOSED; anything unexpected maps to 'open'.
      state: raw.state.toLowerCase() === 'closed' ? 'closed' : 'open',
      url: raw.url,
      nodeType: nodeTypeFor(raw.title, depth),
      ...(stageLabel ? { stageLabel } : {}),
      ...(status ? { status } : {}),
      labels: tags,
      updatedAt,
      children,
    };
    emittedUpdatedAt.set(raw.number, node.updatedAt);
    return node;
  };

  const out: LifecycleNode[] = [];
  for (const r of roots) {
    if (expanded.has(r.number)) continue;
    out.push(toNode(r, 0));
  }
  return out;
}

const OPEN_SECTION = /^##\s+Open Topics\s*$/im;
const HEADING = /^##\s+/m;
const GROUP = /^###\s+(.+?)\s*$/;
/** Top-level list row carrying a topic link: `- **[#N - title](url)**`. */
const TOPIC_ROW = /^-\s+\*\*\[#(\d+)(?:\s*[-—–][^\]]*)?\]/;

/**
 * Parse the TOPICS-INVENTORY.md "Open Topics" section into ordered groups.
 * Returns null when the section or its groups are absent. A topic listed
 * under two groups belongs to the first.
 */
export function parseInventoryGroups(
  markdown: string,
): LifecycleInventoryGroup[] | null {
  const open = OPEN_SECTION.exec(markdown);
  if (!open) return null;
  const rest = markdown.slice(open.index + open[0].length);
  const nextHeading = HEADING.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;

  const groups: LifecycleInventoryGroup[] = [];
  const seenTopics = new Set<number>();
  let current: LifecycleInventoryGroup | null = null;
  for (const line of section.split('\n')) {
    const g = GROUP.exec(line);
    if (g) {
      current = { name: g[1], topicNumbers: [] };
      groups.push(current);
      continue;
    }
    const t = TOPIC_ROW.exec(line);
    if (current && t) {
      const n = Number(t[1]);
      if (!seenTopics.has(n)) {
        seenTopics.add(n);
        current.topicNumbers.push(n);
      }
    }
  }
  return groups.length > 0 ? groups : null;
}

/**
 * Order topic trees into named sections. With groups: doc order, then an
 * Ungrouped section for leftovers; stale refs (grouped numbers with no
 * matching topic) are dropped. Without groups: one section sorted by
 * updatedAt desc.
 */
export function orderTopics(
  topics: LifecycleNode[],
  groups: LifecycleInventoryGroup[] | null,
): LifecycleTopicSection[] {
  const byNumber = new Map(topics.map(t => [t.number, t]));
  // Same code-unit ordering as buildTree's max propagation — never diverges.
  const byUpdatedDesc = (a: LifecycleNode, b: LifecycleNode) =>
    b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0;

  if (!groups || groups.length === 0) {
    return [{ name: UNGROUPED_SECTION, topics: [...topics].sort(byUpdatedDesc) }];
  }

  const grouped = new Set<number>();
  const sections: LifecycleTopicSection[] = groups
    .map(g => ({
      name: g.name,
      topics: g.topicNumbers
        .filter(n => byNumber.has(n) && !grouped.has(n))
        .map(n => {
          grouped.add(n);
          return byNumber.get(n)!;
        }),
    }))
    .filter(s => s.topics.length > 0);

  const ungrouped = topics.filter(t => !grouped.has(t.number));
  if (ungrouped.length > 0) {
    sections.push({ name: UNGROUPED_SECTION, topics: ungrouped.sort(byUpdatedDesc) });
  }
  // Empty repo (zero topic roots): keep the single-section guarantee the
  // null-groups branch provides — callers treat sections[] as the render set.
  if (sections.length === 0) return [{ name: UNGROUPED_SECTION, topics: [] }];
  return sections;
}
