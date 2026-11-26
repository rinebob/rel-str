/**
 * Lifecycle-tree transforms — pure functions that turn fetched issue rows
 * into a topic-rooted lifecycle tree. No I/O; shared by the
 * getLifecycleTree callable and the topic-viewer page
 * (Blueprint #633 / task #637, contract v2 #1522).
 */

import type {
  LifecycleNode,
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

/** Topic roots are issues whose title starts with `Topic:` (case-insensitive).
 *  One rule for both consumers: the BE root filter (#1527) and the retrofit
 *  script's anchor enumeration — `Thread:`/`INVENTORY:`/`Idea:` titles that
 *  merely contain "Topic" must not pass. */
export function isTopicRoot(title: string): boolean {
  return /^topic:/i.test(title.trim());
}

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

/** Stage ordinal for display ('5_IMPLEMENT' → '5'); '' for non-stage labels. */
export function stageOrdinal(stageLabel: string | undefined): string {
  return /^(\d+)_/.exec(stageLabel ?? '')?.[1] ?? '';
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


