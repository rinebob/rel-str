import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

import { SelectStockPanelComponent } from '../dashboard-v2/select-stock-panel/select-stock-panel.component';

@Component({
    selector: 'rs-select-stock-dialog',
    standalone: true,
    imports: [SelectStockPanelComponent, MatButtonModule],
    templateUrl: './select-stock-dialog.component.html',
    styleUrls: ['./select-stock-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectStockDialogComponent {
    // Optional: will be defined when hosted in a MatDialog, undefined in other hosts
    protected readonly dialogRef = inject(MatDialogRef<SelectStockDialogComponent>, { optional: true });
}
