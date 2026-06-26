/**
 * RH Agent Triage Report Component
 *
 * Lists all PACR decisions from Firestore with filtering by date
 * range and status. Supports CSV export.
 *
 * URL: /rh-agent-triage-report
 */
import {
  Component,
  inject,
  OnInit,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';

import { RhAgentTriageService, RhTriageDecision } from './rh-agent-triage.service';
import { RhReviewStatus, ALL_REVIEW_STATUSES, StatusCounts } from './common/rh-agent.constants';
import { UiStateService } from '../../core/services/ui-state.service';

@Component({
  selector: 'app-rh-agent-triage-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatTableModule,
  ],
  templateUrl: './rh-agent-triage-report.component.html',
  styleUrl: './rh-agent-triage-report.component.scss',
})
export class RhAgentTriageReportComponent implements OnInit {
  readonly triageService = inject(RhAgentTriageService);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  readonly allStatuses = ALL_REVIEW_STATUSES;
  readonly displayedColumns = ['date', 'symbol', 'status', 'source', 'notes'];

  /** Start of date range (defaults to 30 days ago). */
  readonly startDate = signal<Date>(this.daysAgo(30));
  /** End of date range (defaults to today). */
  readonly endDate = signal<Date>(this.today());
  /** Selected status filter (empty = all). */
  readonly selectedStatuses = signal<Set<RhReviewStatus>>(new Set());
  /** Loading state. */
  readonly loading = signal(false);
  /** Error message. */
  readonly error = signal<string | null>(null);
  /** Raw decisions loaded from Firestore. */
  readonly decisions = signal<RhTriageDecision[]>([]);

  /** Decisions filtered by selected status. */
  readonly filteredDecisions = computed(() => {
    const selected = this.selectedStatuses();
    if (selected.size === 0) return this.decisions();
    return this.decisions().filter((d) => selected.has(d.status));
  });

  /** Count of decisions per status. */
  readonly statusCounts = computed((): StatusCounts => {
    const counts: StatusCounts = {
      PENDING: 0,
      PROMOTE: 0,
      ACCEPT: 0,
      CONSIDER: 0,
      REJECT: 0,
      EXCLUDE: 0,
      LOW_TRADABILITY: 0,
      WATCH: 0,
      ELEVATE: 0,
    };
    for (const d of this.decisions()) {
      counts[d.status] = (counts[d.status] ?? 0) + 1;
    }
    return counts;
  });

  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.loadDecisions();
  }

  loadDecisions(): void {
    this.loading.set(true);
    this.error.set(null);

    this.triageService
      .loadDecisionsForDateRange(this.toIsoDate(this.startDate()), this.toIsoDate(this.endDate()))
      .subscribe({
        next: (decisions) => {
          this.decisions.set(decisions);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[TriageReport] Failed to load decisions:', err);
          this.error.set(err?.message ?? 'Failed to load decisions');
          this.loading.set(false);
        },
      });
  }

  toggleStatus(status: RhReviewStatus): void {
    const next = new Set(this.selectedStatuses());
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    this.selectedStatuses.set(next);
  }

  isStatusSelected(status: RhReviewStatus): boolean {
    return this.selectedStatuses().has(status);
  }

  countForStatus(status: RhReviewStatus): number {
    return this.statusCounts()[status] ?? 0;
  }

  cssClassForStatus(status: RhReviewStatus): string {
    return status.toLowerCase().replace('_', '-');
  }

  onStartDateChange(value: Date | null): void {
    if (!value) return;
    this.startDate.set(value);
    this.loadDecisions();
  }

  onEndDateChange(value: Date | null): void {
    if (!value) return;
    this.endDate.set(value);
    this.loadDecisions();
  }

  exportCsv(): void {
    const rows = this.filteredDecisions();
    const headers = ['date', 'symbol', 'status', 'source', 'notes', 'userId'];
    const lines = [
      headers.join(','),
      ...rows.map((d) =>
        [
          d.date,
          d.symbol,
          d.status,
          d.source ?? '',
          this.escapeCsv(d.notes ?? ''),
          d.userId ?? '',
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `triage-report-${this.toIsoDate(this.startDate())}-to-${this.toIsoDate(this.endDate())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  goBack(): void {
    this.router.navigate(['/rh-agent-grouped-review']);
  }

  private today(): Date {
    return new Date();
  }

  private daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  private toIsoDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
