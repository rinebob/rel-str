import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-new-trade-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
  ],
  templateUrl: './new-trade.dialog.html',
  styleUrls: ['./new-trade.dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewTradeDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<NewTradeDialogComponent>);
  private readonly fb = inject(FormBuilder);

  readonly form: FormGroup = this.fb.group({
    symbol: ['', [Validators.required]],
    direction: ['LONG', [Validators.required]],
    status: ['OPEN', [Validators.required]],
    entryPrice: [null, [Validators.required]],
    entryDate: ['', [Validators.required]],
    entryTime: ['', [Validators.required]],
  });

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(this.form.value);
  }
}
