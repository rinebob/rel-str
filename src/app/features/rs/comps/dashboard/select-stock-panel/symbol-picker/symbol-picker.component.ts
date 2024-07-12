import { ChangeDetectionStrategy, Component, OnInit, output, signal } from '@angular/core';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SYMBOL_DATA } from '../../../../../../../assets/data/picker-table-data';
import { Company, FormMode } from '../../../../common/interfaces-rs';
import { RelStrBaseComponent } from '../../../rel-str-base/rel-str-base.component';

@Component({
  selector: 'rs-symbol-picker',
  standalone: true,
  imports: [],
  templateUrl: './symbol-picker.component.html',
  styleUrl: './symbol-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SymbolPickerComponent extends RelStrBaseComponent implements OnInit {

    externalSymbolsSource = signal<Company[]>(SYMBOL_DATA);
    localSymbolsSource = signal<Company[]>(SYMBOL_DATA);
    localSymbolsSelection = signal<Company[]>([]);
    localSymbolsOuput = output<Company[]>();

    ngOnInit() {

        combineLatest([this.showForm$, this.formMode$]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(([showForm, formMode]) => {
            if (!!showForm && formMode === FormMode.CREATE) {
                this.resetSelections();
            }

        });

        this.selectedStockList$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
            // console.log('sP ngOI selected stock list sub: ', list);
            // console.log('sP ngOI list symbols: ', list.symbols);
            this.localSymbolsSelection.set([...list.symbols]);
            const symbols: string[] = [];
            for (const sym of list.symbols) {
                symbols.push(sym.symbol)
            }
            const symbolsSource = this.externalSymbolsSource().filter(sym => !symbols.includes(sym.symbol))
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
        this.localSymbolsSource.set(SYMBOL_DATA)
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
