/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 * @task #1546 — FE: Instance table — columns, sort/filter, position join, start/stop
 *
 * Strategy Manage page (`options/strategy/manage`). F2: Paper | Real tabs
 * bound to the store's mode partition, the full instance table (sortable
 * columns, text/run-state/position filters, open-position join from the
 * store's position map), and the per-row start/stop action that toggles
 * runState via the store. Create/dialog actions land in F3–F5.
 */
import { Component, ChangeDetectionStrategy, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { StrategyManageStore } from '../../stores/strategy-manage.store';
import {
  INSTANCE_RUN_STATES,
  type InstanceMode,
  type InstanceRunState,
  type ManageInstance,
} from '@manage/instance-contracts';
import {
  OPTIONS_POSITION_STATUS_LABELS,
  type OptionsPositionStatus,
  type Position,
} from '../../services/options-strategy.types';

type SortKey =
  | 'id' | 'symbol' | 'variant' | 'stopType' | 'trigger'
  | 'runState' | 'position' | 'created';
type SortDir = 'asc' | 'desc';
type RunStateFilter = 'ALL' | InstanceRunState;
/** The three states the Open Position cell renders. */
type PositionFilter = 'ALL' | 'open' | 'waiting' | 'flat';

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

  /** Column model — the thead iterates this. */
  protected readonly columns: readonly { key: SortKey; label: string }[] = [
    { key: 'id', label: 'Instance ID' },
    { key: 'symbol', label: 'Symbol' },
    { key: 'variant', label: 'Variant' },
    { key: 'stopType', label: 'Stop Type' },
    { key: 'trigger', label: 'Trigger' },
    { key: 'runState', label: 'Run State' },
    { key: 'position', label: 'Open Position' },
    { key: 'created', label: 'Created' },
  ];

  /** Active column sorts, in priority order (paper-trading convention —
   *  plain click replaces the chain; shift+click adds a secondary key). */
  protected readonly sorts = signal<{ key: SortKey; dir: SortDir }[]>([]);

  /** Filter state — text (id/symbol/variant), run state, open-position. */
  protected readonly filterText = signal('');
  protected readonly runStateFilter = signal<RunStateFilter>('ALL');
  protected readonly positionFilter = signal<PositionFilter>('ALL');
  protected readonly runStateOptions: readonly RunStateFilter[] = [
    'ALL', ...INSTANCE_RUN_STATES,
  ];
  protected readonly positionOptions: readonly { value: PositionFilter; label: string }[] = [
    { value: 'ALL', label: 'All positions' },
    { value: 'open', label: 'Open' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'flat', label: 'Flat' },
  ];

  /** Instances for the active tab → filtered → sorted. */
  protected readonly visibleInstances = computed(() => {
    const base = this.activeTab() === 'paper'
      ? this.store.paperInstances()
      : this.store.realInstances();

    const text = this.filterText().trim().toLowerCase();
    const runState = this.runStateFilter();
    const position = this.positionFilter();
    const positions = this.store.openPositionsByInstance();

    const filtered = base.filter((i) => {
      if (text) {
        const hay = `${i.id} ${i.symbol} ${i.variant.name}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      if (runState !== 'ALL' && i.runState !== runState) return false;
      if (position !== 'ALL') {
        const state = this.positionState(i, positions);
        if (state !== position) return false;
      }
      return true;
    });

    const sorts = this.sorts();
    if (!sorts.length) return filtered;
    return [...filtered].sort((a, b) => {
      for (const s of sorts) {
        const cmp = this.sortValue(a, s.key, positions)
          .localeCompare(this.sortValue(b, s.key, positions));
        if (cmp !== 0) return s.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  });

  ngOnInit(): void {
    this.store.load();
  }

  /** The row's position bucket — open if any position is joined, waiting
   *  for an ACTIVE instance still flat at the noon gate, flat otherwise.
   *  Single source for both the filter and the cell label. */
  private positionState(
    i: ManageInstance,
    positions: Record<string, Position[]>,
  ): 'open' | 'waiting' | 'flat' {
    if ((positions[i.id]?.length ?? 0) > 0) return 'open';
    return i.runState === 'ACTIVE' ? 'waiting' : 'flat';
  }

  /** Open-position cell text: `Yes · {status}` (×N when several open
   *  positions join — the engine dedupes per market day, not per
   *  instance — listing each distinct status); `Waiting` for an ACTIVE
   *  instance still flat at the noon gate; `No` otherwise. */
  protected positionLabel(instance: ManageInstance): string {
    const positions = this.store.openPositionsByInstance();
    const state = this.positionState(instance, positions);
    if (state === 'waiting') return 'Waiting';
    if (state === 'flat') return 'No';
    const open = positions[instance.id];
    const count = open.length > 1 ? ` ×${open.length}` : '';
    const statuses = [...new Set(open.map((p) => this.statusLabel(p.status)))]
      .join(' / ');
    return `Yes${count} · ${statuses}`;
  }

  private statusLabel(status: OptionsPositionStatus): string {
    return OPTIONS_POSITION_STATUS_LABELS[status] ?? status;
  }

  /** True when any filter is narrowing the table — changes the empty
   *  state's copy so it doesn't claim "no instances" of filtered rows. */
  protected readonly hasActiveFilters = computed(
    () =>
      this.filterText().trim() !== '' ||
      this.runStateFilter() !== 'ALL' ||
      this.positionFilter() !== 'ALL',
  );

  /** Start/stop action label per run state. */
  protected runActionLabel(instance: ManageInstance): string {
    return instance.runState === 'ACTIVE' ? 'Stop'
      : instance.runState === 'STOPPED' ? 'Restart' : 'Start';
  }

  protected toggleRunState(instance: ManageInstance): void {
    void this.store.toggleRunState(instance);
  }

  /** Created column — ISO date portion of createdAt. */
  protected createdLabel(instance: ManageInstance): string {
    return instance.createdAt?.slice(0, 10) ?? '';
  }

  // ── Sorting (paper-trading convention) ────────────────────────────────────

  /** Click a sortable header: plain click cycles asc → desc → unsorted and
   *  clears other keys; shift+click toggles this key in the multi-sort
   *  chain (same signature/behavior as paper-trading's toggleSort). */
  protected toggleSort(
    key: SortKey,
    ev?: MouseEvent | KeyboardEvent | Event | boolean,
  ): void {
    const additive =
      typeof ev === 'boolean' ? ev
      : ev instanceof MouseEvent || ev instanceof KeyboardEvent ? ev.shiftKey
      : false;
    const cur = this.sorts();
    const i = cur.findIndex((s) => s.key === key);
    if (!additive) {
      this.sorts.set(
        i === -1 ? [{ key, dir: 'asc' }]
        : cur[i].dir === 'asc' ? [{ key, dir: 'desc' }]
        : [],
      );
      return;
    }
    const list = [...cur];
    if (i === -1) list.push({ key, dir: 'asc' });
    else if (list[i].dir === 'asc') list[i] = { key, dir: 'desc' };
    else list.splice(i, 1);
    this.sorts.set(list);
  }

  protected sortIcon(key: SortKey): string {
    const s = this.sorts().find((x) => x.key === key);
    return s ? (s.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : '';
  }

  protected sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sorts().find((x) => x.key === key);
    return s?.dir === 'asc' ? 'ascending' : s?.dir === 'desc' ? 'descending' : 'none';
  }

  /** 1-based priority badge — shown only when multiple sorts are active. */
  protected sortRank(key: SortKey): number | null {
    const list = this.sorts();
    if (list.length < 2) return null;
    const i = list.findIndex((s) => s.key === key);
    return i === -1 ? null : i + 1;
  }

  private sortValue(
    i: ManageInstance,
    key: SortKey,
    positions: Record<string, Position[]>,
  ): string {
    switch (key) {
      case 'id': return i.id;
      case 'symbol': return i.symbol;
      case 'variant': return i.variant.name;
      case 'stopType': return i.stopType;
      case 'trigger': return i.trigger;
      case 'runState': return i.runState;
      case 'position': return String(positions[i.id]?.length ?? 0)
        .padStart(3, '0') + this.positionLabel(i);
      case 'created': return i.createdAt ?? '';
    }
  }
}
