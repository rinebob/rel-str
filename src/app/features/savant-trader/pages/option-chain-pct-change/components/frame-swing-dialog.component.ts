/**
 * SwingCompareDialog — the swing-compare builder, in a dialog.
 *
 * Flow (top to bottom):
 *  1. Baseline Set dropdown — the saved analysis whose large swings
 *     bound the frame.
 *  2. Full-size zigzag of the baseline set — click a segment (or a row
 *     in the swing list) to pick the frame swing.
 *  3. Target Set dropdown — only sets with a lower devThreshold than the
 *     baseline (falls back to the baseline itself when nothing is finer).
 *  4. A second zigzag renders the target set's small swings.
 *  5. The run builder: start date + target checkboxes (labels + swing
 *     extreme values) + option type → Add run.
 *
 * Everything commits directly to the store, so runs accumulate while the
 * dialog stays open; Done simply closes it.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
} from '@angular/material/dialog';
import { OptionType } from '@options-contract/contracts';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import type { SwingAnalysisDoc } from '../../../swing-analysis/swing-analysis.types';
import type { Swing } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import {
  defaultTypeForStart,
  frameChartGeometry,
  swingPolyline,
  swingSegments,
  toUtcDateString,
  type SwingCompareDateItem,
} from '../utils/swing-compare.utils';

/** Data injected into the dialog. */
export interface FrameSwingDialogData {
  /** Saved swing analyses for the symbol — the Baseline Set options. */
  sets: SwingAnalysisDoc[];
  /** Currently selected baseline set id. */
  selectedSetId: string | null;
  /** Currently selected frame swing (highlighted); matched by time key. */
  selectedSwing: Swing | null;
}

const VIEW_W = 760;
const VIEW_H = 260;
const TARGET_VIEW_H = 180;

@Component({
  selector: 'app-frame-swing-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Swing Compare — {{ data.sets[0]?.symbol }}</h2>
    <mat-dialog-content>
      <label class="set-picker">
        Baseline Set
        <select
          data-testid="baseline-set-select"
          [value]="store.baselineSetId() ?? ''"
          (change)="onBaselineChange($event)"
        >
          <option value="" disabled>pick a set</option>
          @for (s of data.sets; track s.id) {
            <option [value]="s.id">
              {{ s.paramsId }} — {{ s.swings.length }} swings
            </option>
          }
        </select>
      </label>

      @if (baselineSet(); as set) {
        <svg
          class="zigzag-svg"
          [attr.viewBox]="'0 0 ' + viewW + ' ' + viewH"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="'Zigzag for ' + set.paramsId"
        >
          <polyline
            class="zigzag-line"
            [attr.points]="polyline()"
            fill="none"
            stroke="#9e9e9e"
            stroke-width="1"
          />
          @for (seg of segments(); track seg.swing.start.time + '-' + seg.swing.end.time) {
            <!-- invisible wide hit-target first — pointer events flow to it
                 since the visual stroke is non-interactive -->
            <line
              data-testid="swing-segment"
              class="swing-segment-hit"
              [attr.x1]="seg.x1"
              [attr.y1]="seg.y1"
              [attr.x2]="seg.x2"
              [attr.y2]="seg.y2"
              tabindex="0"
              role="button"
              [attr.aria-label]="segmentLabel(seg)"
              [attr.aria-pressed]="isSelected(seg.swing)"
              (click)="pick(seg.swing)"
              (keydown.enter)="pick(seg.swing)"
              (keydown.space)="pick(seg.swing); $event.preventDefault()"
            />
            <!-- visible stroke -->
            <line
              class="swing-segment-visual"
              [class.selected]="isSelected(seg.swing)"
              [class.down]="seg.swing.direction === 'down'"
              [attr.x1]="seg.x1"
              [attr.y1]="seg.y1"
              [attr.x2]="seg.x2"
              [attr.y2]="seg.y2"
            />
          }
        </svg>

        <ul class="swing-list" data-testid="swing-list">
          @for (seg of segments(); track seg.swing.start.time + '-' + seg.swing.end.time) {
            <li>
              <button
                type="button"
                class="swing-row"
                data-testid="swing-row"
                [class.selected]="isSelected(seg.swing)"
                (click)="pick(seg.swing)"
              >
                <span class="dir" [class.down]="seg.swing.direction === 'down'">
                  {{ seg.swing.direction === 'up' ? '▲' : '▼' }}
                </span>
                {{ swingRange(seg.swing) }}
                <span class="mag">{{ seg.swing.magnitudePercent.toFixed(1) }}%</span>
                <span class="dur">{{ seg.swing.duration }} bars</span>
              </button>
            </li>
          }
        </ul>
      }

      @if (store.frameSwing(); as frame) {
        <label class="set-picker">
          Target Set
          <select
            data-testid="target-set-select"
            [value]="store.targetSetId() ?? ''"
            (change)="onTargetSetChange($event)"
          >
            @for (s of store.targetSetChoices(); track s.id) {
              <option [value]="s.id">
                {{ s.paramsId }} (dev {{ s.config.devThreshold }})
              </option>
            }
          </select>
        </label>

        @if (store.targetDoc(); as target) {
          <svg
            class="zigzag-svg small"
            [attr.viewBox]="'0 0 ' + viewW + ' ' + targetViewH"
            preserveAspectRatio="none"
            role="img"
            [attr.aria-label]="'Small swings for ' + target.paramsId"
          >
            <polyline
              class="zigzag-line"
              [attr.points]="targetChart().polyline"
              fill="none"
              stroke="#9e9e9e"
              stroke-width="1"
            />
            <!-- pivot hairlines + rotated date labels, colored high/low -->
            @for (m of targetChart().marks; track m.date + '-' + m.isHigh) {
              <line
                class="pivot-hairline"
                [class.high]="m.isHigh"
                [attr.x1]="m.x"
                [attr.y1]="0"
                [attr.x2]="m.x"
                [attr.y2]="targetViewH"
              />
              <text
                class="pivot-label"
                [class.high]="m.isHigh"
                [attr.transform]="'rotate(-90 ' + m.x + ' ' + (targetViewH - 4) + ')'"
                [attr.x]="m.x - 2"
                [attr.y]="targetViewH - 4"
              >{{ m.date }}</text>
            }
            @for (seg of targetChart().segments; track seg.swing.start.time + '-' + seg.swing.end.time) {
              <line
                data-testid="target-segment-hit"
                class="swing-segment-hit"
                [attr.x1]="seg.x1"
                [attr.y1]="seg.y1"
                [attr.x2]="seg.x2"
                [attr.y2]="seg.y2"
                tabindex="0"
                role="button"
                [attr.aria-label]="segmentLabel(seg)"
                (click)="onTargetSwingClick(seg.swing)"
                (keydown.enter)="onTargetSwingClick(seg.swing)"
                (keydown.space)="onTargetSwingClick(seg.swing); $event.preventDefault()"
              />
              <line
                class="target-segment"
                [class.down]="seg.swing.direction === 'down'"
                [class.picked]="isPicked(seg.swing)"
                [attr.x1]="seg.x1"
                [attr.y1]="seg.y1"
                [attr.x2]="seg.x2"
                [attr.y2]="seg.y2"
              />
            }
          </svg>
        }

        <div class="run-builder" data-testid="run-builder">
          <label>
            Start
            <select
              data-testid="run-start-select"
              [value]="builderStart() ?? ''"
              (change)="onStartChange($event)"
            >
              <option value="" disabled>pick</option>
              @for (d of store.dateList(); track d.date) {
                <option [value]="d.date">
                  {{ d.date }} — {{ d.labels.join('+') }}
                </option>
              }
            </select>
          </label>

          <fieldset class="target-group">
            <legend>
              Targets
              <button
                type="button"
                class="mini-btn"
                data-testid="targets-select-all"
                [disabled]="candidates().length === 0"
                (click)="selectAllTargets()"
              >
                All
              </button>
              <button
                type="button"
                class="mini-btn"
                data-testid="targets-clear"
                [disabled]="builderTargets().size === 0"
                (click)="clearTargets()"
              >
                None
              </button>
            </legend>
            @for (d of candidates(); track d.date) {
              <label class="target-checkbox" data-testid="target-checkbox">
                <input
                  type="checkbox"
                  [checked]="builderTargets().has(d.date)"
                  (change)="onTargetToggle(d.date, $event)"
                />
                {{ d.date }} <em>{{ d.labels.join('+') }}</em>
                @if (d.pivotPrice !== null) {
                  <em class="extreme-value">{{ d.pivotPrice.toFixed(2) }}</em>
                }
              </label>
            }
          </fieldset>

          <label>
            Type
            <select
              data-testid="run-type-select"
              [value]="builderType() ?? types[0]"
              (change)="onTypeChange($event)"
            >
              @for (t of types; track t) {
                <option [value]="t">{{ t }}</option>
              }
            </select>
          </label>

          <button
            type="button"
            class="add-run-btn"
            data-testid="add-run-btn"
            [disabled]="!canAddRun()"
            (click)="addRun()"
          >
            Add run
          </button>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <span class="runs-count">Runs: {{ store.runs().length }}</span>
      <button mat-stroked-button [mat-dialog-close]>Done</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      mat-dialog-content { min-width: 0; }
      .set-picker { display: flex; flex-direction: column; gap: 4px;
        font-size: 0.85rem; margin: 8px 0; }
      .set-picker select { max-width: 420px; padding: 4px 6px; font-size: 0.85rem; }
      .zigzag-svg { display: block; width: 100%; height: 260px; background: #fafafa;
        border: 1px solid #ddd; border-radius: 4px; }
      .zigzag-svg.small { height: 180px; }
      .swing-segment-visual {
        stroke: #1976d2; stroke-width: 2.5; opacity: 0.7;
        vector-effect: non-scaling-stroke; pointer-events: none;
      }
      .swing-segment-visual.down { stroke: #c62828; }
      .swing-segment-visual.selected { stroke: #ff9800; opacity: 1; }
      .swing-segment-hit {
        stroke: transparent; stroke-width: 16; cursor: pointer;
        vector-effect: non-scaling-stroke;
      }
      .swing-segment-hit:focus { outline: none; }
      .swing-segment-hit:focus-visible ~ .swing-segment-visual,
      .swing-segment-hit:hover ~ .swing-segment-visual { opacity: 1; }
      .target-segment {
        stroke: #1976d2; stroke-width: 1.5; opacity: 0.6;
        vector-effect: non-scaling-stroke; pointer-events: none;
      }
      .target-segment.down { stroke: #c62828; }
      .target-segment.picked { stroke: #ff9800; stroke-width: 3; opacity: 1; }
      .pivot-hairline {
        stroke: #1976d2; stroke-width: 0.8; opacity: 0.35;
        vector-effect: non-scaling-stroke; pointer-events: none;
      }
      .pivot-hairline.high { stroke: #c62828; }
      .pivot-label {
        font-size: 9px; fill: #1976d2; opacity: 0.8; pointer-events: none;
      }
      .pivot-label.high { fill: #c62828; }
      .swing-list { list-style: none; margin: 10px 0 0; padding: 0;
        max-height: 140px; overflow-y: auto; }
      .swing-row {
        display: flex; gap: 10px; align-items: baseline; width: 100%;
        padding: 4px 8px; border: none; background: none; text-align: left;
        font-size: 0.85rem; cursor: pointer; border-radius: 4px;
      }
      .swing-row:hover, .swing-row.selected { background: #eef4fb; }
      .swing-row .dir { color: #1976d2; font-weight: 600; }
      .swing-row .dir.down { color: #c62828; }
      .swing-row .mag { margin-left: auto; font-family: monospace; }
      .swing-row .dur { color: #888; font-size: 0.75rem; }
      .run-builder {
        display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap;
        margin-top: 8px;
      }
      .run-builder label { display: flex; flex-direction: column; gap: 2px; }
      .run-builder select { padding: 4px 6px; font-size: 0.85rem; }
      .target-group {
        display: flex; gap: 10px; flex-wrap: wrap;
        border: 1px solid #ddd; border-radius: 4px; padding: 4px 8px;
        margin: 0;
      }
      .target-group legend { font-size: 0.72rem; color: #777; padding: 0 4px; }
      .mini-btn {
        font-size: 0.7rem; padding: 0 6px; margin-left: 6px;
        cursor: pointer; border: 1px solid #ccc; border-radius: 4px;
        background: #fff;
      }
      .mini-btn:disabled { opacity: 0.5; cursor: default; }
      .target-checkbox { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; }
      .target-checkbox em { color: #666; font-size: 0.75rem; }
      .extreme-value { color: #1976d2; font-style: normal;
        font-family: monospace; font-size: 0.75rem; }
      .add-run-btn { padding: 5px 14px; font-size: 0.85rem; cursor: pointer; }
      .runs-count { margin-right: auto; font-size: 0.8rem; color: #666; }
    `,
  ],
})
export class FrameSwingPickerDialogComponent {
  readonly data = inject(MAT_DIALOG_DATA) as FrameSwingDialogData;
  protected readonly store = inject(OptionChainPctChangeStore);

  readonly viewW = VIEW_W;
  readonly viewH = VIEW_H;
  readonly targetViewH = TARGET_VIEW_H;
  readonly types = Object.values(OptionType);

  readonly baselineSet = computed(
    () => this.data.sets.find((s) => s.id === this.store.baselineSetId()) ?? null,
  );

  readonly polyline = computed(() => {
    const set = this.baselineSet();
    return set ? swingPolyline(set.pivots, VIEW_W, VIEW_H) : '';
  });

  readonly segments = computed(() => {
    const set = this.baselineSet();
    return set ? swingSegments(set.swings, VIEW_W, VIEW_H) : [];
  });

  /** The target chart only draws what falls inside the picked frame —
   *  x maps the frame's [start,end] window so segments, the polyline, and
   *  the pivot hairlines share one axis; out-of-frame points are clipped.
   *  Switching target sets fully replaces what's drawn. */
  readonly targetChart = computed(() => {
    const target = this.store.targetDoc();
    const frame = this.store.frameSwing();
    if (!target || !frame) {
      return { segments: [], polyline: '', marks: [] };
    }
    return frameChartGeometry(
      frame.start.time,
      frame.end.time,
      target.pivots,
      target.swings,
      VIEW_W,
      TARGET_VIEW_H,
    );
  });

  // ---------------------------------------------------------------------------
  // Run-builder draft — start / targets / type, same semantics the inline
  // builder had; the date list comes from frameSwing + targetDoc.
  // ---------------------------------------------------------------------------

  readonly builderStart = signal<string | null>(null);
  readonly builderTargets = signal<Set<string>>(new Set());
  readonly builderType = signal<OptionType | null>(null);

  /** Dates after the chosen start — checkable targets. */
  readonly candidates = computed((): SwingCompareDateItem[] => {
    const start = this.builderStart();
    if (!start) return [];
    return this.store
      .targetCandidates(start)
      .filter((d) => d.date !== start);
  });

  readonly canAddRun = computed(
    () => !!this.builderStart() && this.builderTargets().size > 0,
  );

  onBaselineChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.store.selectBaselineSet(id || null);
    this.builderStart.set(null);
    this.builderTargets.set(new Set());
    this.builderType.set(null);
  }

  onTargetSetChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.store.selectTargetSet(id || null);
    this.builderTargets.set(new Set());
  }

  /** Key compare — swing identity survives doc refetches. */
  isSelected(swing: Swing): boolean {
    const sel = this.store.frameSwing();
    return !!sel && sel.start.time === swing.start.time && sel.end.time === swing.end.time;
  }

  segmentLabel(seg: { swing: Swing }): string {
    return `${seg.swing.direction} swing ${this.swingRange(seg.swing)}`;
  }

  swingRange(swing: Swing): string {
    return `${toUtcDateString(swing.start.time)} → ${toUtcDateString(swing.end.time)}`;
  }

  pick(swing: Swing): void {
    this.store.selectFrameSwing(swing);
    this.builderStart.set(null);
    this.builderTargets.set(new Set());
    this.builderType.set(null);
  }

  /** Click a small swing → check its endpoint dates as targets.
   *  With no start picked yet the first click prefills the run
   *  (start = swing start, type from direction, end checked);
   *  afterwards clicks toggle that swing's endpoints — click several
   *  swings, Add run, repeat. Clicking an already-checked swing
   *  unchecks its dates. */
  onTargetSwingClick(swing: Swing): void {
    const startDate = toUtcDateString(swing.start.time);
    const endDate = toUtcDateString(swing.end.time);
    const next = new Set(this.builderTargets());

    if (!this.builderStart()) {
      this.builderStart.set(startDate);
      this.builderType.set(swing.direction === 'up' ? OptionType.CALL : OptionType.PUT);
      next.add(endDate);
      this.builderTargets.set(next);
      return;
    }

    const candDates = new Set(this.candidates().map((d) => d.date));
    const endpoints = [startDate, endDate].filter((d) => candDates.has(d));
    const allChecked = endpoints.length > 0 && endpoints.every((d) => next.has(d));
    for (const d of endpoints) {
      if (allChecked) next.delete(d);
      else next.add(d);
    }
    this.builderTargets.set(next);
  }

  /** Both endpoint dates checked → the swing renders highlighted. */
  isPicked(swing: Swing): boolean {
    const targets = this.builderTargets();
    const start = this.builderStart();
    const s = toUtcDateString(swing.start.time);
    const e = toUtcDateString(swing.end.time);
    // The swing's own start counts as "picked" when it's the run start.
    const startOk = s === start || targets.has(s);
    return startOk && targets.has(e);
  }

  onStartChange(event: Event): void {
    const start = (event.target as HTMLSelectElement).value;
    this.builderStart.set(start || null);
    this.builderTargets.set(new Set());
    const item = this.store.dateList().find((d) => d.date === start);
    this.builderType.set(item ? defaultTypeForStart(item) : null);
  }

  onTargetToggle(date: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.builderTargets());
    if (checked) next.add(date);
    else next.delete(date);
    this.builderTargets.set(next);
  }

  selectAllTargets(): void {
    this.builderTargets.set(new Set(this.candidates().map((d) => d.date)));
  }

  clearTargets(): void {
    this.builderTargets.set(new Set());
  }

  onTypeChange(event: Event): void {
    this.builderType.set((event.target as HTMLSelectElement).value as OptionType);
  }

  addRun(): void {
    const start = this.builderStart();
    const targets = [...this.builderTargets()].sort();
    if (!start || targets.length === 0) return;
    this.store.addRun(start, targets, this.builderType() ?? OptionType.CALL);
    this.builderStart.set(null);
    this.builderTargets.set(new Set());
    this.builderType.set(null);
  }
}
