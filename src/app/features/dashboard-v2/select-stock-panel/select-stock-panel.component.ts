import { ChangeDetectionStrategy, Component } from '@angular/core';

import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { StockListSelectorComponent } from './stock-list-selector/stock-list-selector.component';
import { StockListFormComponent } from './stock-list-form/stock-list-form.component';

@Component({
    selector: 'rs-select-stock-panel-v2',
    imports: [StockListSelectorComponent, StockListFormComponent],
    template: `
		<rs-stock-list-selector-v2 />
		<rs-stock-list-form-v2 />
	`,
    styleUrl: './select-stock-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SelectStockPanelComponent extends RelStrBaseComponent {
}
