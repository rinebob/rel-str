/**
 * Options Replay New Run Dialog
 *
 * Launches a Selection Replay run — template picker bound to the shared
 * REPLAY_TEMPLATES registry (name + description), symbols text field
 * (same comma/space convention as the sim dialog), and a YYYY-MM-DD
 * startDate. Closes with an OptionsReplayStartRequest; the callable
 * re-validates server-side.
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { OptionsReplayStartRequest } from '@options-replay/contracts';
import { REPLAY_TEMPLATES } from '@options-replay/templates';

/** Real YYYY-MM-DD (rejects 2026-02-30) — mirrors the callable's check. */
function marketDateValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  if (!value) return null; // required handles empty
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { marketDate: true };
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { marketDate: true };
  return parsed.toISOString().slice(0, 10) === value ? null : { marketDate: true };
}

function parseSymbols(symbolsText: string): string[] {
  return String(symbolsText)
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

@Component({
  selector: 'app-options-replay-new-run-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './options-replay-new-run-dialog.component.html',
  styleUrl: './options-replay-new-run-dialog.component.scss',
})
export class OptionsReplayNewRunDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<OptionsReplayNewRunDialogComponent, OptionsReplayStartRequest | undefined>>(
    MatDialogRef
  );

  readonly templates = REPLAY_TEMPLATES;

  /** Trigger shows the selected template's name only — the description
   *  lives in the dropdown options, not mashed into the closed select. */
  selectedTemplateName(): string {
    const id = this.form.controls.templateId.value;
    return this.templates.find((t) => t.id === id)?.name ?? id;
  }

  readonly form = new FormGroup({
    templateId: new FormControl<string>(REPLAY_TEMPLATES[0]?.id ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    symbolsText: new FormControl<string>('QQQ', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    startDate: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, marketDateValidator],
    }),
  });

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const symbols = parseSymbols(this.form.controls.symbolsText.value);
    if (symbols.length === 0) {
      this.form.controls.symbolsText.setErrors({ required: true });
      return;
    }

    this.dialogRef.close({
      templateId: this.form.controls.templateId.value,
      symbols,
      startDate: this.form.controls.startDate.value,
    });
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
