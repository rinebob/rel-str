import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';

import { RsCalcsStore } from '../../store/rs-calcs.store';

@Component({
	selector: 'rs-rel-str-base',
	standalone: true,
	imports: [],
	template: ` <p>rel-str-base works!</p> `,
	styles: ``,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelStrBaseComponent {
	rsCalcsStore = inject(RsCalcsStore);

	constructor() {
		// effect(() => {
        //     this.effect();
        // });
	}

	effect()  {
        console.log('rSBC eff allData: ', this.rsCalcsStore.allData())
        console.log('rSBC eff relStrTableData: ', this.rsCalcsStore.relStrTableData())
    }
}
