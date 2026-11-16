/**
 * Lifecycle-viewer shared contracts — the shapes produced by the
 * getLifecycleTree callable and consumed by the topic-viewer page
 * (Blueprint #633 / task #637, contract v2 in #1522).
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

/** A topic root stamped with its TOPICS-INVENTORY group (or
 *  UNGROUPED_SECTION). Children never carry `group`. */
export interface LifecycleTopic extends LifecycleNode {
  group: string;
}

export interface LifecycleTreeResponse {
  /** Flat root list — grouping/sorting is a view concern. */
  topics: LifecycleTopic[];
  /** TOPICS-INVENTORY section names in doc order (Ungrouped appended when
   *  ungrouped roots exist); empty when the inventory doc is absent. */
  groupOrder: string[];
  fetchedAt: string;
  /** Present only when the inventory doc degraded: non-404 fetch
   *  failure, parse-null, or listing none of the fetched topics. */
  groupingWarning?: string;
}
