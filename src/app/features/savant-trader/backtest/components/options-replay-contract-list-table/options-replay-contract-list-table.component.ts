/**
 * Options Replay Contract-List Table
 *
 * Renders one contract-list doc's rows — pick rows in entry-date order
 * with all pick-doc columns, explicit marker rows for `no-selection`
 * days (never omitted), and a ↻ repeat badge where `repeatsPrevious`
 * flags the same contractId as the prior day (each repeat stays its own
 * row). The coverage header derives from `pickDocMeta` — pick/miss
 * counts, date range, gridVersion. Pure presentational — the inspect
 * action is an output; the parent owns the dialog.
 */
import { Component, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TradeSide } from '@common';
import type { ContractListPickRow, NoSelectionReason } from '@options-replay/contracts';
import type { ContractListRow, PickDocMeta } from '../../common/options-replay.types';

/** View row — a pick row verbatim, or a marker row with a resolved label. */
interface TableRow {
  kind: 'pick' | 'no-selection';
  entryDate: string;
  pick?: ContractListPickRow;
  markerLabel?: string;
}

const REASON_LABELS: Record<NoSelectionReason, string> = {
  miss: 'no match',
  gap: 'data gap',
  'out-of-range': 'out of range',
};

function sideLabel(side: TradeSide): string {
  return side === TradeSide.SHORT ? 'STO' : 'BTO';
}

@Component({
  selector: 'app-options-replay-contract-list-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './options-replay-contract-list-table.component.html',
  styleUrl: './options-replay-contract-list-table.component.scss',
})
export class OptionsReplayContractListTableComponent {
  readonly rows = input.required<ContractListRow[]>();
  readonly pickDocMeta = input<PickDocMeta | undefined>(undefined);

  /** Row inspect action — the parent opens the contract-series dialog. */
  readonly inspect = output<ContractListPickRow>();

  readonly sideLabel = sideLabel;

  /** Coverage header text — only on success docs carrying pickDocMeta. */
  readonly coverageText = computed(() => {
    const meta = this.pickDocMeta();
    if (!meta) return null;
    return `${meta.pickCount} picks · ${meta.missCount} misses · ${meta.firstDate} → ${meta.lastDate} · grid v${meta.gridVersion}`;
  });

  /** Rows sorted by entryDate — marker rows keep their place in the sequence. */
  readonly tableRows = computed<TableRow[]>(() =>
    [...this.rows()]
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map((row) =>
        row.kind === 'pick'
          ? { kind: 'pick', entryDate: row.entryDate, pick: row }
          : {
              kind: 'no-selection',
              entryDate: row.entryDate,
              markerLabel: `no selection${row.reason ? ` — ${REASON_LABELS[row.reason] ?? row.reason}` : ''}`,
            }
      )
  );
}
