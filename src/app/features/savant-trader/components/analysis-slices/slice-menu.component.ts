/**
 * SliceMenuComponent (#1085) — dropdown listing saved analysis slices.
 * Clicking a slice applies it to the open dataset (predicates on absent
 * columns are skipped by the store, with a snackbar notice); the per-item
 * delete is separate so removal never fires an apply. `canApply=false`
 * renders a manage-only list (names + delete) for the library where no
 * dataset is open.
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { AnalysisSlice } from '@paper-trading/analysis';

@Component({
  selector: 'app-slice-menu',
  standalone: true,
  imports: [MatIconModule, MatMenuModule],
  template: `
    <button type="button" class="slice-btn" [matMenuTriggerFor]="menu"
            aria-label="Saved slices" title="Saved slices">
      <mat-icon>bookmark</mat-icon>
      Slices
      @if (slices().length > 0) { ({{ slices().length }}) }
    </button>
    <mat-menu #menu="matMenu" class="slice-menu">
      @if (slices().length === 0) {
        <div class="slice-empty">No saved slices.</div>
      }
      @for (s of slices(); track s.id) {
        <div class="slice-item">
          @if (canApply()) {
            <!-- mat-menu-item → apply dismisses the menu + joins roving
                 focus; delete stays a plain button so multi-delete keeps
                 the menu open (no nested-overlay controls — #1152). -->
            <button type="button" mat-menu-item class="slice-apply"
                    (click)="applied.emit(s)" title="Apply to open dataset">
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
    </mat-menu>
  `,
  styles: `
    :host { display: inline-flex; }
    .slice-btn {
      border: none; background: none; cursor: pointer;
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.82rem; opacity: 0.8; padding: 4px 8px;
    }
    .slice-btn:hover { opacity: 1; }
    .slice-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .slice-empty { padding: 10px 16px; font-size: 0.8rem; opacity: 0.6; }
    .slice-item {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 16px; font-size: 0.82rem;
    }
    .slice-apply {
      border: none; background: none; cursor: pointer;
      color: var(--mat-sys-primary, #2196f3);
      font-size: 0.82rem; padding: 2px 0; text-align: left;
    }
    .slice-apply:hover { text-decoration: underline; }
    .filter-count { opacity: 0.6; }
    .slice-note {
      font-size: 0.75rem; opacity: 0.55; flex: 1;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 160px;
    }
    .slice-delete {
      margin-left: auto; border: none; background: none; cursor: pointer;
      opacity: 0.5; display: inline-flex; padding: 2px;
    }
    .slice-delete:hover { opacity: 1; }
    .slice-delete mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SliceMenuComponent {
  slices = input.required<AnalysisSlice[]>();
  /** false → manage-only list (library: no dataset to filter). */
  canApply = input(true);

  applied = output<AnalysisSlice>();
  deleted = output<string>();
}
