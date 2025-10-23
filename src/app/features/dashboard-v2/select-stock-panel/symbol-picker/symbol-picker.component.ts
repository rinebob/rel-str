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
    localSymbolsOuput = output<Company[]>();

    ngOnInit() {

        // Load dynamic tracked symbols (callable) and initialize sources
        // Service already maps payload to Company[]; just sort and set
        this.db
            .getTrackedSymbols$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((companies: Company[]) => {
                const sorted = [...companies].sort(compareFn);
                this.externalSymbolsSource.set(sorted);
                // initialize local source from full set; will be further filtered by selected list below
                this.localSymbolsSource.set(sorted);
            });

        combineLatest([this.showFormV2$, this.formModeV2$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([showForm, formMode]: [boolean, FormMode]) => {
            if (!!showForm && formMode === FormMode.CREATE) {
                this.resetSelections();
            }
        });

        this.selectedStockListV2$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
            // console.log('sP ngOI selected stock list sub: ', list);
            // console.log('sP ngOI list symbols: ', list.symbols);
            this.localSymbolsSelection.set([...list.symbols]);
            const alreadySelected = new Set<string>(list.symbols.map(s => s.symbol));
            const baseline = String(list.baseline || '').toUpperCase();
            const symbolsSource = this.externalSymbolsSource().filter(sym => !alreadySelected.has(sym.symbol) && sym.symbol !== baseline);
            // console.log('sP ngOI final symbolsSource: ', symbolsSource);
            this.localSymbolsSource.set(symbolsSource);
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
        // Reset to full external source (already sorted), selection cleared
        this.localSymbolsSource.set([...this.externalSymbolsSource()])
        this.localSymbolsSelection.set([]);
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
