/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 *
 * Strategy Manage page (`options/strategy/manage`). F1 skeleton: Paper | Real
 * tabs bound to the store's mode partition, plus a table shell rendering the
 * streamed ManageInstance docs. Columns/actions/dialogs land in F2–F5.
 */
import { Component, ChangeDetectionStrategy, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { StrategyManageStore } from '../../stores/strategy-manage.store';
import type { InstanceMode } from '@manage/instance-contracts';

@Component({
  selector: 'app-strategy-manage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './strategy-manage.component.html',
  styleUrl: './strategy-manage.component.scss',
})
export class StrategyManageComponent implements OnInit {
  readonly store = inject(StrategyManageStore);

  /** Active Paper | Real tab. */
  protected readonly activeTab = signal<InstanceMode>('paper');
  protected readonly tabs: readonly { mode: InstanceMode; label: string }[] = [
    { mode: 'paper', label: 'Paper' },
    { mode: 'real', label: 'Real' },
  ];

  /** Instances for the active tab. */
  protected readonly visibleInstances = computed(() =>
    this.activeTab() === 'paper'
      ? this.store.paperInstances()
      : this.store.realInstances(),
  );

  ngOnInit(): void {
    this.store.load();
  }
}
