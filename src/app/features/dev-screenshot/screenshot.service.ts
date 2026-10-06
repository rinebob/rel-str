/**
 * Angular wrapper around the captureChartSnapshot callable (Topic #746).
 * Same httpsCallable + runInInjectionContext pattern as PaperTradingService;
 * request/response types come from the shared contract.
 */
import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';
import { CallableName } from '../../core/common/constants';
import type {
  CaptureChartResult,
  CaptureChartSpec,
} from '@screenshot-capture/contracts';

@Injectable({ providedIn: 'root' })
export class ScreenshotService {
  private readonly functions = inject(Functions);
  private readonly env = inject(EnvironmentInjector);

  /**
   * Capture chart screenshots per the spec — returns inline SVG plus
   * storage paths for each artifact (paths are absent when the spec is
   * renderOnly, the default). Callable errors surface with their typed
   * `functions/*` code intact for the caller to map. `defer` keeps a
   * synchronous throw from httpsCallable inside the observable's error
   * channel instead of escaping captureChartSnapshot$ itself.
   */
  captureChartSnapshot$(spec: CaptureChartSpec): Observable<CaptureChartResult> {
    return defer(() => from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<CaptureChartSpec, CaptureChartResult>(
        this.functions,
        CallableName.CAPTURE_CHART_SNAPSHOT,
      );
      return callable(spec);
    }))).pipe(map((res) => res.data));
  }
}
