/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Simple Material dialog for entering a list name.
 */
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { DsDialogRef } from '../../../../shared/ds/ds-dialog';

@Component({
  selector: 'app-save-list-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,],
  template: `
    <h2 class="title">Save Spread List</h2>
    <div class="content">
      <label class="dse-field full-width">
        <span class="field-label">List Name</span>
        <input class="field-input" [value]="name()" (input)="name.set($any($event.target).value)" (keyup.enter)="onSave()" autofocus>
      </label>
    </div>
    <div class="actions" align="end">
      <button class="ds-btn" (click)="onCancel()">Cancel</button>
      <button class="ds-btn fill" (click)="onSave()" [disabled]="!name().trim()">Save</button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveListDialogComponent {
  private readonly dialogRef = inject(DsDialogRef<SaveListDialogComponent>);
  name = signal('');

  onSave(): void {
    const trimmed = this.name().trim();
    if (trimmed) {
      this.dialogRef.close(trimmed);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
