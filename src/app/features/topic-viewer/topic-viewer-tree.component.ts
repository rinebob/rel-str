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
import { TopicViewerStore } from './topic-viewer.store';

@Component({
  selector: 'app-topic-viewer-tree',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of store.treeRows(); track row.node.number) {
      <div class="tree-row" [class.closed]="row.node.state === 'closed'"
        [style.padding-left.px]="row.depth * 18"
        [attr.data-testid]="'tree-node-' + row.node.number"
        [attr.data-node-type]="row.node.nodeType"
      >
        @if (hasVisibleChildren(row.node)) {
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
        <span class="type-badge" [attr.data-type]="row.node.nodeType">{{ row.node.nodeType }}</span>
        @if (row.node.stageLabel) {
          <span class="chip stage" data-testid="stage-chip">{{ row.node.stageLabel }}</span>
        }
        @if (row.node.status) {
          <span class="chip status">{{ row.node.status }}</span>
        }
        @for (l of tags(row.node); track l) {
          <span class="chip tag">{{ l }}</span>
        }
      </div>
    }
  `,
  styles: [`
    .tree-row {
      display: flex; align-items: center; gap: 6px;
      padding: 3px 8px 3px 0; font-size: 0.85rem; white-space: nowrap;
    }
    .tree-row.closed { opacity: 0.55; font-style: italic; }
    .caret { width: 24px; height: 24px; line-height: 24px; }
    .caret mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .caret-spacer { width: 24px; }
    .num { color: #888; font-variant-numeric: tabular-nums; }
    .title { color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
    .title:hover { text-decoration: underline; }
    .type-badge {
      font-size: 0.65rem; padding: 1px 5px; border-radius: 8px;
      background: #eceff1; color: #546e7a; text-transform: uppercase;
    }
    .chip {
      font-size: 0.65rem; padding: 1px 6px; border-radius: 8px;
      background: #e3f2fd; color: #1565c0;
    }
    .chip.status { background: #fff8e1; color: #8d6e00; }
    .chip.tag { background: #f3e5f5; color: #6a1b9a; }
  `],
})
export class TopicViewerTreeComponent {
  protected readonly store = inject(TopicViewerStore);

  private readonly expandedSet = computed(() => new Set(this.store.expandedIds()));

  isExpanded(n: number): boolean {
    return this.expandedSet().has(n);
  }

  /** Tag chips = labels minus stage labels (those render as the stage chip). */
  tags(node: LifecycleNode): string[] {
    return node.labels.filter(l => l !== node.stageLabel);
  }

  /** Caret only when expanding would reveal something — a node whose
   *  children are all closed isn't expandable with showClosed off
   *  (mirrors store.expandableIds). */
  hasVisibleChildren(node: LifecycleNode): boolean {
    return this.store.showClosed()
      ? node.children.length > 0
      : node.children.some(c => c.state === 'open');
  }
}
