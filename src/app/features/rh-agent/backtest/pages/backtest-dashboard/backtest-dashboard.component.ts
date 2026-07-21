/**
 * Backtest Dashboard Component
 *
 * Phase 1 shell for the RH Agent strategy backtest run management UI.
 * Loads the strategy list on init and renders a placeholder layout for
 * future phases.
 */
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { toSignal } from '@angular/core/rxjs-interop';

import { BacktestRunService } from '../../services/backtest-run.service';

@Component({
  selector: 'app-backtest-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './backtest-dashboard.component.html',
  styleUrl: './backtest-dashboard.component.scss',
})
export class BacktestDashboardComponent {
  private readonly backtestService = inject(BacktestRunService);

  readonly strategies = toSignal(this.backtestService.listStrategies(), { initialValue: [] });
}
