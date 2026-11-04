import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DsDialogRef } from '../../shared/ds/ds-dialog';

import { SelectStockPanelComponent } from '../dashboard-v2/select-stock-panel/select-stock-panel.component';

@Component({
    selector: 'rs-select-stock-dialog',
    standalone: true,
    imports: [SelectStockPanelComponent],
    templateUrl: './select-stock-dialog.component.html',
    styleUrls: ['./select-stock-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectStockDialogComponent {
    // Optional: will be defined when hosted in a DsDialogService, undefined in other hosts
    protected readonly dialogRef = inject(DsDialogRef<SelectStockDialogComponent>, { optional: true });
}
