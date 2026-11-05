/**
 * Indicator Config Dialog
 *
 * Shows configurable parameters for a selected indicator type.
 * Returns an IndicatorConfig when confirmed.
 */
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { DS_DIALOG_DATA } from '../../../../shared/ds/ds-dialog';

import type { IndicatorConfig, IndicatorPane, IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';

export interface IndicatorConfigDialogData {
  indicator: IndicatorOption;
  /** Which lower pane slot to assign (auto-assigned by caller) */
  pane: IndicatorPane;
}

// literal-sweep exception #1214: indicator color-picker swatches feed
// chart rendering — literal strings required (#1164 concern).
const INDICATOR_COLORS = ['#ff9800', '#2196f3', '#e91e63', '#4caf50', '#9c27b0'];

@Component({
  selector: 'app-indicator-config-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule,],
  template: `
    <h2 class="title">Configure {{ data.indicator.label }}</h2>
    <div class="content">
      @for (param of data.indicator.params; track param.key) {
        <label class="dse-field param-field">
          <span class="field-label">{{ param.label }}</span>
          <input class="field-input" type="number"
            [(ngModel)]="paramValues[param.key]"
            [min]="param.min"
            [max]="param.max">
          <span class="field-hint">{{ param.min }}–{{ param.max }}</span>
        </label>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn" (click)="dialogRef.close()">Cancel</button>
      <button class="ds-btn fill" (click)="onConfirm()">Add Indicator</button>
    </div>
  `,
  styles: [`
    .content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 280px;
      padding-top: 8px;
    }
    .param-field {
      width: 100%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IndicatorConfigDialogComponent {
  readonly dialogRef = inject(DsDialogRef<IndicatorConfigDialogComponent>);
  readonly data: IndicatorConfigDialogData = inject(DS_DIALOG_DATA);

  paramValues: Record<string, number> = {};

  /** Initialize parameter values from the indicator's defaults. */
  constructor() {
    for (const param of this.data.indicator.params) {
      this.paramValues[param.key] = param.default as number;
    }
  }

  /** Build the IndicatorConfig from the current parameter values and close the dialog. */
  onConfirm(): void {
    const ind = this.data.indicator;
    const paramStr = ind.params.map(p => this.paramValues[p.key]).join(',');
    const colorIndex = Math.abs(hashCode(`${ind.type}-${paramStr}`)) % INDICATOR_COLORS.length;

    const config: IndicatorConfig = {
      id: `${ind.type}-${paramStr}`,
      type: ind.type,
      pane: this.data.pane,
      seriesType: 'line',
      params: { ...this.paramValues },
      options: {
        name: `${ind.type.toUpperCase()}(${paramStr})`,
        color: INDICATOR_COLORS[colorIndex],
        lineWidth: 2,
        axisScale: ind.axisScale,
        ...ind.defaultOptions,
      },
    };

    this.dialogRef.close(config);
  }
}

/** Compute a simple 32-bit hash code for a string. */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
