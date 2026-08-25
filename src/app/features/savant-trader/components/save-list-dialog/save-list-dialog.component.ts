/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Simple Material dialog for entering a list name.
 */
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-save-list-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Save Spread List</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>List Name</mat-label>
        <input matInput [value]="name()" (input)="name.set($any($event.target).value)" (keyup.enter)="onSave()" autofocus>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-flat-button color="primary" (click)="onSave()" [disabled]="!name().trim()">Save</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaveListDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<SaveListDialogComponent>);
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
