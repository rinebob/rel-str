/**
 * LifecycleStore — NgRx SignalStore for the dev-lifecycle page
 * (Topic #619 / Blueprint #635 / task #642).
 *
 * Owns the fetched LifecycleTreeResponse and maps it to the view models
 * the page renders — grouped topic list (left pane) + flattened visible
 * tree of the selected topic (right pane). Read-only; zero write paths.
 */

import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type {
  LifecycleNode,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import {
  DEV_LIFECYCLE_REPOS,
  DevLifecycleService,
  type DevLifecycleRepo,
} from './dev-lifecycle.service';

export interface TopicRow {
  number: number;
  title: string;
  stageLabel?: string;
  status?: string;
  closed: boolean;
}

export interface TopicSectionVm {
  name: string;
  topics: TopicRow[];
}

export interface TreeRow {
  node: LifecycleNode;
  depth: number;
}

interface LifecycleState {
  repos: DevLifecycleRepo[];
  selectedRepoIndex: number;
  response: LifecycleTreeResponse | null;
  selectedTopicNumber: number | null;
  expandedIds: number[];
  showClosed: boolean;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  /** Monotonic fetch token — late-arriving responses for a switched-away
   *  repo are discarded (stale-response guard). */
  fetchSeq: number;
}

const initialState: LifecycleState = {
  repos: DEV_LIFECYCLE_REPOS,
  selectedRepoIndex: 0,
  response: null,
  selectedTopicNumber: null,
  expandedIds: [],
  showClosed: false,
  loading: false,
  error: null,
  fetchedAt: null,
  fetchSeq: 0,
};

function errMessage(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return code ? `${code}: ${msg}` : msg;
}

function toRow(n: LifecycleNode): TopicRow {
  return {
    number: n.number,
    title: n.title,
    stageLabel: n.stageLabel,
    status: n.status,
    closed: n.state === 'closed',
  };
}

export const LifecycleStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((store) => ({
    /** Grouped topic list — response order preserved (BE already applied
     *  TOPICS-INVENTORY grouping); closed topics hidden unless showClosed;
     *  emptied sections dropped. */
    topicSections: computed<TopicSectionVm[]>(() => {
      const res = store.response();
      if (!res) return [];
      const showClosed = store.showClosed();
      return res.sections
        .map(s => ({
          name: s.name,
          topics: s.topics.filter(t => showClosed || t.state === 'open').map(toRow),
        }))
        .filter(s => s.topics.length > 0);
    }),

    selectedRepo: computed(() => store.repos()[store.selectedRepoIndex()] ?? null),

    /** BE-side degrade notice (inventory doc failed non-404 / parsed
     *  empty) — surfaced by the page so flat sections aren't silent. */
    groupingWarning: computed(() => store.response()?.groupingWarning ?? null),

    /** The selected topic's node — looked up in the live response. */
    selectedTopic: computed<LifecycleNode | null>(() => {
      const num = store.selectedTopicNumber();
      const res = store.response();
      if (num === null || !res) return null;
      for (const s of res.sections) {
        const hit = s.topics.find(t => t.number === num);
        if (hit) return hit;
      }
      return null;
    }),
  })),

  // Second block — these computeds consume first-block computeds.
  withComputed((store) => ({
    /** Flattened visible rows of the selected topic — a node emits its
     *  children only when its number is in expandedIds. Closed nodes
     *  filtered unless showClosed. */
    treeRows: computed<TreeRow[]>(() => {
      const topic = store.selectedTopic();
      if (!topic) return [];
      const expanded = new Set(store.expandedIds());
      const showClosed = store.showClosed();
      const rows: TreeRow[] = [{ node: topic, depth: 0 }];
      if (!expanded.has(topic.number)) return rows; // root collapsed → caret can re-expand
      const walk = (nodes: LifecycleNode[], depth: number) => {
        for (const n of nodes) {
          if (!showClosed && n.state === 'closed') continue;
          rows.push({ node: n, depth });
          if (expanded.has(n.number) && n.children.length) {
            walk(n.children, depth + 1);
          }
        }
      };
      walk(topic.children, 1);
      return rows;
    }),

    /** Node ids that are expandable (have *visible* children) — expandAll
     *  target. A node whose children are all closed isn't expandable when
     *  showClosed is off, same rule the tree caret applies. */
    expandableIds: computed<number[]>(() => {
      const topic = store.selectedTopic();
      if (!topic) return [];
      const showClosed = store.showClosed();
      const visible = (n: LifecycleNode) =>
        n.children.filter(c => showClosed || c.state === 'open');
      const ids: number[] = [];
      const walk = (n: LifecycleNode) => {
        if (visible(n).length) {
          ids.push(n.number);
          visible(n).forEach(walk);
        }
      };
      walk(topic);
      return ids;
    }),
  })),

  withMethods((store) => {
    const service = inject(DevLifecycleService);

    async function fetch(): Promise<void> {
      const repo = store.selectedRepo();
      if (!repo) return;
      const seq = store.fetchSeq() + 1;
      patchState(store, { fetchSeq: seq, loading: true, error: null });
      try {
        const response = await firstValueFrom(
          service.getLifecycleTree$({ owner: repo.owner, repo: repo.repo }));
        if (store.fetchSeq() !== seq) return; // stale — a newer fetch owns the slot
        patchState(store, {
          response,
          loading: false,
          fetchedAt: response.fetchedAt,
          // keep selection + expansion only if the node still exists
          ...(store.selectedTopicNumber() !== null
            && response.sections.every(s => !s.topics.some(t => t.number === store.selectedTopicNumber()))
            ? { selectedTopicNumber: null, expandedIds: [] }
            : {}),
        });
      } catch (err) {
        if (store.fetchSeq() !== seq) return;
        patchState(store, {
          loading: false,
          error: errMessage(err), // previous response kept — tree stays up under the banner
        });
      }
    }

    return {
      async selectRepo(index: number): Promise<void> {
        if (!store.repos()[index]) return; // dropdown can't emit this; guards programmatic calls
        if (index === store.selectedRepoIndex()) return;
        patchState(store, {
          selectedRepoIndex: index,
          response: null,
          selectedTopicNumber: null,
          expandedIds: [],
          error: null,
          fetchedAt: null,
        });
        await fetch();
      },

      selectTopic(number: number): void {
        // Seed the root expanded — depth-1 rows (threads) visible by default.
        patchState(store, {
          selectedTopicNumber: number,
          expandedIds: [number],
        });
      },

      async refresh(): Promise<void> {
        await fetch();
      },

      toggleExpanded(number: number): void {
        const ids = new Set(store.expandedIds());
        if (ids.has(number)) ids.delete(number); else ids.add(number);
        patchState(store, { expandedIds: [...ids] });
      },

      expandAll(): void {
        patchState(store, { expandedIds: [...store.expandableIds()] });
      },

      collapseAll(): void {
        patchState(store, { expandedIds: [] });
      },

      toggleShowClosed(): void {
        patchState(store, { showClosed: !store.showClosed() });
      },

      /** Direct setter — the checkbox binds $event.checked so state can't
       *  desync if showClosed is ever set elsewhere. */
      setShowClosed(v: boolean): void {
        patchState(store, { showClosed: v });
      },
    };
  }),
);
