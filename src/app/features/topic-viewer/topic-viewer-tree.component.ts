/**
 * TopicViewerTreeComponent — flat-row tree renderer for the topic-viewer
 * page (Topic #619 / task #643). Renders the store's expandedIds-gated
 * `treeRows` with depth indentation; caret toggles expansion; titles link
 * out to github.com. Read-only — no write affordances.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import type { LifecycleNode } from '@lifecycle/contracts';
import { stageOrdinal } from '@lifecycle/tree';
import { TopicViewerStore } from './topic-viewer.store';

/** Labels that decorate every issue — they carry no signal in the tree's
 *  tag chips, so they're filtered out. */
const NOISE_LABELS = new Set(['INTERNAL', 'FEATURE']);

@Component({
  selector: 'app-topic-viewer-tree',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of store.treeRows(); track row.node.number) {
      <div class="tree-row" [class.closed]="row.node.state === 'closed'"
        [style.padding-left.px]="row.depth * 20"
        [style.--guides]="row.depth * 20"
        [attr.data-testid]="'tree-node-' + row.node.number"
      >
        @if (expandable().has(row.node.number)) {
          <button mat-icon-button type="button" class="caret"
            [attr.data-testid]="'caret-' + row.node.number"
            [attr.aria-expanded]="isExpanded(row.node.number)"
            [attr.aria-label]="(isExpanded(row.node.number) ? 'Collapse ' : 'Expand ') + '#' + row.node.number"
            (click)="store.toggleExpanded(row.node.number)"
          ><mat-icon>{{ isExpanded(row.node.number) ? 'expand_more' : 'chevron_right' }}</mat-icon></button>
        } @else {
          <span class="caret-spacer"></span>
        }
        <span class="num">#{{ row.node.number }}</span>
        <a class="title" [href]="row.node.url" target="_blank" rel="noopener noreferrer"
          [attr.data-testid]="'link-' + row.node.number"
        >{{ row.node.title }}</a>
        <span class="row-meta">
          @if (row.node.nodeType !== 'task') {
            <span class="type-badge">{{ row.node.nodeType }}</span>
          }
          @if (row.node.stageLabel) {
            <span class="chip stage" [attr.data-stage]="ordinal(row.node.stageLabel)"
              data-testid="stage-chip">{{ row.node.stageLabel }}</span>
          }
          @if (row.node.status) {
            <span class="chip status">{{ row.node.status }}</span>
          }
          @for (l of tags(row.node); track l) {
            <span class="chip tag">{{ l }}</span>
          }
        </span>
      </div>
    }
  `,
  styles: [`
    .tree-row {
      position: relative;
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 0; font-size: 0.85rem; white-space: nowrap;
      border-radius: 4px;
    }
    .tree-row:hover { background: var(--mat-sys-surface-variant, #f5f5f5); }
    /* Depth guides — vertical line at each ancestor indent so parentage
       reads at depth 2-3. */
    .tree-row::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 0;
      width: calc(var(--guides, 0) * 1px);
      background-image: repeating-linear-gradient(to right,
        var(--mat-sys-outline-variant, #ddd) 0 1px, transparent 1px 20px);
      /* Ancestor caret center = 20*depth + 12 (24px box). A 1px line
         centered there starts at 11.5px into each 20px period. */
      background-position: 11.5px 0;
      pointer-events: none;
    }
    .tree-row.closed { opacity: 0.55; font-style: italic; }
    /* mat-icon-button's internal padding would off-center the glyph —
       force the 24px box to truly center its icon on the guide line.
       The 48px Material touch-target would also overflow ~8px into
       adjacent rows and swallow their clicks, so it's disabled. */
    .caret {
      width: 24px; height: 24px; flex: none; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      --mat-icon-button-touch-target-display: none;
    }
    .caret mat-icon {
      font-size: 18px; width: 18px; height: 18px; line-height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .caret-spacer { width: 24px; flex: none; }
    .num { color: var(--mat-sys-on-surface-variant, #888); font-variant-numeric: tabular-nums; flex: none; }
    .title {
      flex: 1; min-width: 0; color: inherit; text-decoration: none;
      overflow: hidden; text-overflow: ellipsis;
    }
    .title:hover { text-decoration: underline; color: var(--mat-sys-primary, #1565c0); }
    .row-meta { display: flex; align-items: center; gap: 4px; flex: none; }
    .type-badge {
      font-size: 0.65rem; padding: 1px 5px; border-radius: 8px;
      background: var(--mat-sys-surface-container-high, #eceff1);
      color: var(--mat-sys-on-surface-variant, #546e7a); text-transform: uppercase;
    }
    .chip {
      font-size: 0.65rem; padding: 1px 6px; border-radius: 8px;
      background: var(--mat-sys-surface-container-high, #eceff1);
      color: var(--mat-sys-on-surface-variant, #546e7a);
    }
    /* Stage chips color-coded by lifecycle position (data-stage = ordinal). */
    .chip.stage[data-stage="1"] { background: #ede7f6; color: #5e35b1; }
    .chip.stage[data-stage="2"] { background: #e8eaf6; color: #3949ab; }
    .chip.stage[data-stage="3"] { background: #e1f5fe; color: #0277bd; }
    .chip.stage[data-stage="4"] { background: #eceff1; color: #455a64; }
    .chip.stage[data-stage="5"] { background: #e3f2fd; color: #1565c0; }
    .chip.stage[data-stage="6"] { background: #fff8e1; color: #ef6c00; }
    .chip.stage[data-stage="7"] { background: #fff3e0; color: #e65100; }
    .chip.stage[data-stage="8"] { background: #e8f5e9; color: #2e7d32; }
    .chip.status { background: #fff8e1; color: #8d6e00; }
    .chip.tag {
      background: transparent;
      color: var(--mat-sys-on-surface-variant, #888);
      box-shadow: inset 0 0 0 1px var(--mat-sys-outline-variant, #ddd);
    }
  `],
})
export class TopicViewerTreeComponent {
  protected readonly store = inject(TopicViewerStore);

  private readonly expandedSet = computed(() => new Set(this.store.expandedIds()));

  isExpanded(n: number): boolean {
    return this.expandedSet().has(n);
  }

  /** Tag chips = labels minus pure-noise labels (INTERNAL/FEATURE decorate
   *  every issue — they carry no signal here). Stage labels are already
   *  absent from node.labels per decodeLabels. */
  tags(node: LifecycleNode): string[] {
    return node.labels.filter(l => !NOISE_LABELS.has(l));
  }

  /** Stage ordinal for chip color-coding — 5_IMPLEMENT → '5'. */
  protected readonly ordinal = stageOrdinal;

  /** Caret only when expanding would reveal something — a node whose
   *  children are all closed isn't expandable with showClosed off.
   *  Delegates to the store's expandableIds (same predicate). */
  protected readonly expandable = computed(() => new Set(this.store.expandableIds()));
}
