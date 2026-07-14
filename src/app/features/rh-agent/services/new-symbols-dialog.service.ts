/**
 * New Symbols Dialog Service
 *
 * Opens the new-symbols dialog and returns the selected symbol, if any.
 * Keeps the dialog component dependency out of chart-review's imports.
 */
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { filter, take } from 'rxjs/operators';

import { NewSymbolsDialogComponent } from '../components/new-symbols-dialog/new-symbols-dialog.component';

@Injectable({
  providedIn: 'root',
})
export class NewSymbolsDialogService {
  private readonly dialog = inject(MatDialog);

  /** Open the dialog and emit the chosen symbols (or nothing on cancel/close). */
  open(): Observable<string[]> {
    const dialogRef = this.dialog.open(NewSymbolsDialogComponent, {
      width: '420px',
      maxHeight: '80vh',
    });

    return dialogRef.afterClosed().pipe(
      take(1),
      filter((symbols): symbols is string[] => Array.isArray(symbols) && symbols.length > 0),
    );
  }
}
