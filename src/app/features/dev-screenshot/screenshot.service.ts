/**
 * Angular wrapper around the captureChartSnapshot callable (Topic #746).
 * Same httpsCallable + runInInjectionContext pattern as PaperTradingService;
 * request/response types come from the shared contract.
 */
import { inject, Injectable, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, map, Observable } from 'rxjs';
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
   * Capture chart screenshots per the spec — returns inline SVG plus the
   * storage paths for each artifact (svg + png). Callable errors surface
   * with their typed `functions/*` code intact for the caller to map.
   */
  captureChartSnapshot$(spec: CaptureChartSpec): Observable<CaptureChartResult> {
    return from(runInInjectionContext(this.env, () => {
      const callable = httpsCallable<CaptureChartSpec, CaptureChartResult>(
        this.functions,
        CallableName.CAPTURE_CHART_SNAPSHOT,
      );
      return callable(spec);
    })).pipe(map((res) => res.data));
  }
}
