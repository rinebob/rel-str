import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, signal, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { combineLatest } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Auth } from '@angular/fire/auth';

import { Company, FormMode, RelStrListForm, RelStrStockList } from '../../../shared/types/rs.interfaces';
import { FORM_MODE_CREATE_TEXT, FORM_MODE_EDIT_TEXT, STOCK_LIST_INITIALIZER } from '../../../shared/constants/rs.constants';
import { SymbolPickerComponent } from '../symbol-picker/symbol-picker.component';
import { RelStrBaseComponent } from '../../../rel-str-base/rel-str-base.component';
import { resolveExistingRanksData } from '../../../utils/rs-calc-utils';
import { MatDialogRef } from '@angular/material/dialog';
import { SelectStockDialogComponent } from '../../../select-stock/select-stock-dialog.component';

@Component({
    selector: 'rs-stock-list-form-v2',
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
    private readonly auth = inject(Auth);
    private readonly dialogRef = inject(MatDialogRef<SelectStockDialogComponent>, { optional: true });
    
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
            this.selectedStockListV2$,
            this.formModeV2$,
            this.showFormV2$
        ]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([stockList, formMode, showForm]) => {
            // If we're hosted in the global select-stock dialog, control its width
            // so it jumps once to a wider layout for the form and then stays stable.
            if (this.dialogRef) {
                if (showForm) {
                    this.dialogRef.updateSize('900px');
                } else {
                    this.dialogRef.updateSize('640px');
                }
            }

            if (!!showForm) {
                if (formMode === FormMode.CREATE) {
                    this.reset();
                } else if (formMode === FormMode.EDIT) {
                    this.populateForm(stockList);
                    this.localStockList.set(stockList);
                }
            }
        });

        this.listForm.valueChanges.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
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
        this.localSymbolsSelection.set([...symbols]);
        this.setFormData();
    }

    handleSaveList() {
        // Persist under the authenticated user
        const uid = this.auth.currentUser?.uid;
        if (!uid) {
            console.warn('[StockListFormV2] handleSaveList: no authenticated user; aborting save');
            return;
        }
        const newList= this.formDataWithSymbols();
        // Basic validation for required fields used in Firestore paths/payloads
        const name = String(newList?.name || '').trim();
        const baseline = String(newList?.baseline || '').trim();
        if (!name || !baseline) {
            console.warn('[StockListFormV2] handleSaveList: missing required fields', { name, baseline });
            this.nameControl.markAsTouched();
            this.baselineControl.markAsTouched();
            return;
        }
        if (this.rsAppStore.formModeV2() === FormMode.CREATE) {
            this.rsAppStore.saveStockListForUserV2(uid, newList);
        } else {
            const pairsToSave = resolveExistingRanksData(this.localStockList(), this.localSymbolsSelection());
            newList.ranksDataWithColors = {...pairsToSave};

            const oldName = this.localStockList().name;
            if (oldName !== newList.name) {
                this.rsAppStore.renameStockListForUserV2(uid, oldName, { ...newList });
            } else {
                this.rsAppStore.saveStockListForUserV2(uid, { ...newList });
            }
        }

        // After save/rename, immediately re-initialize this list so heatmap data resolves
        // and the dashboard updates without requiring a second list click.
        void this.rsAppStore.initializeListV2({ ...newList });

        // If hosted inside the global select-stock dialog, close the dialog on save
        this.dialogRef?.close();

        this.reset();
        this.rsAppStore.setShowFormV2(false);
    }

    handleCancel() {
        // Close dialog if present; otherwise just hide the form in sidenav mode
        this.dialogRef?.close();
        this.rsAppStore.setShowFormV2(false);
    }
}
