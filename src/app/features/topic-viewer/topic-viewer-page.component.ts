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
import { TopicViewerStore, type IssueResolution } from './topic-viewer.store';
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
          [disabled]="store.loading() || store.anyTreeLoading()" (click)="store.refresh()">
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

      @if (store.issueResolution(); as r) {
        <div class="resolution-note" [attr.data-phase]="r.phase" data-testid="resolution-note">
          @if (r.phase === 'resolving') {
            <span class="dse-spinner small" style="--spinner-size: 14px" role="progressbar" aria-label="Resolving issue"></span>
          }
          {{ resolutionCopy(r) }}
        </div>
      }

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
            @if (store.allTopicsDrained()) {
              <div class="banner warn drain-notice" data-testid="drain-notice">
                <span class="dse-icon">error_outline</span>
                <span>Fetching paused — GitHub rate limit reached.</span>
                <button class="dse-button" type="button" data-testid="drain-resume"
                  (click)="store.resumeAllTopics()">Resume</button>
              </div>
            }
            <div class="tree-scroll">
            @for (sec of store.allTopicsSections(); track sec.name) {
              <div class="section-name" [attr.data-testid]="'allsec-' + sec.name">{{ sec.name }}</div>
              @for (b of sec.topics; track b.topic.number) {
                @switch (b.status) {
                  @case ('ready') {
                    <app-topic-viewer-tree [rows]="b.rows" />
                  }
                  @case ('error') {
                    <div class="empty" [attr.data-testid]="'allsec-error-' + b.topic.number">
                      <span class="dse-icon">error_outline</span>
                      <span>#{{ b.topic.number }} — {{ b.error }}</span>
                      <button class="dse-button" type="button"
                        [attr.data-testid]="'allsec-retry-' + b.topic.number"
                        (click)="store.ensureTopic(b.topic.number)">Retry</button>
                    </div>
                  }
                  @default {
                    <div class="empty section-loading" [attr.data-testid]="'allsec-loading-' + b.topic.number">
                      <span class="dse-spinner small" role="progressbar" aria-label="Loading topic tree"></span>
                    </div>
                  }
                }
              }
            } @empty {
              @if (store.anyTreeLoading()) {
                <div class="empty" data-testid="all-topics-loading">
                  <span class="dse-spinner small" role="progressbar" aria-label="Loading topic trees"></span>
                  <span>Fetching topic trees…</span>
                </div>
              } @else if (store.anyTreeError()) {
                <div class="empty" data-testid="all-topics-error">
                  <span class="dse-icon">error_outline</span>
                  <span>Some topic trees failed to load — retry with Refresh</span>
                </div>
              } @else if (!store.loading() && !store.error()) {
                <div class="empty" data-testid="all-topics-empty">
                  <span class="dse-icon">account_tree</span>
                  <span>{{ emptyCopy() }}</span>
                </div>
              }
            }
            </div>
          } @else if (store.selectedTopic(); as sel) {
            <div class="tree-head">
              <a class="tree-topic" [href]="sel.url" target="_blank" rel="noopener noreferrer"
                data-testid="tree-topic-link"
              >#{{ sel.number }} {{ sel.title }}</a>
              <ng-container *ngTemplateOutlet="treeActions" />
            </div>
            <div class="tree-scroll">
              <app-topic-viewer-tree />
            </div>
          } @else if (store.selectedTreeLoading()) {
            <div class="empty topic-state column" data-testid="tree-loading">
              <span class="dse-spinner" style="--spinner-size: 32px" role="progressbar" aria-label="Loading topic tree"></span>
              <span>Loading topic tree…</span>
            </div>
          } @else if (store.selectedTreeError(); as treeErr) {
            <div class="empty" data-testid="tree-error">
              <span class="dse-icon">error_outline</span>
              <span>{{ treeErr }}</span>
              <button class="dse-button" data-testid="tree-error-retry"
                (click)="store.selectTopic(store.selectedTopicNumber()!)">Retry</button>
            </div>
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
    /* Deep-resolution note (#1696) — scoped search-box indicator; the
       phases tint so resolving/ok vs miss/error read instantly. */
    .resolution-note {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.8rem; color: var(--mat-sys-on-surface-variant);
    }
    .resolution-note[data-phase='resolved'] { color: var(--mat-sys-tertiary); }
    .resolution-note[data-phase='not-in-tree'],
    .resolution-note[data-phase='not-found'],
    .resolution-note[data-phase='error'] {
      color: var(--mat-sys-error);
    }
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
    .tree-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .tree-scroll { flex: 1; min-height: 0; overflow: auto; }
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
    .topic-state.column { flex-direction: column; align-items: center; }
    .drain-notice { margin: 8px 0; }
  `],
})
export class TopicViewerPageComponent implements OnInit {
  protected readonly store = inject(TopicViewerStore);

  protected readonly ordinal = stageOrdinal;

  /** Resolution-note copy (#1696) — the store already composes the
   *  honest messages for miss/error phases; resolving/resolved get a
   *  compact synthetic line. */
  protected resolutionCopy(r: IssueResolution): string {
    if (r.phase === 'resolving') return `Resolving #${r.issueNumber}…`;
    if (r.phase === 'resolved') {
      const base = `#${r.issueNumber} found under #${r.rootNumber}`;
      return r.message ? `${base} — ${r.message}` : base;
    }
    return r.message ?? `Issue #${r.issueNumber} couldn't be resolved`;
  }

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
