import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { combineLatest } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Company, FormMode, RanksDataWithColors, RelStrListForm, RelStrStockList } from '../../../../common/interfaces-rs';
import { FORM_MODE_CREATE_TEXT, FORM_MODE_EDIT_TEXT, STOCK_LIST_INITIALIZER } from '../../../../common/constants-rs';
import { SymbolPickerComponent } from '../symbol-picker/symbol-picker.component';
import { RelStrBaseComponent } from '../../../rel-str-base/rel-str-base.component';
import { resolveExistingRanksData } from '../../../../utils/rs-calc-utils';

@Component({
  selector: 'rs-stock-list-form',
  standalone: true,
  imports: [
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, UpperCasePipe,
    SymbolPickerComponent,
  ],
  templateUrl: './stock-list-form.component.html',
  styleUrl: './stock-list-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StockListFormComponent extends RelStrBaseComponent implements OnInit {

    localStockList = signal<RelStrStockList>(STOCK_LIST_INITIALIZER);
    localSymbolsSelection = signal<Company[]>([]);
    formDataWithSymbols = signal<RelStrStockList>(STOCK_LIST_INITIALIZER);
    
    nameControl = new FormControl('');
    baselineControl = new FormControl('');

    listForm = new FormGroup<RelStrListForm>({
        nameControl: this.nameControl,
        baselineControl: this.baselineControl,
    });

    readonly FormMode = FormMode;

    readonly FORM_MODE_CREATE_TEXT = FORM_MODE_CREATE_TEXT;
    readonly FORM_MODE_EDIT_TEXT = FORM_MODE_EDIT_TEXT;

    constructor() {
        super();
    }

    ngOnInit() {
        combineLatest([
            this.selectedStockList$,
            this.formMode$,
            this.showForm$
        ]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([stockList, formMode, showForm]) => {
            // console.log('sLF ngOI cL stockList/formMode/showForm sub: ', stockList, formMode, showForm);
            
            if (!!showForm) {
                // console.log('sLF ngOI cL showForm true');
                if (formMode === FormMode.CREATE) {
                    // console.log('sLF ngOI cL formMode create. resetting form');
                    this.reset();
                    
                } else if (formMode === FormMode.EDIT) {
                    // console.log('sLF ngOI cL formMode edit. selected list: ', stockList);
                    this.populateForm(stockList);
                    this.localStockList.set(stockList);
                }
            }
        });

        this.listForm.valueChanges.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(changes => {
            // console.log('sLF ngOI list form value changes sub: ', changes);
            this.setFormData()
        });
    }

    setFormData() {
        let newList: RelStrStockList = {
            name: this.listForm.controls.nameControl.value,
            baseline: this.listForm.controls.baselineControl.value,
            symbols: this.localSymbolsSelection(),
            ranksDataWithColors: {},
        }
        // console.log('sLF ngOI newList: ', newList);
        this.formDataWithSymbols.set(newList);
    }

    reset() {
        this.listForm.reset();
    }

    populateForm(list: RelStrStockList) {
        this.listForm.controls.nameControl.setValue(list.name);
        this.listForm.controls.baselineControl.setValue(list.baseline);
    }

    handleLocalSymbolsOutput(symbols: Company[]) {
        // console.log('sLF hLSO handle local symbols output: ', symbols);
        this.localSymbolsSelection.set([...symbols]);
        this.setFormData();
    }

    handleSaveList() {
        // console.log('sLF hSL handle save list. form mode: ', this.rsAppStore.formMode());

        const newList= this.formDataWithSymbols();
        if (this.rsAppStore.formMode() === FormMode.CREATE) {
            this.rsAppStore.saveList(newList);
        } else {

            const pairsToSave = resolveExistingRanksData(this.localStockList(), this.localSymbolsSelection());
            // console.log('sLF hSL pairs to save: ', pairsToSave);
            newList.ranksDataWithColors = {...pairsToSave};
            // console.log('sLF hSL list to save: ', {...newList});

            this.rsAppStore.saveList({...newList});
        }
        this.reset();
        this.rsAppStore.setShowForm(false);
    }

    handleCancel() {
        // console.log('sLF hC handle cancel');
        this.rsAppStore.setShowForm(false);
    }
}
