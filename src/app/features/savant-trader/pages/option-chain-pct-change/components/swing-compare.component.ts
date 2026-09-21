/**
 * SwingCompareComponent — the results-side swing-compare section.
 *
 * Set picking and the run builder live in the frame-swing dialog
 * (opened via "Pick frame swing" in the left panel). This section shows
 * a hint until a frame swing is chosen, then the run list rendering
 * RunSection per saved run.
 *
 * All durable state lives in OptionChainPctChangeStore.
 */
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { RunSectionComponent } from './run-section.component';

@Component({
  selector: 'app-swing-compare',
  standalone: true,
  imports: [RunSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="swing-compare" data-testid="swing-compare">
      <h3 class="section-title">Swing compare</h3>

      @if (!store.frameSwing() && store.savedAnalyses().length > 0) {
        <p class="empty-state" data-testid="swing-compare-hint">
          Click "Pick frame swing" in the left panel to build runs.
        </p>
      }

      <div class="run-list">
        @for (run of store.runs(); track run.id; let i = $index) {
          <app-run-section
            [run]="run"
            [index]="i"
            (removed)="store.removeRun($event)"
          />
        }
      </div>
    </section>
  `,
  styles: [
    `
      .swing-compare {
        display: flex; flex-direction: column; gap: 10px;
      }
      .section-title { margin: 0; font-size: 1rem; font-weight: 600; }
      .empty-state { margin: 0; font-size: 0.85rem; color: #666; }
      .run-list { display: flex; flex-direction: column; gap: 6px; }
    `,
  ],
})
export class SwingCompareComponent {
  readonly store = inject(OptionChainPctChangeStore);
}
