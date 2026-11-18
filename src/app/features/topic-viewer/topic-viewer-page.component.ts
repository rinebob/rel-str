/**
 * TopicViewerPageComponent — master-detail read-only GitHub issue-lifecycle
 * viewer (Topic #619 / Blueprint #635 / task #643).
 *
 * Header: repo picker, Refresh (spinner while loading), as-of timestamp,
 * Show-closed toggle, search + match count, sort toggle (Grouped|Issue #),
 * All-topics toggle, Labels button (disabled until #1533's dialog).
 * Left pane: `visibleTopics` — grouped sections or one flat number list.
 * Right pane: the selected topic's tree, or every section's trees in
 * all-topics mode (expand-all / collapse-all). Error banner over a
 * preserved tree; grouping-warning banner when the inventory doc degraded.
 */

import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';


import { stageOrdinal } from '@lifecycle/tree';
import { TopicViewerStore } from './topic-viewer.store';
import { TopicViewerTreeComponent } from './topic-viewer-tree.component';

@Component({
  selector: 'app-topic-viewer-page',
  imports: [
    NgTemplateOutlet,
    TopicViewerTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="topic-viewer-page">
      <header class="header">
        <label class="dse-field repo-picker">
          <select class="dse-select" [value]="store.selectedRepoIndex()" aria-label="Repository"
            data-testid="repo-picker" (change)="store.selectRepo(+$any($event.target).value)">
            @for (r of store.repos(); track r.repo; let i = $index) {
              <option [value]="i">{{ r.label }}</option>
            }
          </select>
        </label>
        <button class="ds-btn outline" type="button" data-testid="refresh"
 [disabled]="store.loading()" (click)="store.refresh()">
          @if (store.loading()) { <span class="dse-spinner small" style="--spinner-size: 16px" role="progressbar" aria-label="Loading"></span> } Refresh
        </button>
        @if (store.fetchedAt(); as at) {
          <span class="dim" data-testid="fetched-at">as of {{ at }}</span>
        }
        <label class="dse-field search">
          <input class="dse-input" type="search" placeholder="Search title, #, label"
            aria-label="Search topics" data-testid="search"
            [value]="store.query()" (input)="store.setQuery($any($event.target).value)">
        </label>
        @if (store.query() && (store.selectedTopic() || store.showAllTopics())) {
          <span class="dim" data-testid="match-count">{{ store.matchCount() }} match{{ store.matchCount() === 1 ? '' : 'es' }}</span>
        }
        <div class="pill-group" role="group" aria-label="Sort topics">
          <button type="button" class="pill" [class.active]="store.sortMode() === 'grouped'"
            [attr.aria-pressed]="store.sortMode() === 'grouped'" data-testid="sort-grouped"
            (click)="store.setSortMode('grouped')">Grouped</button>
          <button type="button" class="pill" [class.active]="store.sortMode() === 'number'"
            [attr.aria-pressed]="store.sortMode() === 'number'" data-testid="sort-number"
            (click)="store.setSortMode('number')">Issue #</button>
        </div>
        <button class="ds-btn outline" type="button" data-testid="labels-btn" disabled
          title="Label manager — lands with #1533">Labels</button>
        <label class="dse-check"><input type="checkbox" [checked]="store.showAllTopics()" data-testid="all-topics"
          (change)="store.setShowAllTopics($any($event.target).checked)">All topics</label>
        <label class="dse-check"><input type="checkbox" [checked]="store.showClosed()" data-testid="show-closed"
          (change)="store.setShowClosed($any($event.target).checked)">Show closed</label>
      </header>

      @if (store.error(); as err) {
        <div class="banner error" role="alert" data-testid="error-banner">
          <span class="dse-icon">error_outline</span><span>{{ err }}</span>
        </div>
      }
      @if (store.groupingWarning(); as warn) {
        <div class="banner warn" role="status" data-testid="grouping-warning">
          <span class="dse-icon">warning_amber</span><span>{{ warn }}</span>
        </div>
      }

      <div class="panes">
        <nav class="topics" aria-label="Topics">
          @if (store.visibleTopics(); as vm) {
            @if (vm.mode === 'grouped') {
              @for (sec of vm.sections; track sec.name) {
                <div class="section-name" data-testid="section-name">{{ sec.name }}</div>
                @for (t of sec.topics; track t.number) {
                  <ng-container *ngTemplateOutlet="topicRow; context: { $implicit: t }" />
                }
              } @empty {
                @if (!store.loading() && !store.error()) {
                  <div class="empty" data-testid="empty-state">{{ emptyCopy() }}</div>
                }
              }
            } @else {
              @for (t of vm.topics; track t.number) {
                <ng-container *ngTemplateOutlet="topicRow; context: { $implicit: t }" />
              } @empty {
                @if (!store.loading() && !store.error()) {
                  <div class="empty" data-testid="empty-state">{{ emptyCopy() }}</div>
                }
              }
            }
          }
          <ng-template #topicRow let-t>
            <button type="button" class="topic-row"
              [class.selected]="store.selectedTopicNumber() === t.number"
              [class.closed]="t.closed"
              [attr.aria-current]="store.selectedTopicNumber() === t.number ? 'true' : null"
              [attr.data-testid]="'topic-' + t.number"
              (click)="store.selectTopic(t.number)"
            >
              <span class="num">#{{ t.number }}</span>
              <span class="t-title">{{ stripTopicPrefix(t.title) }}</span>
              @if (t.stageLabel) {
                <span class="chip stage" [attr.data-stage]="ordinal(t.stageLabel)"
                  data-testid="topic-stage-chip">{{ t.stageLabel }}</span>
              }
            </button>
          </ng-template>
          <ng-template #treeActions>
            <div class="tree-actions">
              <button class="ds-btn" type="button" data-testid="expand-all" (click)="store.expandAll()">Expand all</button>
              <button class="ds-btn" type="button" data-testid="collapse-all" (click)="store.collapseAll()">Collapse all</button>
            </div>
          </ng-template>
        </nav>

        <section class="tree-pane" aria-label="Topic tree">
          @if (store.showAllTopics()) {
            <div class="tree-head">
              <span class="tree-topic">All topics</span>
              <ng-container *ngTemplateOutlet="treeActions" />
            </div>
            @for (sec of store.allSectionsRows(); track sec.name) {
              <div class="section-name" [attr.data-testid]="'allsec-' + sec.name">{{ sec.name }}</div>
              <app-topic-viewer-tree [rows]="sec.rows" />
            } @empty {
              @if (!store.loading() && !store.error()) {
                <div class="empty" data-testid="all-topics-empty">
                  <span class="dse-icon">account_tree</span>
                  <span>{{ emptyCopy() }}</span>
                </div>
              }
            }
          } @else if (store.selectedTopic(); as sel) {
            <div class="tree-head">
              <a class="tree-topic" [href]="sel.url" target="_blank" rel="noopener noreferrer"
                data-testid="tree-topic-link"
              >#{{ sel.number }} {{ sel.title }}</a>
              <ng-container *ngTemplateOutlet="treeActions" />
            </div>
            <app-topic-viewer-tree />
          } @else {
            <div class="empty" data-testid="tree-empty">
              <span class="dse-icon">account_tree</span>
              <span>Select a Topic to view its lifecycle tree</span>
            </div>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    @use './stage-chips' as sc;
    .page { display: flex; flex-direction: column; gap: 8px; padding: 12px; height: 100%; box-sizing: border-box; }
    .header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .repo-picker { width: 180px; }
    .search { width: 220px; }
    .dim { color: var(--mat-sys-on-surface-variant); font-size: 0.8rem; }
    .banner {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 6px; font-size: 0.85rem;
    }
    .banner .dse-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .banner.error { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
    .banner.warn { background: var(--ds-warning-container); color: var(--ds-on-warning-container); }
    .panes { display: flex; gap: 16px; flex: 1; min-height: 0; }
    .topics {
      flex: 0 0 430px; min-width: 360px; overflow-y: auto;
      border-right: 1px solid var(--mat-sys-outline-variant); padding-right: 8px;
    }
    .section-name {
      font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mat-sys-on-surface-variant);
      margin: 14px 0 4px; padding-bottom: 3px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .topic-row {
      display: flex; align-items: center; gap: 6px; width: 100%;
      border: 0; background: none; padding: 6px 8px; border-radius: 4px;
      font: inherit; font-size: 0.85rem; text-align: left; cursor: pointer;
      color: var(--mat-sys-on-surface, inherit);
    }
    .topic-row:hover { background: var(--mat-sys-surface-variant); }
    .topic-row.selected {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container, inherit);
    }
    .topic-row.closed { opacity: 0.55; font-style: italic; }
    .num { color: var(--mat-sys-on-surface-variant); font-variant-numeric: tabular-nums; flex: none; }
    .t-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    /* Stage chip (#1532) — the tree's pale-bg/dark-text chip idiom,
       full label text; palette shared via _stage-chips.scss. */
    .chip.stage {
      font-size: 0.65rem; padding: 1px 6px; border-radius: 8px; flex: none;
      @include sc.stage-chip-palette;
    }
    .tree-pane { flex: 1; overflow: auto; min-width: 0; }
    .tree-head {
      display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
      margin-bottom: 8px; padding-bottom: 6px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .tree-topic {
      font-size: 1rem; font-weight: 600; color: var(--mat-sys-on-surface, inherit);
      text-decoration: none;
    }
    .tree-topic:hover { color: var(--mat-sys-primary); text-decoration: underline; }
    .tree-actions { display: flex; gap: 4px; }
    .empty {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      color: var(--mat-sys-on-surface-variant); font-size: 0.9rem; padding: 32px 8px;
    }
    .empty .dse-icon { font-size: 22px; width: 22px; height: 22px; opacity: 0.6; }
  `],
})
export class TopicViewerPageComponent implements OnInit {
  protected readonly store = inject(TopicViewerStore);

  protected readonly ordinal = stageOrdinal;

  /** Empty-state copy — a filter-empty pane should say so, not claim
   *  the repo has no Topics (review M2). */
  protected emptyCopy(): string {
    const q = this.store.query().trim();
    return q ? `No topics match "${q}"` : 'No Topics found in this repo';
  }

  /** Issue titles carry a "Topic:" prefix — every row here is one, so the
   *  prefix is pure noise in the side list. */
  protected stripTopicPrefix(title: string): string {
    return title.replace(/^topic\s*[:\-–—]\s*/i, '');
  }

  ngOnInit(): void {
    // Refetch on entry when nothing is cached — a persisted failure
    // retries on next nav (self-healing; a hard-down callable shows the
    // banner). A concurrent in-flight fetch is superseded by fetchSeq.
    if (!this.store.response() && !this.store.loading()) {
      void this.store.refresh();
    }
  }
}
