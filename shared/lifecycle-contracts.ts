/**
 * Lifecycle-viewer shared contracts — the shapes produced by the
 * getLifecycleTree callable and consumed by the topic-viewer page
 * (Blueprint #633 / task #637, contract v2 in #1522).
 */

export interface LifecycleRepoRequest {
  owner: string;
  repo: string;
}

/** getLifecycleTopicTree input — one topic root's subtree by number. */
export interface LifecycleTopicTreeRequest extends LifecycleRepoRequest {
  topicNumber: number;
}

export interface LifecycleNode {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  nodeType: 'topic' | 'thread' | 'stage' | 'task';
  stageLabel?: string;
  status?: string;
  labels: string[];
  /** Max updatedAt over the node's subtree when children were fetched;
   *  on the roots-only index response (getLifecycleTopicIndex — every
   *  `children` is []), it's just the issue's own updatedAt — subtree
   *  activity is invisible at index granularity by design. */
  updatedAt: string;
  children: LifecycleNode[];
}

export interface LifecycleTreeResponse {
  /** Flat root list — ordering/filtering is a view concern (#1667:
   *  hand-maintained topic grouping removed; future grouping derives
   *  from issue metadata, not a repo doc). */
  topics: LifecycleNode[];
  fetchedAt: string;
  /** issueNumber → rootTopicNumber for every issue the maintained map
   *  knows (seeded once, refreshed by every tree fetch). Emitted on the
   *  getLifecycleTopicIndex response only; absent when the map doc is
   *  missing/unreadable — the FE falls back to resolveLifecycleIssue. */
  issueMap?: Record<number, number>;
}

/** resolveLifecycleIssue input — any issue number in the repo. */
export interface LifecycleResolveIssueRequest extends LifecycleRepoRequest {
  issueNumber: number;
}

export interface LifecycleResolvedIssueMeta {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  labels: string[];
}

export interface LifecycleResolveIssueResponse {
  /** The looked-up issue — always present on success. */
  issue: LifecycleResolvedIssueMeta;
  /** Chain of issue numbers from the Topic root down to and including
   *  this issue — present only when it lives under a `Topic:` root.
   *  `path[0]` is the root topic number. Absent for standalone issues. */
  path?: number[];
}
