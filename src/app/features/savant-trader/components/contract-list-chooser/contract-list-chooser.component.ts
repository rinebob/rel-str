/**
 * Contract List Chooser (#1361).
 *
 * Doc-selection dialog for the picker session — the "which list" step
 * before `?list=`/chooser converge on `onContractListDoc`. Lists recent
 * `st-options-contract-lists` docs sorted symbol asc → generatedAt desc,
 * default-filtered to the page's symbol with an All-symbols widen toggle.
 * A row select closes with the converted doc — it's already in hand
 * from `recentLists$`, so the page loads it via `loadListDoc` with no
 * second fetch.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';

import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { ContractListService } from '../../services/contract-list.service';

export interface ContractListChooserData {
  /** Page symbol — the default filter. */
  symbol: string;
}

@Component({
  selector: 'app-contract-list-chooser',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './contract-list-chooser.component.html',
  styleUrl: './contract-list-chooser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractListChooserComponent {
  private readonly svc = inject(ContractListService);
  protected readonly ref = inject(DsDialogRef<ContractListChooserComponent, OptionsContractListUi>);
  readonly data = inject(DS_DIALOG_DATA) as ContractListChooserData;

  /** Widen toggle — off filters to the page symbol. */
  readonly showAll = signal(false);

  private readonly lists = toSignal(this.svc.recentLists$(), {
    initialValue: [] as OptionsContractListUi[],
  });

  /** Sorted symbol asc → generatedAt desc; symbol-filtered unless widened. */
  readonly visibleLists = computed(() => {
    const sorted = [...this.lists()].sort(
      (a, b) =>
        a.symbol.localeCompare(b.symbol) ||
        (b.generatedAtIso ?? '').localeCompare(a.generatedAtIso ?? ''),
    );
    if (this.showAll()) return sorted;
    const sym = (this.data.symbol ?? '').trim().toUpperCase();
    return sorted.filter((l) => l.symbol === sym);
  });

  select(list: OptionsContractListUi): void {
    this.ref.close(list);
  }
}
