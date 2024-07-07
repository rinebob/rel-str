import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RelStrBaseComponent } from '../../../rel-str-base/rel-str-base.component';
import { UpperCasePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { FormMode, RelStrStockList } from '../../../../common/interfaces-rs';
import { CREATE_TEXT, FORM_MODE_CREATE_TEXT, FORM_MODE_EDIT_TEXT } from '../../../../common/constants-rs';

@Component({
  selector: 'rs-stock-list-selector',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, UpperCasePipe,],
  templateUrl: './stock-list-selector.component.html',
  styleUrl: './stock-list-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StockListSelectorComponent extends RelStrBaseComponent {

    readonly FormMode = FormMode;

    readonly CREATE_TEXT = CREATE_TEXT;
    readonly FORM_MODE_CREATE_TEXT = FORM_MODE_CREATE_TEXT;
    readonly FORM_MODE_EDIT_TEXT = FORM_MODE_EDIT_TEXT;

    handleCreateNewList() {
        // console.log('sLS hCNL handle create list');
        this.rsAppStore.setFormMode(FormMode.CREATE);
        this.rsAppStore.setShowForm(true);
    }

    handleSelectList(list: RelStrStockList) {
        // console.log('sLS hSL select list called.  list: ', list);
        this.rsAppStore.setSelectedStockList({...list});
    }

    handleEditList(list: RelStrStockList) {
        // console.log('sLS hEL handle edit list: ', list.name);
        this.rsAppStore.setSelectedStockList(list);
        this.rsAppStore.setFormMode(FormMode.EDIT);
        this.rsAppStore.setShowForm(true);
    }

    handleDeleteList(listName: string) {
        // console.log('sLS hEL handle delete list: ', listName);
        this.rsAppStore.deleteStockList(listName);
        this.rsAppStore.setFormMode(FormMode.CREATE);
        this.rsAppStore.setShowForm(false);
    }
}
