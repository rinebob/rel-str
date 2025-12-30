import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

import { SelectStockDialogComponent } from './select-stock-dialog.component';

@Injectable({
  providedIn: 'root',
})
export class SelectStockDialogService {
  private readonly dialog = inject(MatDialog);
  private dialogRef: MatDialogRef<SelectStockDialogComponent> | undefined;

  open(): void {
    if (this.dialogRef) {
      // Dialog already open; just make sure layout is refreshed
      // eslint-disable-next-line no-console
      console.log('[SelectStockDialogService] open(): reusing existing dialogRef');
      this.dialogRef.updatePosition();
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[SelectStockDialogService] open(): creating new dialogRef');
    this.dialogRef = this.dialog.open(SelectStockDialogComponent, {
      // Compact default width for list-only view; form can widen via updateSize
      width: '640px',
      autoFocus: true,
      restoreFocus: true,
      disableClose: false,
    });

    this.dialogRef.afterClosed().subscribe(() => {
      this.dialogRef = undefined;
    });
  }
}
