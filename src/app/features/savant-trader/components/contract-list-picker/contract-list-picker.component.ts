/**
 * Contract List Picker (#1361 — shell).
 *
 * Minimal dialog for the contract-list session: list provenance header
 * (template · symbol · generated · picks/misses · date span) plus a
 * selection readout and a Send that closes with the session's emitted
 * `date,id` lines. FE-3 (#1362) builds the full picker on this file —
 * rows/stepper/lines tabs — the store seam and send path already exist.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DsDialogRef } from '../../../../shared/ds/ds-dialog';

import { ContractListSessionStore } from '../../stores/contract-list-session.store';

@Component({
  selector: 'app-contract-list-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './contract-list-picker.component.html',
  styleUrl: './contract-list-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractListPickerComponent {
  protected readonly dialogRef = inject(DsDialogRef<ContractListPickerComponent, string[]>);
  /** The page-scoped session — resolved from the opener's injector. */
  readonly store = inject(ContractListSessionStore);

  readonly canSend = computed(() => this.store.selectedRows().length > 0);

  /** Emit the selection and hand the lines back to the page — the
   *  afterClosed path writes the textarea + loadPlotted. */
  send(): void {
    if (!this.canSend()) return;
    this.dialogRef.close(this.store.sendSelected());
  }
}
