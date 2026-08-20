/**
 * List view for strategy instances. Shows a table with lifecycle badges and
 * action buttons per row. Delegates all state to StrategyBuilderStore.
 * Create/edit is done via a dialog instead of a separate route.
 */
import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { StrategyBuilderStore } from '../../stores/strategy-builder.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { LifecycleState } from '@options-strategy-engine/contracts';
import { StrategyBuilderFormComponent } from './strategy-builder-form.component';

@Component({
  selector: 'app-strategy-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './strategy-builder.component.html',
  styleUrl: './strategy-builder.component.scss',
})
export class StrategyBuilderComponent implements OnInit {
  readonly store = inject(StrategyBuilderStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly appRoutes = AppRoutes;
  protected readonly lifecycleState = LifecycleState;

  ngOnInit(): void {
    this.store.load();
  }

  /** Comma-separated exit policy names for display. */
  exitPolicyNames(instance: StrategyInstanceConfig): string {
    return instance.exitPolicies.map((p) => p.policy).join(', ');
  }

  /** First phase's spread type for display (single-phase strategies use phases[0]). */
  spreadType(instance: StrategyInstanceConfig): string {
    return instance.phases[0]?.spreadType ?? '—';
  }

  /** First phase's target delta for display. */
  targetDelta(instance: StrategyInstanceConfig): string {
    const delta = instance.phases[0]?.targetDelta;
    return delta != null ? delta.toFixed(2) : '—';
  }

  /** Open the create dialog. */
  createNew(): void {
    this.store.clearSelection();
    this.dialog.open(StrategyBuilderFormComponent, {
      data: { instance: null },
      width: '720px',
      maxWidth: '95vw',
    });
  }

  /** Open the edit dialog for an instance. */
  edit(instance: StrategyInstanceConfig): void {
    this.dialog.open(StrategyBuilderFormComponent, {
      data: { instance },
      width: '720px',
      maxWidth: '95vw',
    });
  }

  /** Cycle the lifecycle state of an instance. */
  toggleLifecycle(instance: StrategyInstanceConfig): void {
    this.store.toggleLifecycle(instance.id);
  }

  /** Soft-delete an instance. */
  delete(instance: StrategyInstanceConfig): void {
    this.store.remove(instance.id);
  }

  /** Navigate to the options strategy dashboard filtered by this instance. */
  viewInDashboard(instance: StrategyInstanceConfig): void {
    this.router.navigate(['/' + AppRoutes.OPTIONS_STRATEGY_DASHBOARD], {
      queryParams: { instance: instance.id },
    });
  }
}
