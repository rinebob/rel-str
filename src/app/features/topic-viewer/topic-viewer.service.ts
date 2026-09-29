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
  LifecycleTreeResponse,
} from '@lifecycle/contracts';

/** Repos the BE will accept (SUPPORTED_REPOS in functions gh-lifecycle
 *  config is authoritative — keep this mirror in sync). */
export interface TopicViewerRepo {
  owner: string;
  repo: string;
  label: string;
}

export const TOPIC_VIEWER_REPOS: TopicViewerRepo[] = [
  { owner: 'rinebob', repo: 'rel-str', label: 'rel-str' },
];

@Injectable({ providedIn: 'root' })
export class TopicViewerService {
  private readonly functions = inject(Functions);
  private readonly env = inject(EnvironmentInjector);

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
}
