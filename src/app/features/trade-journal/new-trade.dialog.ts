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
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

export interface NewTradeDialogResult {
  symbol: string;
  direction: string;
  status: string;
  entryPrice: number;
  entryDate: string;
  entryTime: string;
  brokerCsvFiles: File[];
  indicatorCsvFiles: File[];
  screenshotFiles: File[];
}

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
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './new-trade.dialog.html',
  styleUrls: ['./new-trade.dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewTradeDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<NewTradeDialogComponent, NewTradeDialogResult | undefined>);
  private readonly fb = inject(FormBuilder);

  readonly form: FormGroup = this.fb.group({
    symbol: ['', [Validators.required]],
    direction: ['LONG', [Validators.required]],
    status: ['OPEN', [Validators.required]],
    entryPrice: [null, [Validators.required]],
    entryDate: ['', [Validators.required]],
    entryTime: ['', [Validators.required]],
  });

  brokerCsvFiles: File[] = [];
  indicatorCsvFiles: File[] = [];
  screenshotFiles: File[] = [];

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { symbol, direction, status, entryPrice, entryDate, entryTime } = this.form.value;

    const upperSymbol = String(symbol ?? '')
      .trim()
      .toUpperCase();

    let normalizedDate: string = '';
    if (entryDate instanceof Date) {
      const year = entryDate.getFullYear();
      const month = String(entryDate.getMonth() + 1).padStart(2, '0');
      const day = String(entryDate.getDate()).padStart(2, '0');
      normalizedDate = `${year}-${month}-${day}`;
    } else if (typeof entryDate === 'string') {
      normalizedDate = entryDate;
    }

    this.dialogRef.close({
      symbol: upperSymbol,
      direction,
      status,
      entryPrice,
      entryDate: normalizedDate,
      entryTime,
      brokerCsvFiles: this.brokerCsvFiles,
      indicatorCsvFiles: this.indicatorCsvFiles,
      screenshotFiles: this.screenshotFiles,
    });
  }

  onSymbolInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const upper = input.value.toUpperCase();
    input.value = upper;
    this.form.patchValue({ symbol: upper }, { emitEvent: false });
  }

  onBrokerCsvSelected(files: FileList | null): void {
    this.brokerCsvFiles = files ? Array.from(files) : [];
    if (this.brokerCsvFiles.length > 0) {
      console.log(
        '[NewTradeDialog] Broker CSV files:',
        this.brokerCsvFiles.map((f) => f.name),
      );
    } else {
      console.log('[NewTradeDialog] Broker CSV files cleared');
    }
  }

  onBrokerCsvChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.onBrokerCsvSelected(input?.files ?? null);
  }

  onIndicatorCsvSelected(files: FileList | null): void {
    this.indicatorCsvFiles = files ? Array.from(files) : [];
    if (this.indicatorCsvFiles.length > 0) {
      console.log(
        '[NewTradeDialog] Indicator CSV files:',
        this.indicatorCsvFiles.map((f) => f.name),
      );
    } else {
      console.log('[NewTradeDialog] Indicator CSV files cleared');
    }
  }

  onIndicatorCsvChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.onIndicatorCsvSelected(input?.files ?? null);
  }

  onScreenshotsSelected(files: FileList | null): void {
    this.screenshotFiles = files ? Array.from(files) : [];
    if (this.screenshotFiles.length > 0) {
      console.log(
        '[NewTradeDialog] Screenshot files:',
        this.screenshotFiles.map((f) => f.name),
      );
    } else {
      console.log('[NewTradeDialog] Screenshot files cleared');
    }
  }

  onScreenshotsChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.onScreenshotsSelected(input?.files ?? null);
  }

  onDropzoneDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onBrokerCsvDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ?? null;
    this.onBrokerCsvSelected(files);
  }

  onIndicatorCsvDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ?? null;
    this.onIndicatorCsvSelected(files);
  }

  onScreenshotsDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files ?? null;
    this.onScreenshotsSelected(files);
  }
}
