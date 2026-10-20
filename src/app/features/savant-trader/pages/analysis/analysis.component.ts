/**
 * @topic #553 — Paper Trading Infra | @task #1082
 *
 * Trade Analysis page — the dataset library for the analysis workbench
 * (Thread #1059). Lists analysis-datasets index docs with provenance at
 * a glance (origin badge, params, symbol scope, row count, generated
 * timestamp, status chip), searchable by symbol/name/tag, with inline
 * tags/notes editing, delete confirmation, and the run-config form that
 * enqueues generateTradeDataset. While any entry is 'generating' the
 * library polls until the status flips ready|failed.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AnalysisStore } from '../../stores/analysis.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import {
  matchesDatasetSearch,
  parseTags,
} from '../../utils/analysis-run-config.util';
import {
  AnalysisRunConfigComponent,
  type RunConfigSubmission,
} from './analysis-run-config.component';
import { AnalysisTableComponent } from '../../components/analysis-table/analysis-table.component';
import { AnalysisStatsComponent } from '../../components/analysis-views/analysis-stats.component';
import { AnalysisHistogramComponent } from '../../components/analysis-views/analysis-histogram.component';
import { AnalysisScatterComponent } from '../../components/analysis-views/analysis-scatter.component';
import type {
  AnalysisDatasetDoc,
  AnalysisDatasetStatus,
} from '@paper-trading/analysis';

/** #1084 — workbench panes. */
const WORKBENCH_VIEWS = ['table', 'stats', 'histogram', 'scatter'] as const;
type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    AnalysisRunConfigComponent,
    AnalysisTableComponent,
    AnalysisStatsComponent,
    AnalysisHistogramComponent,
    AnalysisScatterComponent,
  ],
  templateUrl: './analysis.component.html',
  styleUrl: './analysis.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisComponent implements OnInit, OnDestroy {
  protected readonly store = inject(AnalysisStore);
  protected readonly appRoutes = AppRoutes;

  protected readonly search = signal('');
  protected readonly showRunConfig = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editTags = signal('');
  protected readonly editNotes = signal('');
  protected readonly confirmDeleteId = signal<string | null>(null);

  /** #1084 — workbench pane: data grid vs the analysis views. */
  protected readonly workbenchViews = WORKBENCH_VIEWS;
  protected readonly workbenchView = signal<WorkbenchView>('table');

  /** Poll interval while a 'generating' entry exists — the callable
   *  mints the doc instantly, the task flips status seconds later. */
  static readonly REFRESH_INTERVAL_MS = 5000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly filteredDatasets = computed(() =>
    this.store.datasets().filter((d) => matchesDatasetSearch(d, this.search())),
  );

  protected readonly hasGenerating = computed(() =>
    this.store.datasets().some((d) => d.status === 'generating'),
  );

  ngOnInit(): void {
    this.store.loadDatasets();
    this.refreshTimer = setInterval(() => {
      if (this.hasGenerating() && !this.store.isLoadingDatasets()) {
        this.store.loadDatasets();
      }
    }, AnalysisComponent.REFRESH_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  // ── run config ────────────────────────────────────────────────────────

  onGenerate(sub: RunConfigSubmission): void {
    this.store.generateDataset(sub.params, sub.meta);
    this.showRunConfig.set(false);
  }

  // ── per-dataset helpers ───────────────────────────────────────────────

  scopeLabel(d: AnalysisDatasetDoc): string {
    return d.symbolScope.length ? d.symbolScope.join(', ') : 'all symbols';
  }

  typesLabel(d: AnalysisDatasetDoc): string {
    return d.signalTypes.length
      ? `${d.signalTypes.length} signal type${d.signalTypes.length > 1 ? 's' : ''}`
      : 'all signal types';
  }

  statusClass(s: AnalysisDatasetStatus): string {
    return `status-${s}`;
  }

  // ── inline tags/notes edit ────────────────────────────────────────────

  startEdit(d: AnalysisDatasetDoc): void {
    this.editingId.set(d.id);
    this.editTags.set(d.tags.join(', '));
    this.editNotes.set(d.notes ?? '');
  }

  saveMeta(d: AnalysisDatasetDoc): void {
    const notes = this.editNotes().trim();
    this.store.updateTagsNotes(d.id, parseTags(this.editTags()), notes || null);
    this.editingId.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  // ── delete with confirm ───────────────────────────────────────────────

  requestDelete(d: AnalysisDatasetDoc): void {
    this.confirmDeleteId.set(d.id);
  }

  confirmDelete(d: AnalysisDatasetDoc): void {
    this.store.deleteDataset(d);
    this.confirmDeleteId.set(null);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }
}
