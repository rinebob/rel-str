/**
 * TopicViewerService — thin callable wrapper for the topic-viewer page
 * (Topic #619 / Blueprint #635 / task #642). Same httpsCallable +
 * runInInjectionContext pattern as PaperTradingService.
 */

import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable } from 'rxjs';
import { CallableName } from '../../core/common/constants';
import type {
  LifecycleRepoRequest,
  LifecycleTopicTreeRequest,
  LifecycleTreeResponse,
} from '@lifecycle/contracts';
import type {
  ListRepoLabelsRequest,
  ListRepoLabelsResponse,
  ManageRepoLabelRequest,
  ManageRepoLabelResponse,
  UpdateIssueLabelsRequest,
  UpdateIssueLabelsResponse,
} from '@lifecycle/labels';

/** Repos the BE will accept (SUPPORTED_REPOS in functions gh-lifecycle
 *  config is authoritative — keep this mirror in sync). */
export interface TopicViewerRepo {
  owner: string;
  repo: string;
  label: string;
}

export const TOPIC_VIEWER_REPOS: TopicViewerRepo[] = [
  { owner: 'rinebob', repo: 'rel-str', label: 'rel-str' },
  { owner: 'rinebob', repo: 'av-proxy-api', label: 'av-proxy-api' },
];

@Injectable({ providedIn: 'root' })
export class TopicViewerService {
  private readonly functions = inject(Functions);
  private readonly env = inject(EnvironmentInjector);

  /** Monolith fetch — retained deliberately as the rollback surface:
   *  the deployed getLifecycleTree callable still backs the pre-lazy
   *  render path. No production consumer since #1637. */
  getLifecycleTree$(
    request: LifecycleRepoRequest,
  ): Observable<LifecycleTreeResponse> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<LifecycleRepoRequest, LifecycleTreeResponse>(
        this.functions, CallableName.GET_LIFECYCLE_TREE,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /** Slim roots-only index (#1635) — the page's left-pane + filter source;
   *  roots arrive with `children: []` (subtrees fetched per-topic). */
  getLifecycleTopicIndex$(
    request: LifecycleRepoRequest,
  ): Observable<LifecycleTreeResponse> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<LifecycleRepoRequest, LifecycleTreeResponse>(
        this.functions, CallableName.GET_LIFECYCLE_TOPIC_INDEX,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /** One topic's populated subtree (#1636) — memoized by the store. */
  getLifecycleTopicTree$(
    request: LifecycleTopicTreeRequest,
  ): Observable<LifecycleTreeResponse> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<LifecycleTopicTreeRequest, LifecycleTreeResponse>(
        this.functions, CallableName.GET_LIFECYCLE_TOPIC_TREE,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /** Paged repo-label read (#1528) — picker/datalist source for the label surfaces. */
  listRepoLabels$(
    request: ListRepoLabelsRequest,
  ): Observable<ListRepoLabelsResponse> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<ListRepoLabelsRequest, ListRepoLabelsResponse>(
        this.functions, CallableName.LIST_REPO_LABELS,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /** Issue label attach/detach (#1529) — mint-on-add handled server-side. */
  updateIssueLabels$(
    request: UpdateIssueLabelsRequest,
  ): Observable<UpdateIssueLabelsResponse> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<UpdateIssueLabelsRequest, UpdateIssueLabelsResponse>(
        this.functions, CallableName.UPDATE_ISSUE_LABELS,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }

  /** Repo label create/update/delete (#1529) — delete returns a usage count. */
  manageRepoLabel$(
    request: ManageRepoLabelRequest,
  ): Observable<ManageRepoLabelResponse> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<ManageRepoLabelRequest, ManageRepoLabelResponse>(
        this.functions, CallableName.MANAGE_REPO_LABEL,
      );
      return callable(request);
    })).pipe(map((res) => res.data));
  }
}
