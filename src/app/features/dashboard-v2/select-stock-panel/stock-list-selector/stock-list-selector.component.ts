import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';

import { FormMode, RelStrStockList } from '../../../shared/types/rs.interfaces';
import { RelStrBaseComponent } from '../../../rel-str-base/rel-str-base.component';

@Component({
    selector: 'rs-stock-list-selector-v2',
    imports: [MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule],
    templateUrl: './stock-list-selector.component.html',
    styleUrl: './stock-list-selector.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class StockListSelectorComponent extends RelStrBaseComponent {

    readonly FormMode = FormMode;

    handleCreateNewList() {
        this.rsAppStore.setFormModeV2(FormMode.CREATE);
        this.rsAppStore.setShowFormV2(true);
    }

    handleSelectList(list: RelStrStockList) {
        // eslint-disable-next-line no-console
        console.log('[StockListSelectorV2] handleSelectList(): selecting list', list?.name);
        this.rsAppStore.initializeListV2({...list});
    }

    handleEditList(list: RelStrStockList) {
        // eslint-disable-next-line no-console
        console.log('[StockListSelectorV2] handleEditList(): editing list', list?.name);
        this.rsAppStore.setSelectedStockListV2(list);
        this.rsAppStore.setFormModeV2(FormMode.EDIT);
        this.rsAppStore.setShowFormV2(true);
    }

    handleDeleteList(listName: string) {
        // eslint-disable-next-line no-console
        console.log('[StockListSelectorV2] handleDeleteList(): deleting list', listName);
        this.rsAppStore.deleteStockListV2(listName);
        this.rsAppStore.setFormModeV2(FormMode.CREATE);
        this.rsAppStore.setShowFormV2(false);
    }
}
