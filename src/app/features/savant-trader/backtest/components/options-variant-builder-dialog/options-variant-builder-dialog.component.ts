/**
 * Options Variant Builder Dialog (#1504)
 *
 * The shared composition surface for multi-leg replay variants: pick a
 * curated named variant, dial a base template to concrete Δ/DTE values
 * bounded by each leg's bands, or compose legs from scratch. Composition
 * resolves client-side to concrete `legs[]` — the caller decides whether
 * it becomes a run request or form fields (submitLabel via dialog data).
 *
 * Compose state lives in the dialog-scoped VariantBuilderStore; this
 * component is a dumb view over it. Copy JSON emits a paste-ready
 * ReplayVariant registry block for compositions worth keeping.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { DS_DIALOG_DATA, DsDialogRef } from '../../../../../shared/ds/ds-dialog';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import type { OptionLeg, VariantLeg } from '@options-replay/contracts';
import { PICK_GRID_DELTA_BAND, PICK_GRID_DTES } from '@options-replay/contracts';
import { REPLAY_TEMPLATE_SHAPES, REPLAY_VARIANTS } from '@options-replay/templates';

import { VariantBuilderStore, type VariantBuilderMode } from '../../stores/variant-builder.store';
import { deltaOptionsForBand, type ScratchLeg, type VariantBuilderResult } from '../../utils/variant-builder.utils';

export interface VariantBuilderDialogData {
  /** Primary action label — 'Apply' when the result composes back into a
   *  host surface (replay run dialog, strategy form). */
  submitLabel?: string;
}

@Component({
  selector: 'app-options-variant-builder-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [VariantBuilderStore],
  templateUrl: './options-variant-builder-dialog.component.html',
  styleUrl: './options-variant-builder-dialog.component.scss',
})
export class OptionsVariantBuilderDialogComponent {
  private readonly dialogRef = inject<DsDialogRef<OptionsVariantBuilderDialogComponent, VariantBuilderResult | undefined>>(
    DsDialogRef,
  );
  private readonly data = inject<VariantBuilderDialogData>(DS_DIALOG_DATA, { optional: true });

  readonly store = inject(VariantBuilderStore);
  readonly variants = REPLAY_VARIANTS;
  readonly shapes = REPLAY_TEMPLATE_SHAPES;
  readonly submitLabel = this.data?.submitLabel ?? 'Run';

  readonly modes: readonly { id: VariantBuilderMode; label: string }[] = [
    { id: 'named', label: 'Named variant' },
    { id: 'shape', label: 'Base template' },
    { id: 'scratch', label: 'From scratch' },
  ];

  /** Scratch rows dial the full grid — no shape constrains them. */
  readonly scratchDeltaOptions = deltaOptionsForBand(PICK_GRID_DELTA_BAND);
  readonly scratchDteOptions = PICK_GRID_DTES;
  readonly optionTypes = [OptionType.PUT, OptionType.CALL];
  readonly sides = [TradeSide.SHORT, TradeSide.LONG];

  onModeChange(value: string): void {
    this.store.setMode(value as VariantBuilderMode);
  }

  onVariantChange(variantId: string): void {
    this.store.selectVariant(variantId);
  }

  onShapeChange(shapeId: string): void {
    this.store.selectShape(shapeId);
  }

  onDeltaPick(index: number, value: string): void {
    this.store.setDialed(index, { deltaMag: Number(value) });
  }

  onDtePick(index: number, value: string): void {
    this.store.setDialed(index, { dte: Number(value) });
  }

  addScratchLeg(): void {
    this.store.addScratchLeg();
  }

  removeScratchLeg(index: number): void {
    this.store.removeScratchLeg(index);
  }

  updateScratchLeg(index: number, patch: Partial<ScratchLeg>): void {
    this.store.updateScratchLeg(index, patch);
  }

  onVariantName(value: string): void {
    this.store.setVariantName(value);
  }

  onExportId(value: string): void {
    this.store.setExportId(value);
  }

  /** Preview line for one composed leg — e.g. 'SHORT put Δ−0.20 · 45DTE'. */
  legLabel(leg: VariantLeg): string {
    if (leg.kind === 'stock') {
      return `${leg.side.toUpperCase()} stock`;
    }
    const opt = leg as OptionLeg;
    const delta = opt.targetDelta.toFixed(2).replace('-0.', '−0.');
    return `${opt.side.toUpperCase()} ${opt.type} Δ${delta} · ${opt.dte}DTE`;
  }

  /** Copy the export block to the clipboard — the save path for
   *  compositions worth keeping in the registry. */
  copyJson(): void {
    const json = this.store.exportJson();
    if (json) {
      void navigator.clipboard?.writeText(json);
    }
  }

  submit(): void {
    const result = this.store.submitResult();
    if (result) {
      this.dialogRef.close(result);
    }
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
