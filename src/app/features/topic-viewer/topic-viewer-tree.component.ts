/**
 * TopicViewerTreeComponent — flat-row tree renderer for the topic-viewer
 * page (Topic #619 / task #643). Renders the store's expandedIds-gated
 * `treeRows` (or an explicit `rows` input — the all-topics pane, #1532)
 * with depth indentation; caret toggles expansion; query hits tint via
 * `.match`; titles link out to github.com. Read-only — no write
 * affordances.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';


import type { LifecycleNode } from '@lifecycle/contracts';
import { stageOrdinal } from '@lifecycle/tree';
import { TopicViewerStore, type TreeRow } from './topic-viewer.store';

/** Labels that decorate every issue — they carry no signal in the tree's
 *  tag chips, so they're filtered out. */
const NOISE_LABELS = new Set(['INTERNAL', 'FEATURE']);

@Component({
  selector: 'app-topic-viewer-tree',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of visibleRows(); track row.node.number) {
      <div class="tree-row" [class.closed]="row.node.state === 'closed'"
        [class.match]="isMatch(row.node.number)"
        [class.resolved]="isResolved(row.node.number)"
        [style.padding-left.px]="row.depth * 20"
        [style.--guides]="row.depth * 20"
        [attr.data-testid]="'tree-node-' + row.node.number"
      >
        @if (expandable().has(row.node.number)) {
          <button type="button" class="caret icon-btn"
 [attr.data-testid]="'caret-' + row.node.number"
 [attr.aria-expanded]="isExpanded(row.node.number)"
 [attr.aria-label]="(isExpanded(row.node.number) ? 'Collapse ' : 'Expand ') + '#' + row.node.number"
 (click)="store.toggleExpanded(row.node.number)"
 ><span class="dse-icon">{{ isExpanded(row.node.number) ? 'expand_more' : 'chevron_right' }}</span></button>
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
    @use './stage-chips' as sc;
    .tree-row {
      position: relative;
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 0; font-size: 0.85rem; white-space: nowrap;
      border-radius: 4px;
    }
    .tree-row:hover { background: var(--mat-sys-surface-variant); }
    /* Depth guides — vertical line at each ancestor indent so parentage
       reads at depth 2-3. */
    .tree-row::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 0;
      width: calc(var(--guides, 0) * 1px);
      background-image: repeating-linear-gradient(to right,
        var(--mat-sys-outline-variant) 0 1px, transparent 1px 20px);
      /* Ancestor caret center = 20*depth + 12 (24px box). A 1px line
         centered there starts at 11.5px into each 20px period. */
      background-position: 11.5px 0;
      pointer-events: none;
    }
    .tree-row.closed { opacity: 0.55; font-style: italic; }
    /* Query match (#1532) — subtle primary tint so hits read at a glance. */
    .tree-row.match {
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
    }
    .tree-row.match:hover {
      background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent);
    }
    /* Resolved node (#1696) — a tertiary ring + tint, distinct from the
       primary match tint so a deep-search landing reads at a glance. */
    .tree-row.resolved {
      background: color-mix(in srgb, var(--mat-sys-tertiary) 14%, transparent);
      box-shadow: inset 0 0 0 1.5px var(--mat-sys-tertiary);
    }
    .tree-row.resolved:hover {
      background: color-mix(in srgb, var(--mat-sys-tertiary) 20%, transparent);
    }
    /* Force the 24px box to truly center its icon on the guide line. */
    .caret {
      width: 24px; height: 24px; flex: none; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .caret .dse-icon {
      font-size: 18px; width: 18px; height: 18px; line-height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .caret-spacer { width: 24px; flex: none; }
    .num { color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; flex: none; }
    .title {
      flex: 1; min-width: 0; color: inherit; text-decoration: none;
      overflow: hidden; text-overflow: ellipsis;
    }
    .title:hover { text-decoration: underline; color: var(--mat-sys-primary); }
    .row-meta { display: flex; align-items: center; gap: 4px; flex: none; }
    .type-badge {
      font-size: 0.65rem; padding: 1px 5px; border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant); text-transform: uppercase;
    }
    .chip {
      font-size: 0.65rem; padding: 1px 6px; border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }
    /* Stage chips color-coded by lifecycle position (data-stage = ordinal).
       literal-sweep exception #1217: stage-identity hues are a
       categorical palette by contract, not theme tokens. */
    .chip.stage { @include sc.stage-chip-palette; }
    .chip.status { background: var(--ds-warning-container); color: var(--ds-on-warning-container); }
    .chip.tag {
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      box-shadow: inset 0 0 0 1px var(--mat-sys-outline-variant);
    }
  `],
})
export class TopicViewerTreeComponent {
  protected readonly store = inject(TopicViewerStore);

  /** Row override for the all-topics pane (#1532) — the page hands each
   *  section's flattened rows; absent → the selected topic's treeRows. */
  readonly rows = input<TreeRow[] | null>(null);

  protected readonly visibleRows = computed(
    () => this.rows() ?? this.store.treeRows());

  /** Query-hit highlight — nodes in the store's matchSet render tinted. */
  protected isMatch(n: number): boolean {
    return this.store.matchSet().has(n);
  }

  /** Deep-resolution landing row (#1696) — the number a digit query
   *  navigated to, highlighted with a ring distinct from .match. */
  protected isResolved(n: number): boolean {
    return this.store.resolvedNodeNumber() === n;
  }

  /** Effective expansion (manual ∪ match ancestors) — must match the
   *  rows treeRows emits or carets/aria lie during an active query. */
  private readonly expandedSet = computed(() => new Set(this.store.effectiveExpandedIds()));

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
