import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {MatInputModule} from '@angular/material/input';
import {MatFormFieldModule} from '@angular/material/form-field';
import { RelStrListForm, RelStrStockList } from '../../../common/interfaces-rs';
import { UpperCasePipe } from '@angular/common';

@Component({
  selector: 'rs-select-stock-panel',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, UpperCasePipe],
  templateUrl: './select-stock-panel.component.html',
  styleUrl: './select-stock-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SelectStockPanelComponent extends RelStrBaseComponent {

    formMode = signal<'edit' | 'create'>('create');
    showForm = signal<boolean>(false);

    listSelected = output<void>();

    nameControl = new FormControl('');
    baselineControl = new FormControl('');

    listForm = new FormGroup<RelStrListForm>({
        nameControl: this.nameControl,
        baselineControl: this.baselineControl,
    });

    reset() {
        // console.log('sSP r reset');
        this.formMode.set('create');
        this.listForm.reset();
        this.showForm.set(false);
    }

    handleSelectList(list: RelStrStockList) {
        // console.log('sSP hSL select list called.  list: ', list);
        this.rsAppStore.setStockList(list);
        this.reset();
        this.listSelected.emit();
    }

    handleCreateNewList() {
        // console.log('sSP hEL handle create list');
        this.formMode.set('create');
        this.listForm.reset();
        this.showForm.set(true);
    }
    
    handleEditList(list: RelStrStockList) {
        // console.log('sSP hEL handle edit list: ', list.name);
        this.rsAppStore.setStockList(list);
        this.formMode.set('edit');
        this.populateForm(list);
        this.showForm.set(true);
    }

    populateForm(list: RelStrStockList) {
        this.listForm.controls.nameControl.setValue(list.name);
        this.listForm.controls.baselineControl.setValue(list.baseline);
    }
    
    handleSaveList() {
        // console.log('sSP hEL handle save list: ', this.listForm.value);
        let newList: RelStrStockList = {
            name: this.listForm.controls.nameControl.value,
            baseline: this.listForm.controls.baselineControl.value,
        }
        // console.log('sSP hEL newList: ', newList);
        let allLists = [...this.rsAppStore.allStockLists()];
        if (this.formMode() === 'edit') {
            
            allLists = this.rsAppStore.allStockLists().filter(l => l.name !== this.rsAppStore.stockList()?.name);
            allLists = [...allLists, newList];
            
        } else {
            allLists = [...this.rsAppStore.allStockLists(), newList];
            
        }
        this.rsAppStore.setStockList(newList);
        this.rsAppStore.setAllStockLists(allLists);
        this.reset();
        this.listSelected.emit();

    }
    
    handleDeleteList(listName: string) {
        // console.log('sSP hEL handle delete list: ', listName);
        this.rsAppStore.deleteStockList(listName);
        this.reset();
    }

    handleCancel() {
        // console.log('sSP hC handle cancel');
        this.reset();
    }

}
