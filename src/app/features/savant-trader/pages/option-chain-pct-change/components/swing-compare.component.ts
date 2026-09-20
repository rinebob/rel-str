/**
 * SwingCompareComponent — the swing-compare section container.
 *
 * Layout: frame-set picker (zigzag expando anchors the frame swing),
 * extremes-set picker, merged labeled date list, run builder (start
 * dropdown + post-start target checkboxes + type select defaulted by
 * direction), and a run list rendering RunSection per saved run.
 *
 * All durable state lives in OptionChainPctChangeStore; the builder's
 * draft selection is local component state.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { OptionType } from '@options-contract/contracts';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { SwingSetPickerComponent } from './swing-set-picker.component';
import { RunSectionComponent } from './run-section.component';
import { defaultTypeForStart } from '../utils/swing-compare.utils';

@Component({
  selector: 'app-swing-compare',
  standalone: true,
  imports: [SwingSetPickerComponent, RunSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="swing-compare" data-testid="swing-compare">
      <h3 class="section-title">Swing compare</h3>

      <div class="picker-row">
        <app-swing-set-picker
          [sets]="store.savedAnalyses()"
          [selectedSet]="frameSet()"
          [selectedSwing]="store.frameSwing()"
          placeholder="Frame set"
          (setSelected)="store.selectFrameSet($event)"
          (swingSelected)="store.selectFrameSwing($event)"
        />
        <app-swing-set-picker
          [sets]="store.savedAnalyses()"
          [selectedSet]="extremesSet()"
          placeholder="Extremes set"
          (setSelected)="store.selectExtremesSet($event)"
        />
      </div>

      @if (store.frameSwing(); as frame) {
        <div class="date-list" data-testid="date-list">
          @for (d of store.dateList(); track d.date) {
            <span class="date-item" data-testid="date-item">
              {{ d.date }}
              <em class="date-labels">{{ d.labels.join(' + ') }}</em>
            </span>
          }
        </div>

        <div class="run-builder">
          <label>
            Start
            <select
              data-testid="run-start-select"
              [value]="builderStart() ?? ''"
              (change)="onStartChange($event)"
            >
              <option value="" disabled>pick a date</option>
              @for (d of store.dateList(); track d.date) {
                <option [value]="d.date">{{ d.date }} ({{ d.labels.join('+') }})</option>
              }
            </select>
          </label>

          <fieldset class="target-group">
            <legend>Targets</legend>
            @for (d of candidates(); track d.date) {
              <label class="target-checkbox" data-testid="target-checkbox">
                <input
                  type="checkbox"
                  [checked]="builderTargets().has(d.date)"
                  (change)="onTargetToggle(d.date, $event)"
                />
                {{ d.date }} <em>{{ d.labels.join('+') }}</em>
              </label>
            }
          </fieldset>

          <label>
            Type
            <select
              data-testid="run-type-select"
              [value]="builderType()"
              (change)="onTypeChange($event)"
            >
              <option [value]="callType">CALL</option>
              <option [value]="putType">PUT</option>
            </select>
          </label>

          <button
            type="button"
            class="add-run-btn"
            data-testid="add-run-btn"
            [disabled]="!canAddRun()"
            (click)="onAddRun()"
          >
            Add run
          </button>
        </div>
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
      .swing-compare { display: flex; flex-direction: column; gap: 10px; }
      .section-title { margin: 0; font-size: 1rem; font-weight: 600; }
      .picker-row { display: flex; gap: 16px; flex-wrap: wrap; }
      .date-list { display: flex; flex-wrap: wrap; gap: 6px; }
      .date-item {
        border: 1px solid #ccc; border-radius: 10px;
        padding: 2px 8px; font-size: 0.78rem; white-space: nowrap;
      }
      .date-labels { color: #666; font-size: 0.72rem; margin-left: 4px; }
      .run-builder {
        display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap;
        font-size: 0.85rem;
      }
      .run-builder label { display: flex; flex-direction: column; gap: 2px; }
      .target-group {
        display: flex; gap: 10px; flex-wrap: wrap;
        border: 1px solid #ddd; border-radius: 4px; padding: 4px 8px;
      }
      .target-group legend { font-size: 0.72rem; color: #777; padding: 0 4px; }
      .target-checkbox { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; }
      .target-checkbox em { color: #888; font-size: 0.72rem; }
      .add-run-btn { padding: 5px 14px; font-size: 0.85rem; cursor: pointer; }
      .add-run-btn:disabled { opacity: 0.5; cursor: default; }
      .run-list { display: flex; flex-direction: column; gap: 6px; }
    `,
  ],
})
export class SwingCompareComponent {
  readonly store = inject(OptionChainPctChangeStore);

  readonly callType = OptionType.CALL;
  readonly putType = OptionType.PUT;

  // ---- run-builder draft state -------------------------------------------

  readonly builderStart = signal<string | null>(null);
  readonly builderTargets = signal<ReadonlySet<string>>(new Set());
  readonly builderType = signal<OptionType>(OptionType.CALL);

  readonly frameSet = computed(
    () => this.store.savedAnalyses().find((d) => d.id === this.store.frameSetId()) ?? null,
  );
  readonly extremesSet = computed(
    () => this.store.savedAnalyses().find((d) => d.id === this.store.extremesSetId()) ?? null,
  );

  readonly candidates = computed(() => {
    const start = this.builderStart();
    return start ? this.store.targetCandidates(start) : [];
  });

  readonly canAddRun = computed(
    () => !!this.builderStart() && this.builderTargets().size > 0,
  );

  constructor() {
    // A new frame swing invalidates the builder draft — its dates were
    // chosen from the old frame's dateList.
    effect(() => {
      this.store.frameSwing();
      this.resetDraft();
    });
  }

  private resetDraft(): void {
    this.builderStart.set(null);
    this.builderTargets.set(new Set());
    this.builderType.set(OptionType.CALL);
  }

  // ---- builder handlers ---------------------------------------------------

  /** Picking a new start resets targets (they'd be stale) and eagerly
   *  derives the default type from the start item's direction. */
  onStartChange(event: Event): void {
    const date = (event.target as HTMLSelectElement).value;
    this.builderStart.set(date || null);
    this.builderTargets.set(new Set());
    const item = this.store.dateList().find((d) => d.date === date);
    this.builderType.set(item ? defaultTypeForStart(item) : OptionType.CALL);
  }

  onTargetToggle(date: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.builderTargets());
    if (checked) next.add(date);
    else next.delete(date);
    this.builderTargets.set(next);
  }

  onTypeChange(event: Event): void {
    this.builderType.set((event.target as HTMLSelectElement).value as OptionType);
  }

  onAddRun(): void {
    const start = this.builderStart();
    const targets = [...this.builderTargets()].sort();
    if (!start || targets.length === 0) return;
    this.store.addRun(start, targets, this.builderType());
    this.resetDraft();
  }
}
