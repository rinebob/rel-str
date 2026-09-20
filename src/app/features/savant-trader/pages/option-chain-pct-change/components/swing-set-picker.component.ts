/**
 * SwingSetPicker — a saved-swing-set dropdown plus a collapsed expando
 * panel rendering that set's zigzag as a mini SVG. Each swing segment has
 * an invisible wide hit-target (also a keyboard-focusable "button") that
 * emits the Swing — the frame anchor for swing-compare.
 *
 * Reused for both the frame-set picker and the extremes-set picker —
 * selection + swing emit via outputs; the store owns the state.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { SwingAnalysisDoc } from '../../../swing-analysis/swing-analysis.types';
import type { Swing } from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import { swingPolyline, swingSegments } from '../utils/swing-compare.utils';

const VIEW_W = 200;
const VIEW_H = 48;

@Component({
  selector: 'app-swing-set-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="swing-set-picker">
      <select
        data-testid="swing-set-select"
        class="swing-set-select"
        [value]="selectedSet()?.id ?? ''"
        (change)="onSetChange($event)"
      >
        <option value="" disabled>{{ placeholder() }}</option>
        @for (s of sets(); track s.id) {
          <option [value]="s.id">{{ s.paramsId }}</option>
        }
      </select>

      @if (selectedSet(); as set) {
        <details class="zigzag-expando" data-testid="zigzag-expando">
          <summary class="expando-header">
            zigzag preview — click a segment to anchor the frame
          </summary>
          <svg
            class="zigzag-svg"
            [attr.viewBox]="'0 0 ' + viewW + ' ' + viewH"
            [style.height.px]="viewH"
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
              <!-- invisible wide hit-target first — painted under the
                   visual but pointer-events flow to it since the visual
                   stroke is non-interactive -->
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
                (click)="swingSelected.emit(seg.swing)"
                (keydown.enter)="swingSelected.emit(seg.swing)"
                (keydown.space)="swingSelected.emit(seg.swing); $event.preventDefault()"
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
        </details>
      }
    </div>
  `,
  styles: [
    `
      .swing-set-picker { display: flex; flex-direction: column; gap: 6px; }
      .swing-set-select { max-width: 320px; padding: 4px 6px; font-size: 0.85rem; }
      .zigzag-expando { border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
      .expando-header {
        padding: 4px 10px; font-size: 0.75rem; color: #777;
        background: #f7f7f7; cursor: pointer; user-select: none;
      }
      .zigzag-svg { display: block; width: 100%; background: #fafafa; }
      .swing-segment-visual {
        stroke: #1976d2; stroke-width: 2; opacity: 0.7;
        vector-effect: non-scaling-stroke; pointer-events: none;
      }
      .swing-segment-visual.down { stroke: #c62828; }
      .swing-segment-visual.selected { stroke: #ff9800; opacity: 1; }
      .swing-segment-hit {
        stroke: transparent; stroke-width: 14; cursor: pointer;
        vector-effect: non-scaling-stroke;
      }
      .swing-segment-hit:focus { outline: none; }
      .swing-segment-hit:focus-visible ~ .swing-segment-visual,
      .swing-segment-hit:hover ~ .swing-segment-visual { opacity: 1; }
    `,
  ],
})
export class SwingSetPickerComponent {
  /** Saved swing sets for the current symbol. */
  readonly sets = input.required<SwingAnalysisDoc[]>();
  /** Currently selected set doc (null = nothing picked). */
  readonly selectedSet = input<SwingAnalysisDoc | null>(null);
  /** Currently selected swing — highlighted in the zigzag. Matched by
   *  start/end time key, not object identity, so a refetched doc still
   *  highlights. */
  readonly selectedSwing = input<Swing | null>(null);
  /** Placeholder/label for the empty dropdown option. */
  readonly placeholder = input<string>('Select swing set');

  /** Emits the chosen set's doc id. */
  readonly setSelected = output<string>();
  /** Emits the clicked swing segment's Swing. */
  readonly swingSelected = output<Swing>();

  readonly viewW = VIEW_W;
  readonly viewH = VIEW_H;

  readonly polyline = computed(() => {
    const set = this.selectedSet();
    return set ? swingPolyline(set.pivots, VIEW_W, VIEW_H) : '';
  });

  readonly segments = computed(() => {
    const set = this.selectedSet();
    return set ? swingSegments(set.swings, VIEW_W, VIEW_H) : [];
  });

  /** Key compare — swing identity survives doc refetches. */
  isSelected(swing: Swing): boolean {
    const sel = this.selectedSwing();
    return !!sel && sel.start.time === swing.start.time && sel.end.time === swing.end.time;
  }

  segmentLabel(seg: { swing: Swing }): string {
    const s = seg.swing;
    const from = new Date(s.start.time).toISOString().slice(0, 10);
    const to = new Date(s.end.time).toISOString().slice(0, 10);
    return `${s.direction} swing ${from} to ${to}`;
  }

  onSetChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (id) this.setSelected.emit(id);
  }
}
