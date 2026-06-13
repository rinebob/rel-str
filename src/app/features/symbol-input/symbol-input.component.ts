import { Component, EventEmitter, Output, input } from '@angular/core';

import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'rs-symbol-input',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './symbol-input.component.html',
  styleUrls: ['./symbol-input.component.scss']
})
export class SymbolInputComponent {
  // Signal inputs provided by parent container
  loading = input<boolean>(false);
  error = input<string | null>(null);

  // Emits a normalized list of symbols when the user submits
  @Output() symbolsSubmit = new EventEmitter<string[]>();

  // Reactive input control for comma/space separated symbols
  readonly symbolsCtrl = new FormControl<string>('', {
    nonNullable: true,
    validators: [
      Validators.required,
      // Letters/numbers/dot/dash/underscore, separated by commas or spaces
      Validators.pattern(/^[\s,]*[A-Za-z0-9._-]+(?:[\s,]+[A-Za-z0-9._-]+)*[\s,]*$/)
    ]
  });

  onSubmit(): void {
    if (this.symbolsCtrl.invalid) {
      this.symbolsCtrl.markAsTouched();
      return;
    }
    const raw = this.symbolsCtrl.value ?? '';
    const tokens = raw
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter((t) => !!t);

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const symbols: string[] = [];
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        symbols.push(t);
      }
    }

    if (symbols.length === 0) {
      this.symbolsCtrl.setErrors({ required: true });
      this.symbolsCtrl.markAsTouched();
      return;
    }

    this.symbolsSubmit.emit(symbols);
  }
}