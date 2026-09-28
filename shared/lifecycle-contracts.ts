/**
 * Lifecycle-viewer shared contracts — the shapes produced by the
 * getLifecycleTree callable and consumed by the dev-lifecycle page
 * (Blueprint #633 / task #637).
 */

export interface LifecycleRepoRequest {
  owner: string;
  repo: string;
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
  updatedAt: string;
  children: LifecycleNode[];
}

export interface LifecycleTopicSection {
  name: string;
  topics: LifecycleNode[];
}

export interface LifecycleTreeResponse {
  sections: LifecycleTopicSection[];
  fetchedAt: string;
  /** Count of nodes whose subIssues pagination was truncated. The callable
   *  throws before returning when this would be nonzero, so a successful
   *  response always carries 0 — the field exists so the verify script can
   *  assert the invariant explicitly. */
  truncatedNodes: number;
  groupingWarning?: string;
}
