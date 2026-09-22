/**
 * SwingCompareComponent — the results-side swing-compare section.
 *
 * Set picking and the run builder live in the frame-swing dialog
 * (opened via "Pick frame swing" in the left panel). This section is
 * just the run list rendering RunSection per saved run — the "Swing
 * compare" title lives at the top of the left sidebar.
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
      .run-list { display: flex; flex-direction: column; gap: 14px; }
    `,
  ],
})
export class SwingCompareComponent {
  readonly store = inject(OptionChainPctChangeStore);
}
