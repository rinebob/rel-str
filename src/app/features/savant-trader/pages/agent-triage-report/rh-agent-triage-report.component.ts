/**
 * RH Agent Triage Report Component
 *
 * Lists durable occurrence-level decisions from Firestore with filtering by
 * market-date range and decision type. Supports CSV export.
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

import { UiStateService } from '../../../../core/services/ui-state.service';
import { ReviewDecision } from '../../common/constants';
import { OccurrenceDecisionService } from '../../services/occurrence-decision.service';
import { AgentOccurrenceDecision, DurableDecisionType } from '../../services/types';

type DecisionCounts = Record<DurableDecisionType, number>;

const DURABLE_DECISION_STATUSES: DurableDecisionType[] = [
  ReviewDecision.ACCEPT,
  ReviewDecision.REJECT,
];

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
  readonly occurrenceService = inject(OccurrenceDecisionService);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  readonly allStatuses = DURABLE_DECISION_STATUSES;
  readonly displayedColumns = ['date', 'symbol', 'status', 'source', 'notes'];

  /** Start of date range (defaults to 30 days ago). */
  readonly startDate = signal<Date>(this.daysAgo(30));
  /** End of date range (defaults to today). */
  readonly endDate = signal<Date>(this.today());
  /** Selected status filter (empty = all). */
  readonly selectedStatuses = signal<Set<DurableDecisionType>>(new Set());
  /** Loading state. */
  readonly loading = signal(false);
  /** Error message. */
  readonly error = signal<string | null>(null);
  /** Raw occurrence decisions loaded from Firestore. */
  readonly decisions = signal<AgentOccurrenceDecision[]>([]);

  /** Decisions filtered by selected status. */
  readonly filteredDecisions = computed(() => {
    const selected = this.selectedStatuses();
    if (selected.size === 0) return this.decisions();
    return this.decisions().filter((d) => selected.has(d.decisionType));
  });

  /** Count of decisions per status. */
  readonly statusCounts = computed((): DecisionCounts => {
    const counts = Object.fromEntries(
      DURABLE_DECISION_STATUSES.map((s) => [s, 0])
    ) as DecisionCounts;
    for (const d of this.decisions()) {
      counts[d.decisionType] = (counts[d.decisionType] ?? 0) + 1;
    }
    return counts;
  });

  /** Initialize the page in fullscreen mode and load the initial report. */
  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.loadDecisions();
  }

  /** Load decisions for the current date range from Firestore. */
  loadDecisions(): void {
    this.loading.set(true);
    this.error.set(null);

    this.occurrenceService
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

  /** Toggle inclusion of a status in the filter chips. */
  toggleStatus(status: DurableDecisionType): void {
    const next = new Set(this.selectedStatuses());
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    this.selectedStatuses.set(next);
  }

  /** Whether a status is currently selected in the filter. */
  isStatusSelected(status: DurableDecisionType): boolean {
    return this.selectedStatuses().has(status);
  }

  /** Total decisions for a given status in the loaded range. */
  countForStatus(status: DurableDecisionType): number {
    return this.statusCounts()[status] ?? 0;
  }

  /** CSS class name derived from a status value (e.g., 'reject'). */
  cssClassForStatus(status: DurableDecisionType): string {
    return status.toLowerCase().replace(/_/g, '-');
  }

  /** Update the start date and reload the report. */
  onStartDateChange(value: Date | null): void {
    if (!value) return;
    this.startDate.set(value);
    this.loadDecisions();
  }

  /** Update the end date and reload the report. */
  onEndDateChange(value: Date | null): void {
    if (!value) return;
    this.endDate.set(value);
    this.loadDecisions();
  }

  /** Export the filtered decisions as a CSV download. */
  exportCsv(): void {
    const rows = this.filteredDecisions();
    const headers = ['date', 'symbol', 'status', 'source', 'notes', 'userId'];
    const lines = [
      headers.join(','),
      ...rows.map((d) =>
        [
          d.marketDate,
          d.symbol,
          d.decisionType,
          d.runId ?? '',
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

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }

  /** Return today's local date. */
  private today(): Date {
    return new Date();
  }

  /** Return a date N days ago. */
  private daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  /** Format a date as YYYY-MM-DD in Pacific Time. */
  private toIsoDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
  }

  /** Escape a CSV field if it contains commas, quotes, or newlines. */
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
