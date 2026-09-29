/**
 * LifecyclePageComponent — master-detail read-only GitHub issue-lifecycle
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { LifecycleStore } from './lifecycle.store';
import { LifecycleTreeComponent } from './lifecycle-tree.component';

@Component({
  selector: 'app-lifecycle-page',
  imports: [
    MatButtonModule, MatCheckboxModule, MatFormFieldModule,
    MatProgressSpinnerModule, MatSelectModule,
    LifecycleTreeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="lifecycle-page">
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
        <div class="banner error" role="alert" data-testid="error-banner">{{ err }}</div>
      }
      @if (store.groupingWarning(); as warn) {
        <div class="banner warn" role="status" data-testid="grouping-warning">{{ warn }}</div>
      }

      <div class="panes">
        <nav class="topics" aria-label="Topics">
          @for (sec of store.topicSections(); track sec.name) {
            <div class="section-name" data-testid="section-name">{{ sec.name }}</div>
            @for (t of sec.topics; track t.number) {
              <button type="button" class="topic-row"
                [class.selected]="store.selectedTopicNumber() === t.number"
                [class.closed]="t.closed"
                [attr.data-testid]="'topic-' + t.number"
                (click)="store.selectTopic(t.number)"
              >
                <span class="num">#{{ t.number }}</span>
                <span class="t-title">{{ t.title }}</span>
                @if (t.stageLabel) { <span class="chip stage">{{ t.stageLabel }}</span> }
                @if (t.status) { <span class="chip status">{{ t.status }}</span> }
              </button>
            }
          } @empty {
            @if (!store.loading() && !store.error()) {
              <div class="empty" data-testid="empty-state">No Topics found in this repo</div>
            }
          }
        </nav>

        <section class="tree-pane" aria-label="Topic tree">
          @if (store.selectedTopic()) {
            <div class="tree-actions">
              <button mat-button type="button" data-testid="expand-all" (click)="store.expandAll()">Expand all</button>
              <button mat-button type="button" data-testid="collapse-all" (click)="store.collapseAll()">Collapse all</button>
            </div>
            <app-lifecycle-tree />
          } @else {
            <div class="empty" data-testid="tree-empty">Select a Topic to view its lifecycle tree</div>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 8px; padding: 12px; height: 100%; box-sizing: border-box; }
    .header { display: flex; align-items: center; gap: 12px; }
    .repo-picker { width: 180px; }
    .dim { color: #888; font-size: 0.8rem; }
    .banner { padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; }
    .banner.error { background: #ffebee; color: #b71c1c; }
    .banner.warn { background: #fff8e1; color: #8d6e00; }
    .panes { display: flex; gap: 16px; flex: 1; min-height: 0; }
    .topics { width: 320px; overflow-y: auto; border-right: 1px solid #eee; padding-right: 8px; }
    .section-name { font-size: 0.7rem; text-transform: uppercase; color: #777; margin: 12px 0 4px; }
    .topic-row {
      display: flex; align-items: center; gap: 6px; width: 100%;
      border: 0; background: none; padding: 5px 6px; border-radius: 4px;
      font: inherit; font-size: 0.85rem; text-align: left; cursor: pointer;
    }
    .topic-row:hover { background: #f5f5f5; }
    .topic-row.selected { background: #e3f2fd; }
    .topic-row.closed { opacity: 0.55; font-style: italic; }
    .num { color: #888; font-variant-numeric: tabular-nums; }
    .t-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .chip { font-size: 0.65rem; padding: 1px 6px; border-radius: 8px; background: #e3f2fd; color: #1565c0; }
    .chip.status { background: #fff8e1; color: #8d6e00; }
    .tree-pane { flex: 1; overflow-y: auto; min-width: 0; }
    .tree-actions { display: flex; gap: 4px; margin-bottom: 6px; }
    .empty { color: #999; font-size: 0.85rem; padding: 24px 8px; }
  `],
})
export class LifecyclePageComponent implements OnInit {
  protected readonly store = inject(LifecycleStore);

  ngOnInit(): void {
    // Refetch on entry when nothing is cached — a persisted failure
    // retries on next nav (self-healing; a hard-down callable shows the
    // banner). A concurrent in-flight fetch is superseded by fetchSeq.
    if (!this.store.response() && !this.store.loading()) {
      void this.store.refresh();
    }
  }
}
