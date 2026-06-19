/**
 * Indicator Config Dialog
 *
 * Shows configurable parameters for a selected indicator type.
 * Returns an IndicatorConfig when confirmed.
 */
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

import type { IndicatorConfig, IndicatorPane, IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';

export interface IndicatorConfigDialogData {
  indicator: IndicatorOption;
  /** Which lower pane slot to assign (auto-assigned by caller) */
  pane: IndicatorPane;
}

const INDICATOR_COLORS = ['#ff9800', '#2196f3', '#e91e63', '#4caf50', '#9c27b0'];

@Component({
  selector: 'app-indicator-config-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Configure {{ data.indicator.label }}</h2>
    <mat-dialog-content>
      @for (param of data.indicator.params; track param.key) {
        <mat-form-field appearance="outline" class="param-field">
          <mat-label>{{ param.label }}</mat-label>
          <input matInput type="number"
            [(ngModel)]="paramValues[param.key]"
            [min]="param.min"
            [max]="param.max">
          <mat-hint>{{ param.min }}–{{ param.max }}</mat-hint>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" (click)="onConfirm()">Add Indicator</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
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
  readonly dialogRef = inject(MatDialogRef<IndicatorConfigDialogComponent>);
  readonly data: IndicatorConfigDialogData = inject(MAT_DIALOG_DATA);

  paramValues: Record<string, number> = {};

  constructor() {
    // Initialize with defaults
    for (const param of this.data.indicator.params) {
      this.paramValues[param.key] = param.default;
    }
  }

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

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
