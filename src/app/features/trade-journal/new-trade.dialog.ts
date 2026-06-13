import { ChangeDetectionStrategy, Component, Inject, inject } from '@angular/core';

import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

export enum DialogMode {
  CREATE = 'create',
  EDIT = 'edit',
}

export interface NewTradeDialogResult {
  symbol: string;
  direction: string;
  status: string;
  entryPrice: number;
  entryDate: string;
  entryTime: string;
  exitPrice?: number | null;
  exitDate?: string | null;
  exitTime?: string | null;
  brokerCsvFiles: File[];
  indicatorCsvFiles: File[];
  screenshotFiles: File[];
  /**
   * Dialog mode. If omitted, callers may treat this as a create operation
   * for backwards compatibility.
   */
  mode?: DialogMode;
  /** Trade identifier being edited (edit mode only). */
  tradeId?: string;
  /** Storage paths to delete on save (edit mode only). */
  deletedBrokerCsvPaths?: string[];
  deletedIndicatorCsvPaths?: string[];
  deletedScreenshotPaths?: string[];
}

export interface ExistingTradeFilePaths {
  brokerCsvPaths?: string[];
  indicatorCsvPaths?: string[];
  screenshotPaths?: string[];
}

export interface NewTradeDialogData extends ExistingTradeFilePaths {
  mode: DialogMode;
  tradeId?: string;
  symbol?: string;
  direction?: string;
  status?: string;
  entryPrice?: number | null;
  entryDate?: string | Date | null;
  entryTime?: string | null;
  exitPrice?: number | null;
  exitDate?: string | Date | null;
  exitTime?: string | null;
}

@Component({
  selector: 'app-new-trade-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule
],
  templateUrl: './new-trade.dialog.html',
  styleUrls: ['./new-trade.dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewTradeDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<NewTradeDialogComponent, NewTradeDialogResult | undefined>);
  private readonly fb = inject(FormBuilder);
  constructor(@Inject(MAT_DIALOG_DATA) public readonly data: NewTradeDialogData | null) {}

  readonly DialogMode = DialogMode;

  readonly form: FormGroup = this.fb.group({
    symbol: [this.data?.symbol ?? '', [Validators.required]],
    direction: [this.data?.direction ?? 'LONG', [Validators.required]],
    status: [this.data?.status ?? 'OPEN', [Validators.required]],
    entryPrice: [this.data?.entryPrice ?? null, [Validators.required]],
    entryDate: [this.data?.entryDate ?? '', [Validators.required]],
    entryTime: [this.data?.entryTime ?? '', [Validators.required]],
    exitPrice: [this.data?.exitPrice ?? null],
    exitDate: [this.data?.exitDate ?? ''],
    exitTime: [this.data?.exitTime ?? ''],
  });

  brokerCsvFiles: File[] = [];
  indicatorCsvFiles: File[] = [];
  screenshotFiles: File[] = [];

  existingBrokerCsvPaths: string[] = this.data?.brokerCsvPaths ? [...this.data.brokerCsvPaths] : [];
  existingIndicatorCsvPaths: string[] = this.data?.indicatorCsvPaths ? [...this.data.indicatorCsvPaths] : [];
  existingScreenshotPaths: string[] = this.data?.screenshotPaths ? [...this.data.screenshotPaths] : [];

  deletedBrokerCsvPaths: string[] = [];
  deletedIndicatorCsvPaths: string[] = [];
  deletedScreenshotPaths: string[] = [];

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { symbol, direction, status, entryPrice, entryDate, entryTime, exitPrice, exitDate, exitTime } =
      this.form.value;

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

    let normalizedExitDate: string | null = null;
    if (exitDate instanceof Date) {
      const year = exitDate.getFullYear();
      const month = String(exitDate.getMonth() + 1).padStart(2, '0');
      const day = String(exitDate.getDate()).padStart(2, '0');
      normalizedExitDate = `${year}-${month}-${day}`;
    } else if (typeof exitDate === 'string' && exitDate.trim().length > 0) {
      normalizedExitDate = exitDate;
    }

    const mode: DialogMode = this.data?.mode ?? DialogMode.CREATE;

    this.dialogRef.close({
      symbol: upperSymbol,
      direction,
      status,
      entryPrice,
      entryDate: normalizedDate,
      entryTime,
      exitPrice,
      exitDate: normalizedExitDate,
      exitTime,
      brokerCsvFiles: this.brokerCsvFiles,
      indicatorCsvFiles: this.indicatorCsvFiles,
      screenshotFiles: this.screenshotFiles,
      mode,
      tradeId: this.data?.tradeId,
      deletedBrokerCsvPaths: this.deletedBrokerCsvPaths,
      deletedIndicatorCsvPaths: this.deletedIndicatorCsvPaths,
      deletedScreenshotPaths: this.deletedScreenshotPaths,
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

  removeExistingBrokerPath(path: string): void {
    this.existingBrokerCsvPaths = this.existingBrokerCsvPaths.filter((p) => p !== path);
    if (!this.deletedBrokerCsvPaths.includes(path)) {
      this.deletedBrokerCsvPaths.push(path);
    }
  }

  removeExistingIndicatorPath(path: string): void {
    this.existingIndicatorCsvPaths = this.existingIndicatorCsvPaths.filter((p) => p !== path);
    if (!this.deletedIndicatorCsvPaths.includes(path)) {
      this.deletedIndicatorCsvPaths.push(path);
    }
  }

  removeExistingScreenshotPath(path: string): void {
    this.existingScreenshotPaths = this.existingScreenshotPaths.filter((p) => p !== path);
    if (!this.deletedScreenshotPaths.includes(path)) {
      this.deletedScreenshotPaths.push(path);
    }
  }

  fileNameFromPath(path: string): string {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.substring(idx + 1) : path;
  }
}
