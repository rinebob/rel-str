/**
 * WorkbenchToolsComponent (#1085) — the workbench tools row: save-slice
 * inline form, slice apply/manage menu, persistent skip notices, and the
 * compare-dataset picker/chip. Dumb component — all state flows in, all
 * actions flow out; the page forwards to the store.
 *
 * #1348 pilot — mat-select → ds-select (native select), mat-spinner →
 * ds-spinner, text tool buttons → ds-btn.
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
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
    SliceMenuComponent],
  template: `
    <div class="workbench-tools">
      @if (!savingSlice()) {
        <button type="button" class="ds-btn small tool-btn" (click)="savingSlice.set(true)"
                [disabled]="!canSave()"
                title="Save the active filter chain as a named slice">
          <mat-icon>bookmark_add</mat-icon> Save slice
        </button>
      } @else {
        <span class="save-slice-form">
          <input class="field-input slice-name" [value]="sliceName()"
                 (input)="sliceName.set($any($event.target).value)"
                 (keydown.enter)="onSave()"
                 (keydown.escape)="onCancel()"
                 placeholder="slice name" aria-label="Slice name" />
          <input class="field-input slice-note-input" [value]="sliceNote()"
                 (input)="sliceNote.set($any($event.target).value)"
                 (keydown.enter)="onSave()"
                 (keydown.escape)="onCancel()"
                 placeholder="note (optional)" aria-label="Slice note" />
          <button type="button" class="ds-btn small fill tool-btn" (click)="onSave()"
                  [disabled]="!sliceName().trim()">Save</button>
          <button type="button" class="ds-btn small tool-btn" (click)="onCancel()">Cancel</button>
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
              <span class="dse-spinner small"></span>
            }
            <button type="button" class="chip-x" (click)="compareCleared.emit()"
                    aria-label="Clear compare dataset">×</button>
          </span>
        } @else if (compareOptions().length > 0) {
          <label class="dse-select compare-select">
            <select class="field-input" aria-label="Compare with another dataset"
                    [value]="''"
                    (change)="onCompareSelect($any($event.target).value)">
              <option value="" disabled>Compare with…</option>
              @for (d of compareOptions(); track d.id) {
                <option [value]="d.id">{{ labelFor()(d) }} · {{ d.id }}</option>
              }
            </select>
          </label>
        }
        @if (skippedCompareColumns().length > 0) {
          <span class="skip-note" role="status">
            compare skipped columns: {{ skippedCompareColumns().join(', ') }}
          </span>
        }
      </span>
    </div>
  `,
  styleUrl: './workbench-tools.component.scss',
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

  protected onCompareSelect(id: string): void {
    const d = this.compareOptions().find((o) => o.id === id);
    if (d) this.compareSelected.emit(d);
  }

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
