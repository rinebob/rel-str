/**
 * RH Agent Dashboard Component
 *
 * UI for viewing agent status, triggering manual runs, and displaying trade signal history.
 */
import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatListModule } from '@angular/material/list';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Subject, takeUntil } from 'rxjs';

import {
  RhAgentService,
  RhAgentStatus,
  RhAgentRun,
  RhTradeSignal,
} from './rh-agent.service';

@Component({
  selector: 'app-rh-agent-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatBadgeModule,
    MatListModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatSlideToggleModule,
  ],
  template: `
    <div class="rh-agent-dashboard">
      <!-- Header -->
      <div class="dashboard-header">
        <h1>
          <mat-icon>smart_toy</mat-icon>
          RH Agent Dashboard
          <mat-chip-option
            [selected]="status?.isEnabled"
            [color]="status?.isEnabled ? 'accent' : 'warn'"
          >
            {{ status?.isEnabled ? 'Enabled' : 'Disabled' }}
          </mat-chip-option>
        </h1>
        <div class="actions">
          <button
            mat-raised-button
            color="primary"
            (click)="triggerManualRun()"
            [disabled]="isLoading"
            matTooltip="Trigger a manual agent run"
          >
            <mat-icon>play_arrow</mat-icon>
            Run Now
          </button>
          <button
            mat-stroked-button
            (click)="refreshData()"
            [disabled]="isLoading"
          >
            <mat-icon>refresh</mat-icon>
            Refresh
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading" class="loading-overlay">
        <mat-spinner diameter="40"></mat-spinner>
        <span>Processing...</span>
      </div>

      <!-- Status Cards -->
      <div class="status-grid" *ngIf="status">
        <mat-card class="status-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>schedule</mat-icon>
            <mat-card-title>Last Run</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="status-value">
              {{ status.lastRunAt ? (status.lastRunAt | date : 'short') : 'Never' }}
            </p>
            <p class="status-label" *ngIf="status.lastRunStatus">
              Status:
              <span [class]="'status-' + status.lastRunStatus.toLowerCase()">
                {{ status.lastRunStatus }}
              </span>
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card class="status-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>analytics</mat-icon>
            <mat-card-title>Total Runs</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="status-value">{{ status.totalRuns }}</p>
          </mat-card-content>
        </mat-card>

        <mat-card class="status-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>notifications</mat-icon>
            <mat-card-title>Total Signals</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="status-value">{{ status.totalSignalsGenerated }}</p>
          </mat-card-content>
        </mat-card>

        <mat-card class="status-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>repeat</mat-icon>
            <mat-card-title>Schedule</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="status-value">{{ status.schedule || 'Not set' }}</p>
            <p class="status-label">
              Symbols: {{ status.symbolsMonitored.length || 0 }}
            </p>
          </mat-card-content>
        </mat-card>
      </div>

      <!-- Monitored Symbols -->
      <mat-card class="symbols-card" *ngIf="status && status.symbolsMonitored.length">
        <mat-card-header>
          <mat-icon mat-card-avatar>visibility</mat-icon>
          <mat-card-title>Monitored Symbols</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <mat-chip-listbox>
            <mat-chip-option
              *ngFor="let symbol of status.symbolsMonitored"
              color="primary"
            >
              {{ symbol }}
            </mat-chip-option>
          </mat-chip-listbox>
        </mat-card-content>
      </mat-card>

      <!-- Recent Runs -->
      <mat-card class="runs-card">
        <mat-card-header>
          <mat-icon mat-card-avatar>history</mat-icon>
          <mat-card-title>Recent Runs</mat-card-title>
          <span mat-card-subtitle>{{ runs.length }} runs</span>
        </mat-card-header>
        <mat-card-content>
          <mat-accordion *ngIf="runs.length > 0">
            <mat-expansion-panel *ngFor="let run of runs" hideToggle>
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <mat-icon
                    [color]="getRunStatusColor(run.status)"
                    class="run-status-icon"
                  >
                    {{ getRunStatusIcon(run.status) }}
                  </mat-icon>
                  {{ run.strategy || run.marketDate || 'Daily Run' }}
                </mat-panel-title>
                <mat-panel-description>
                  {{ run.startedAt | date : 'short' }}
                  <span class="run-stats">
                    {{ run.symbolsProcessed || run.processedCount || 0 }} / {{ run.totalSymbols || 0 }} symbols,
                    {{ run.signalsGenerated || run.opportunitiesFound || 0 }} signals
                  </span>
                </mat-panel-description>
              </mat-expansion-panel-header>

              <div class="run-details">
                <p><strong>Run ID:</strong> {{ run.id }}</p>
                <p><strong>Status:</strong> {{ run.status }}</p>
                <p><strong>Started:</strong> {{ run.startedAt | date : 'medium' }}</p>
                <p *ngIf="run.completedAt">
                  <strong>Completed:</strong> {{ run.completedAt | date : 'medium' }}
                </p>
                <p *ngIf="run.summary"><strong>Summary:</strong> {{ run.summary }}</p>

                <!-- Signals for this run -->
                <div class="run-signals" *ngIf="getSignalsForRun(run.id).length > 0">
                  <h4>Signals Generated</h4>
                  <mat-list>
                    <mat-list-item *ngFor="let signal of getSignalsForRun(run.id)">
                      <mat-icon matListItemIcon [class]="'action-' + signal.action.toLowerCase()">
                        {{ getActionIcon(signal.action) }}
                      </mat-icon>
                      <div matListItemTitle>{{ signal.symbol }} - {{ signal.action }}</div>
                      <div matListItemLine>{{ signal.reason }}</div>
                      <div matListItemMeta>
                        <mat-chip-option *ngIf="signal.dryRun" size="small" color="warn">
                          DRY RUN
                        </mat-chip-option>
                      </div>
                    </mat-list-item>
                  </mat-list>
                </div>
              </div>
            </mat-expansion-panel>
          </mat-accordion>

          <div *ngIf="runs.length === 0" class="empty-state">
            <mat-icon>inbox</mat-icon>
            <p>No runs yet</p>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Recent Signals -->
      <mat-card class="signals-card">
        <mat-card-header>
          <mat-icon mat-card-avatar>notifications_active</mat-icon>
          <mat-card-title>Recent Trade Signals</mat-card-title>
          <span mat-card-subtitle>{{ signals.length }} signals</span>
        </mat-card-header>
        <mat-card-content>
          <mat-list *ngIf="signals.length > 0">
            <mat-list-item *ngFor="let signal of signals.slice(0, 10)">
              <mat-icon
                matListItemIcon
                [class]="'action-' + signal.action.toLowerCase()"
              >
                {{ getActionIcon(signal.action) }}
              </mat-icon>
              <div matListItemTitle>
                {{ signal.symbol }} - {{ signal.action }}
                <span class="signal-status" [class]="'status-' + signal.status.toLowerCase()">
                  {{ signal.status }}
                </span>
              </div>
              <div matListItemLine>{{ signal.reason }}</div>
              <div matListItemMeta>
                <small>{{ signal.createdAt | date : 'short' }}</small>
                <mat-chip-option *ngIf="signal.dryRun" size="small" color="warn">
                  DRY
                </mat-chip-option>
              </div>
            </mat-list-item>
          </mat-list>

          <div *ngIf="signals.length === 0" class="empty-state">
            <mat-icon>inbox</mat-icon>
            <p>No signals yet</p>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .rh-agent-dashboard {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;

      h1 {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
        }
      }

      .actions {
        display: flex;
        gap: 12px;
      }
    }

    .loading-overlay {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 48px;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 8px;
      margin-bottom: 24px;
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .status-card {
      mat-card-content {
        padding-top: 16px;
      }

      .status-value {
        font-size: 24px;
        font-weight: 500;
        margin: 0 0 8px 0;
      }

      .status-label {
        color: var(--mat-sys-on-surface-variant);
        margin: 0;
        font-size: 14px;
      }
    }

    .symbols-card,
    .runs-card,
    .signals-card {
      margin-bottom: 24px;
    }

    .run-status-icon {
      margin-right: 8px;
    }

    .run-stats {
      margin-left: auto;
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }

    .run-details {
      padding: 16px;
      background: var(--mat-sys-surface-container);
      border-radius: 8px;

      p {
        margin: 8px 0;
      }
    }

    .run-signals {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--mat-sys-outline-variant);

      h4 {
        margin: 0 0 12px 0;
      }
    }

    .signal-status {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 12px;
      margin-left: 8px;
      font-weight: 500;
    }

    .action-buy {
      color: var(--mat-sys-success);
    }

    .action-sell {
      color: var(--mat-sys-error);
    }

    .action-hold {
      color: var(--mat-sys-on-surface-variant);
    }

    .status-success {
      color: var(--mat-sys-success);
    }

    .status-failed {
      color: var(--mat-sys-error);
    }

    .status-running {
      color: var(--mat-sys-primary);
    }

    .status-pending {
      color: var(--mat-sys-on-surface-variant);
    }

    .status-partial {
      color: var(--mat-sys-tertiary);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 48px;
      color: var(--mat-sys-on-surface-variant);

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
      }
    }

    mat-chip-listbox {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
})
export class RhAgentDashboardComponent implements OnInit, OnDestroy {
  private rhAgentService = inject(RhAgentService);
  private snackBar = inject(MatSnackBar);
  private destroy$ = new Subject<void>();

  status: RhAgentStatus | null = null;
  runs: RhAgentRun[] = [];
  signals: RhTradeSignal[] = [];
  signalsByRun = new Map<string, RhTradeSignal[]>();
  isLoading = false;

  ngOnInit(): void {
    this.refreshData();

    // NOTE: Realtime subscriptions disabled - they query different collections than our API
    // and were overwriting valid data with empty arrays. Using API calls only for now.
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refreshData(): void {
    this.isLoading = true;
    let completedCalls = 0;
    const totalCalls = 3;

    const checkComplete = () => {
      completedCalls++;
      if (completedCalls >= totalCalls) {
        this.isLoading = false;
      }
    };

    // Get status
    this.rhAgentService
      .getStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (status) => {
          this.status = status;
        },
        error: (err) => {
          this.snackBar.open('Failed to load status', 'Dismiss', { duration: 5000 });
          console.error(err);
        },
        complete: checkComplete,
      });

    // Get run history
    this.rhAgentService
      .getRunHistory(20)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (runs) => {
          this.runs = runs;
          // Generate shim signals if no signals exist (for UI testing)
          if (this.signals.length === 0 && this.runs.length > 0) {
            this.generateShimSignals();
          }
        },
        error: (err) => {
          this.snackBar.open('Failed to load runs', 'Dismiss', { duration: 5000 });
          console.error(err);
        },
        complete: checkComplete,
      });

    // Get signal history
    this.rhAgentService
      .getSignalHistory(50)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (signals) => {
          this.signals = signals;
          // If no real signals, generate shim ones for testing
          if (this.signals.length === 0 && this.runs.length > 0) {
            this.generateShimSignals();
          }
        },
        error: (err) => {
          console.error('Failed to load signals', err);
        },
        complete: checkComplete,
      });
  }

  /**
   * Generate fake/shim signals for UI testing.
   * Creates a BUY signal for every 3rd symbol from the monitored symbols list.
   */
  private generateShimSignals(): void {
    if (!this.status?.symbolsMonitored?.length) return;

    const shimSignals: RhTradeSignal[] = [];
    const symbols = this.status.symbolsMonitored;
    const now = new Date().toISOString();

    // Get the most recent run ID or use a placeholder
    const runId = this.runs.length > 0 ? this.runs[0].id : 'shim-run';

    // Create a signal for every 3rd symbol
    for (let i = 2; i < symbols.length; i += 3) {
      const symbol = symbols[i];
      const shimSignal: RhTradeSignal = {
        id: `shim-${symbol}-${Date.now()}`,
        runId: runId,
        symbol: symbol,
        action: 'BUY',
        status: 'PENDING',
        reason: `[SHIM] RSI oversold (28.5) with -2.3% price drop. Potential bounce opportunity.`,
        createdAt: now,
        confidence: 85,
        signalType: 'RSI_OVERSOLD',
        indicators: {
          rsi: 28.5,
          priceChange: -0.023,
          currentPrice: 150.0 + Math.random() * 100,
        },
      };
      shimSignals.push(shimSignal);
    }

    this.signals = shimSignals;

    // Group by run
    this.signalsByRun.clear();
    for (const signal of this.signals) {
      const existing = this.signalsByRun.get(signal.runId) || [];
      existing.push(signal);
      this.signalsByRun.set(signal.runId, existing);
    }

    this.snackBar.open(
      `Generated ${shimSignals.length} shim signals for UI testing`,
      'Dismiss',
      { duration: 3000 }
    );
  }

  triggerManualRun(): void {
    this.isLoading = true;
    this.rhAgentService
      .triggerManualRun({ dryRun: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.snackBar.open(
            `Run completed: ${result.message}`,
            'Dismiss',
            { duration: 5000 }
          );
          this.refreshData();
        },
        error: (err) => {
          this.snackBar.open(
            `Run failed: ${err.message}`,
            'Dismiss',
            { duration: 5000 }
          );
          this.isLoading = false;
        },
      });
  }

  getSignalsForRun(runId: string): RhTradeSignal[] {
    return this.signalsByRun.get(runId) || [];
  }

  getRunStatusColor(status: string): string {
    switch (status.toLowerCase()) {
      case 'success':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'primary';
      case 'partial':
        return 'accent';
      default:
        return '';
    }
  }

  getRunStatusIcon(status: string): string {
    switch (status.toLowerCase()) {
      case 'success':
        return 'check_circle';
      case 'failed':
        return 'error';
      case 'running':
        return 'pending';
      case 'partial':
        return 'warning';
      default:
        return 'help';
    }
  }

  getActionIcon(action: string): string {
    switch (action.toLowerCase()) {
      case 'buy':
        return 'trending_up';
      case 'sell':
        return 'trending_down';
      case 'hold':
        return 'remove_circle';
      default:
        return 'help';
    }
  }
}
