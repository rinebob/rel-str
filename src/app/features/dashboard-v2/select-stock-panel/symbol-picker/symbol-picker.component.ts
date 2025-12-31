import { ChangeDetectionStrategy, Component, OnInit, output, signal, inject } from '@angular/core';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Company, FormMode } from '../../../shared/types/rs.interfaces';
import { RelStrBaseComponent } from '../../../rel-str-base/rel-str-base.component';
import { RelStrDbV2Service } from '../../../services/rel-str-db-v2.service';

@Component({
    selector: 'rs-symbol-picker-v2',
    imports: [],
    templateUrl: './symbol-picker.component.html',
    styleUrl: './symbol-picker.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SymbolPickerComponent extends RelStrBaseComponent implements OnInit {

    private readonly db = inject(RelStrDbV2Service);

    // Backend-driven sources (tracked symbols)
    externalSymbolsSource = signal<Company[]>([]);
    localSymbolsSource = signal<Company[]>([]);
    localSymbolsSelection = signal<Company[]>([]);
    currentBaseline = signal<string>('');
    localSymbolsOuput = output<Company[]>();

    ngOnInit() {

        // Combine backend symbol universe with the currently selected list and
        // the current form mode so that:
        // - In EDIT mode, we exclude the existing list's symbols and baseline.
        // - In CREATE mode, the selected list starts empty and no baseline
        //   from the previous list leaks in.
        combineLatest([
            this.db.getAvailableSymbolsFromSymbolData$(),
            this.selectedStockListV2$,
            this.formModeV2$,
        ])
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(([companies, list, formMode]: [Company[], any, FormMode]) => {
                const sorted = [...companies].sort(compareFn);
                this.externalSymbolsSource.set(sorted);

                const isCreate = formMode === FormMode.CREATE;
                const baseline = isCreate ? '' : String(list.baseline || '').toUpperCase();
                const selection = isCreate ? [] : [...list.symbols];

                this.localSymbolsSelection.set(selection);
                this.currentBaseline.set(baseline);

                const alreadySelected = new Set<string>(selection.map((s: Company) => s.symbol));
                const symbolsSource = sorted.filter(sym => !alreadySelected.has(sym.symbol) && sym.symbol !== baseline);
                this.localSymbolsSource.set(symbolsSource);
            });

        combineLatest([this.showFormV2$, this.formModeV2$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([showForm, formMode]: [boolean, FormMode]) => {
            if (!!showForm && formMode === FormMode.CREATE) {
                this.resetSelections();
            }
        });

    }
    
    addSymbolToList(datum: Company) {
        // console.log('sP aSTL add symbol to list: ', datum);
        
        // add symbol to selected symbols list
        const localSelection = this.localSymbolsSelection();
        localSelection.push(datum);
        localSelection.sort(compareFn);
        // console.log('sP aSTL final localSelection list: ', localSelection);
        this.localSymbolsSelection.set(localSelection);
        this.localSymbolsOuput.emit([...this.localSymbolsSelection()]);
        
        // remove symbol from local source list
        let localSource = [...this.localSymbolsSource()];
        localSource = localSource.filter(sym => sym.symbol !== datum.symbol);
        this.localSymbolsSource.set([...localSource]);

    }

    removeSymbolFromList(datum: Company) {
        // console.log('sP rSFL remove symbol from list: ', datum);
        
        // remove symbol from local selected symbols list
        let localSelection = this.localSymbolsSelection();
        const updatedLocalSelection = localSelection.filter(sym => sym.symbol !== datum.symbol);
        this.localSymbolsSelection.set(updatedLocalSelection);
        this.localSymbolsOuput.emit([...this.localSymbolsSelection()]);
        
        // add symbol to local symbols source list
        let localSource = [...this.localSymbolsSource()];
        localSource.push(datum);
        localSource.sort(compareFn);
        this.localSymbolsSource.set([...localSource]);
    }

    resetSelections() {
        // Reset selection and recompute available list from external source,
        // excluding baseline symbol.
        this.localSymbolsSelection.set([]);
        const baseline = this.currentBaseline();
        const source = this.externalSymbolsSource().filter(sym => sym.symbol !== baseline);
        this.localSymbolsSource.set(source);
    }

}

function compareFn(a: Company, b: Company) {
    if (a.symbol < b.symbol) {
      return -1;
    } else if (a.symbol > b.symbol) {
      return 1;
    }
    // a must be equal to b
    return 0;
  }
