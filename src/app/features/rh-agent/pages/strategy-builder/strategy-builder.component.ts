/**
 * @topic #137 — Strategy Builder UI (opened 2026-08-16)
 *
 * List view for strategy instances. Shows a table with lifecycle badges and
 * action buttons per row. Delegates all state to StrategyBuilderStore.
 */
import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { StrategyBuilderStore } from '../../stores/strategy-builder.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { LifecycleState } from '@options-strategy-engine/contracts';

@Component({
  selector: 'app-strategy-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './strategy-builder.component.html',
  styleUrl: './strategy-builder.component.scss',
})
export class StrategyBuilderComponent implements OnInit {
  readonly store = inject(StrategyBuilderStore);
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

  /** Navigate to the create/edit form. */
  createNew(): void {
    this.router.navigate(['/' + AppRoutes.STRATEGY_BUILDER, 'new']);
  }

  /** Select an instance for editing and navigate to the form. */
  edit(instance: StrategyInstanceConfig): void {
    this.store.selectForEdit(instance);
    this.router.navigate(['/' + AppRoutes.STRATEGY_BUILDER, 'edit', instance.id]);
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
