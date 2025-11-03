import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { StockListSelectorComponent } from './stock-list-selector/stock-list-selector.component';
import { StockListFormComponent } from './stock-list-form/stock-list-form.component';
import { AuthStore } from '../../../core/auth/auth.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
export class SelectStockPanelComponent extends RelStrBaseComponent implements OnInit {
  private readonly authStore = inject(AuthStore);

  ngOnInit(): void {
    // Load user lists when authenticated; clear on sign-out
    this.authStore.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (u) => {
        const uid = u?.uid;
        if (uid) {
          // Read users/{uid}/lists/* and populate panel
          await this.rsAppStore.getListsForUserV2(uid);
          // One-time (idempotent) backfill of existing lists → pair-registry via callable
          // Backend dedupes and validates.
          void this.rsAppStore.backfillUserListsToRegistryV2(uid);
        } else {
          // Signed out: clear lists in UI
          this.rsAppStore.setAllStockListsV2([]);
        }
      });
  }
}
