/**
 * SliceMenuComponent (#1085) — dropdown listing saved analysis slices.
 * Clicking a slice applies it to the open dataset (predicates on absent
 * columns are skipped by the store, with a snackbar notice); the per-item
 * delete is separate so removal never fires an apply. `canApply=false`
 * renders a manage-only list (names + delete) for the library where no
 * dataset is open.
 *
 * #1348 pilot — mat-menu → ds-menu: a signal-driven dropdown on the
 * ds-menu chrome (position consumer-side; document click dismisses).
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { AnalysisSlice } from '@paper-trading/analysis';

@Component({
  selector: 'app-slice-menu',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <span class="menu-anchor">
      <button type="button" class="slice-btn" (click)="toggle($event)"
              aria-haspopup="menu" [attr.aria-expanded]="open()"
              aria-label="Saved slices" title="Saved slices">
        <mat-icon>bookmark</mat-icon>
        Slices
        @if (slices().length > 0) { ({{ slices().length }}) }
      </button>
      @if (open()) {
        <div class="dse-menu slice-menu" role="menu" (click)="$event.stopPropagation()">
          @if (slices().length === 0) {
            <div class="slice-empty">No saved slices.</div>
          }
          @for (s of slices(); track s.id) {
            <div class="slice-item">
              @if (canApply()) {
                <!-- apply dismisses the menu; delete stays a plain button
                     so multi-delete keeps the menu open (#1152). -->
                <button type="button" class="menu-item slice-apply" role="menuitem"
                        (click)="applied.emit(s); open.set(false)"
                        title="Apply to open dataset">
                  <span class="slice-name">{{ s.name }}</span>
                  <span class="filter-count">({{ s.filters.length }})</span>
                </button>
              } @else {
                <span class="slice-name">{{ s.name }}
                  <span class="filter-count">({{ s.filters.length }})</span>
                </span>
              }
              @if (s.note) { <span class="slice-note">{{ s.note }}</span> }
              <button type="button" class="slice-delete"
                      (click)="$event.stopPropagation(); deleted.emit(s.id)"
                      [attr.aria-label]="'Delete slice ' + s.name" title="Delete slice">
                <mat-icon>delete_outline</mat-icon>
              </button>
            </div>
          }
        </div>
      }
    </span>
  `,
  styleUrl: './slice-menu.component.scss',
  host: {
    '(document:click)': 'open.set(false)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SliceMenuComponent {
  slices = input.required<AnalysisSlice[]>();
  /** false → manage-only list (library: no dataset to filter). */
  canApply = input(true);

  applied = output<AnalysisSlice>();
  deleted = output<string>();

  protected readonly open = signal(false);

  protected toggle(ev: Event): void {
    ev.stopPropagation();
    this.open.update((v) => !v);
  }
}
