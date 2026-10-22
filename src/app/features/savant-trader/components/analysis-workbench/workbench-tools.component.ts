/**
 * WorkbenchToolsComponent (#1085) — the workbench tools row: save-slice
 * inline form, slice apply/manage menu, persistent skip notices, and the
 * compare-dataset picker/chip. Dumb component — all state flows in, all
 * actions flow out; the page forwards to the store.
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import type {
  AnalysisDatasetDoc,
  AnalysisSlice,
} from '@paper-trading/analysis';
import { SliceMenuComponent } from '../analysis-slices/slice-menu.component';

@Component({
  selector: 'app-workbench-tools',
  standalone: true,
  imports: [
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    SliceMenuComponent,
  ],
  template: `
    <div class="workbench-tools">
      @if (!savingSlice()) {
        <button type="button" class="tool-btn" (click)="savingSlice.set(true)"
                [disabled]="!canSave()"
                title="Save the active filter chain as a named slice">
          <mat-icon>bookmark_add</mat-icon> Save slice
        </button>
      } @else {
        <span class="save-slice-form">
          <input class="slice-name" [value]="sliceName()"
                 (input)="sliceName.set($any($event.target).value)"
                 (keydown.enter)="onSave()"
                 (keydown.escape)="onCancel()"
                 placeholder="slice name" aria-label="Slice name" />
          <input class="slice-note-input" [value]="sliceNote()"
                 (input)="sliceNote.set($any($event.target).value)"
                 (keydown.enter)="onSave()"
                 (keydown.escape)="onCancel()"
                 placeholder="note (optional)" aria-label="Slice note" />
          <button type="button" class="tool-btn primary" (click)="onSave()"
                  [disabled]="!sliceName().trim()">Save</button>
          <button type="button" class="tool-btn" (click)="onCancel()">Cancel</button>
        </span>
      }
      <app-slice-menu
        [slices]="slices()"
        (applied)="applied.emit($event)"
        (deleted)="deleted.emit($event)" />
      <span class="tools-right">
        @if (skippedSliceColumns().length > 0) {
          <span class="skip-note" role="status">
            slice skipped columns: {{ skippedSliceColumns().join(', ') }}
          </span>
        }
        @if (compareDataset(); as cmp) {
          <span class="compare-chip">
            comparing: {{ labelFor()(cmp) }} · {{ cmp.id }}
            @if (isLoadingCompare()) {
              <mat-spinner diameter="14"></mat-spinner>
            }
            <button type="button" class="chip-x" (click)="compareCleared.emit()"
                    aria-label="Clear compare dataset">×</button>
          </span>
        } @else if (compareOptions().length > 0) {
          <mat-select class="compare-select" placeholder="Compare with…"
                      aria-label="Compare with another dataset"
                      (selectionChange)="compareSelected.emit($event.value)">
            @for (d of compareOptions(); track d.id) {
              <mat-option [value]="d">{{ labelFor()(d) }} · {{ d.id }}</mat-option>
            }
          </mat-select>
        }
        @if (skippedCompareColumns().length > 0) {
          <span class="skip-note" role="status">
            compare skipped columns: {{ skippedCompareColumns().join(', ') }}
          </span>
        }
      </span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .workbench-tools {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 0;
      font-size: 0.82rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #333);
      margin-bottom: 4px;
      flex-wrap: wrap;
    }
    .tool-btn {
      border: none; background: none; cursor: pointer;
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.82rem; padding: 4px 8px; opacity: 0.8; color: inherit;
      &:hover:not(:disabled) { opacity: 1; }
      &:disabled { opacity: 0.35; cursor: default; }
      &.primary { color: var(--mat-sys-primary, #2196f3); opacity: 1; }
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .save-slice-form {
      display: inline-flex; align-items: center; gap: 6px;
      .slice-name, .slice-note-input {
        background: transparent;
        border: 1px solid var(--mat-sys-outline-variant, #555);
        border-radius: 4px; color: inherit;
        font-size: 0.8rem; padding: 4px 8px; width: 130px;
      }
      .slice-note-input { width: 160px; }
    }
    .tools-right {
      // margin-left:auto (not a flex-grow spacer) so the cluster stays
      // right-aligned even when it wraps onto a second line at narrow
      // widths — a collapsed spacer left the picker flush-left.
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .skip-note {
      font-size: 0.78rem; font-style: italic;
      color: var(--mat-sys-error, #c62828);
    }
    .compare-select {
      font-size: 0.8rem; min-width: 200px;
      ::ng-deep .mat-mdc-select-value { font-size: 0.8rem; }
    }
    .compare-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 6px 2px 10px; border-radius: 12px;
      background: var(--mat-sys-tertiary-container, rgba(156, 39, 176, 0.15));
      font-size: 0.78rem;
      .chip-x {
        border: none; background: none; cursor: pointer;
        font-size: 0.95rem; line-height: 1; padding: 0 2px; opacity: 0.7;
        color: inherit;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkbenchToolsComponent {
  /** Whether "Save slice" is enabled — the page passes
   *  `store.filters().length > 0`. */
  canSave = input.required<boolean>();
  slices = input.required<AnalysisSlice[]>();
  /** Columns the last applied slice skipped on the open dataset. */
  skippedSliceColumns = input.required<string[]>();
  /** Active-filter columns absent from the compare dataset. */
  skippedCompareColumns = input.required<string[]>();
  /** Ready datasets excluding the open one. */
  compareOptions = input.required<AnalysisDatasetDoc[]>();
  compareDataset = input.required<AnalysisDatasetDoc | null>();
  isLoadingCompare = input.required<boolean>();
  /** Card-style label for a dataset (scope · id handled by template). */
  labelFor = input.required<(d: AnalysisDatasetDoc) => string>();

  saved = output<{ name: string; note?: string }>();
  applied = output<AnalysisSlice>();
  deleted = output<string>();
  compareSelected = output<AnalysisDatasetDoc>();
  compareCleared = output<void>();

  protected readonly savingSlice = signal(false);
  protected readonly sliceName = signal('');
  protected readonly sliceNote = signal('');

  protected onSave(): void {
    const name = this.sliceName().trim();
    if (!name) return;
    const note = this.sliceNote().trim();
    this.saved.emit({ name, note: note || undefined });
    this.reset();
  }

  protected onCancel(): void {
    this.reset();
  }

  /** Close the form AND drop the draft — cancel must not resurrect
   *  abandoned text on the next open. */
  private reset(): void {
    this.savingSlice.set(false);
    this.sliceName.set('');
    this.sliceNote.set('');
  }
}
