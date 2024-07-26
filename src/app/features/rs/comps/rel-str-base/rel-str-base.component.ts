import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop'

import { RsCalcsStore } from '../../store/rs-calcs.store';
import { RsAppStore } from '../../store/rs-app.store';
import { Router } from '@angular/router';

@Component({
	selector: 'rs-rel-str-base',
	standalone: true,
	imports: [],
	template: ` <p>rel-str-base works!</p> `,
	styles: ``,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelStrBaseComponent {
    destroyRef = inject(DestroyRef);

    router = inject(Router);

    rsAppStore = inject(RsAppStore);
	rsCalcsStore = inject(RsCalcsStore);

    allStockLists$ = toObservable(this.rsAppStore.allStockLists);
    selectedStockList$ = toObservable(this.rsAppStore.selectedStockList);

    formMode$ = toObservable(this.rsAppStore.formMode);
    showForm$ = toObservable(this.rsAppStore.showForm);

	constructor() {
		// effect(
        //     this.effect
        // );
	}

	effect = () => {
        // console.log('rSBC eff allData: ', this.rsAppStore.allData())
        // console.log('rSBC eff relStrTableData: ', this.rsAppStore.relStrTableData())
        // console.log('rSBC eff form data: ', this.rsAppStore.formData())
        // console.log('rSBC eff selected stock list: ', this.rsAppStore.selectedStockList())
    }
}
