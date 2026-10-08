/**
 * TopicViewerPageComponent — master-detail read-only GitHub issue-lifecycle
 * viewer (Topic #619 / Blueprint #635 / task #643).
 *
 * Header: repo picker, Refresh (spinner while loading), as-of timestamp,
 * Show-closed toggle. Left pane: grouped topic list. Right pane: the
 * selected topic's tree (expand-all / collapse-all). Error banner over a
 * preserved tree; grouping-warning banner when the inventory doc degraded.
 */

import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { stageOrdinal } from '@lifecycle/tree';
import { TopicViewerStore } from './topic-viewer.store';
import { TopicViewerTreeComponent } from './topic-viewer-tree.component';

@Component({
  selector: 'app-topic-viewer-page',
  imports: [
    MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule,
    MatProgressSpinnerModule, MatSelectModule,
    TopicViewerTreeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="topic-viewer-page">
      <header class="header">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="repo-picker">
          <mat-select [value]="store.selectedRepoIndex()" aria-label="Repository"
            data-testid="repo-picker" (selectionChange)="store.selectRepo($event.value)">
            @for (r of store.repos(); track r.repo; let i = $index) {
              <mat-option [value]="i">{{ r.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <button mat-stroked-button type="button" data-testid="refresh"
          [disabled]="store.loading()" (click)="store.refresh()">
          @if (store.loading()) { <mat-spinner diameter="16" /> } Refresh
        </button>
        @if (store.fetchedAt(); as at) {
          <span class="dim" data-testid="fetched-at">as of {{ at }}</span>
        }
        <mat-checkbox [checked]="store.showClosed()" data-testid="show-closed"
          (change)="store.setShowClosed($event.checked)">Show closed</mat-checkbox>
      </header>

      @if (store.error(); as err) {
        <div class="banner error" role="alert" data-testid="error-banner">
          <mat-icon>error_outline</mat-icon><span>{{ err }}</span>
        </div>
      }
      @if (store.groupingWarning(); as warn) {
        <div class="banner warn" role="status" data-testid="grouping-warning">
          <mat-icon>warning_amber</mat-icon><span>{{ warn }}</span>
        </div>
      }

      <div class="panes">
        <nav class="topics" aria-label="Topics">
          @for (sec of store.topicSections(); track sec.name) {
            <div class="section-name" data-testid="section-name">{{ sec.name }}</div>
            @for (t of sec.topics; track t.number) {
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
                  <span class="sr-only">{{ t.stageLabel }}</span>
                  <span class="stage-dot" [attr.data-stage]="ordinal(t.stageLabel)"
                    [attr.title]="t.stageLabel" aria-hidden="true"></span>
                }
              </button>
            }
          } @empty {
            @if (!store.loading() && !store.error()) {
              <div class="empty" data-testid="empty-state">No Topics found in this repo</div>
            }
          }
        </nav>

        <section class="tree-pane" aria-label="Topic tree">
          @if (store.selectedTopic(); as sel) {
            <div class="tree-head">
              <a class="tree-topic" [href]="sel.url" target="_blank" rel="noopener noreferrer"
                data-testid="tree-topic-link"
              >#{{ sel.number }} {{ sel.title }}</a>
              <div class="tree-actions">
                <button mat-button type="button" data-testid="expand-all" (click)="store.expandAll()">Expand all</button>
                <button mat-button type="button" data-testid="collapse-all" (click)="store.collapseAll()">Collapse all</button>
              </div>
            </div>
            <app-topic-viewer-tree />
          } @else {
            <div class="empty" data-testid="tree-empty">
              <mat-icon>account_tree</mat-icon>
              <span>Select a Topic to view its lifecycle tree</span>
            </div>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 8px; padding: 12px; height: 100%; box-sizing: border-box; }
    .header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .repo-picker { width: 180px; }
    .dim { color: var(--mat-sys-on-surface-variant, #888); font-size: 0.8rem; }
    .banner {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; border-radius: 6px; font-size: 0.85rem;
    }
    .banner mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .banner.error { background: var(--mat-sys-error-container, #ffebee); color: var(--mat-sys-on-error-container, #b71c1c); }
    .banner.warn { background: #fff8e1; color: #8d6e00; }
    .panes { display: flex; gap: 16px; flex: 1; min-height: 0; }
    .topics {
      flex: 0 0 430px; min-width: 360px; overflow-y: auto;
      border-right: 1px solid var(--mat-sys-outline-variant, #eee); padding-right: 8px;
    }
    .section-name {
      font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mat-sys-on-surface-variant, #777);
      margin: 14px 0 4px; padding-bottom: 3px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #eee);
    }
    .topic-row {
      display: flex; align-items: center; gap: 6px; width: 100%;
      border: 0; background: none; padding: 6px 8px; border-radius: 4px;
      font: inherit; font-size: 0.85rem; text-align: left; cursor: pointer;
      color: var(--mat-sys-on-surface, inherit);
    }
    .topic-row:hover { background: var(--mat-sys-surface-variant, #f5f5f5); }
    .topic-row.selected {
      background: var(--mat-sys-secondary-container, #e3f2fd);
      color: var(--mat-sys-on-secondary-container, inherit);
    }
    .topic-row.closed { opacity: 0.55; font-style: italic; }
    .num { color: var(--mat-sys-on-surface-variant, #888); font-variant-numeric: tabular-nums; flex: none; }
    .t-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    /* Stage indicator — a dot, not a chip: keeps the title unblocked while
       preserving the lifecycle signal (same stage-ordinal key, mid-tone
       solid palette vs the tree's pale-bg/dark-text chips). */
    .stage-dot {
      width: 9px; height: 9px; border-radius: 50%; flex: none;
      background: var(--mat-sys-outline, #9e9e9e);
    }
    .stage-dot[data-stage="1"] { background: #7e57c2; }
    .stage-dot[data-stage="2"] { background: #5c6bc0; }
    .stage-dot[data-stage="3"] { background: #039be5; }
    .stage-dot[data-stage="4"] { background: #90a4ae; }
    .stage-dot[data-stage="5"] { background: #1e88e5; }
    .stage-dot[data-stage="6"] { background: #fb8c00; }
    .stage-dot[data-stage="7"] { background: #f4511e; }
    .stage-dot[data-stage="8"] { background: #43a047; }
    .tree-pane { flex: 1; overflow: auto; min-width: 0; }
    .tree-head {
      display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap;
      margin-bottom: 8px; padding-bottom: 6px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #eee);
    }
    .tree-topic {
      font-size: 1rem; font-weight: 600; color: var(--mat-sys-on-surface, inherit);
      text-decoration: none;
    }
    .tree-topic:hover { color: var(--mat-sys-primary, #1565c0); text-decoration: underline; }
    .tree-actions { display: flex; gap: 4px; }
    .empty {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      color: var(--mat-sys-on-surface-variant, #999); font-size: 0.9rem; padding: 32px 8px;
    }
    .empty mat-icon { font-size: 22px; width: 22px; height: 22px; opacity: 0.6; }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
  `],
})
export class TopicViewerPageComponent implements OnInit {
  protected readonly store = inject(TopicViewerStore);

  protected readonly ordinal = stageOrdinal;

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
