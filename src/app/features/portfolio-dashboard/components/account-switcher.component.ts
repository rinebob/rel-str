import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { AccountInfo } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/**
 * AccountSwitcherComponent — pill-row account switcher shared by the
 * portfolio dashboard header and the allocation page (#778). One click
 * per account; non-agentic accounts carry the flag chip inside the
 * label. Emits the selected index — the owning page wires it to its
 * store's selectAccount path.
 */
@Component({
  selector: 'app-account-switcher',
  imports: [MatButtonToggleModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-button-toggle-group
      class="account-switcher" data-testid="account-switcher"
      [value]="selectedIndex()"
      (change)="onSelect($event.value)"
      aria-label="Select account"
    >
      @for (acct of accounts(); track acct.accountNumber; let i = $index) {
        <mat-button-toggle [value]="i" [attr.data-testid]="'acct-toggle-' + acct.accountNumber">
          {{ acct.accountName }}
          @if (!acct.agenticAllowed) {
            <span class="non-agentic" [attr.data-testid]="'non-agentic-flag-' + acct.accountNumber"
              tabindex="0" role="note" aria-label="Non-agentic account — order placement not enabled"
              matTooltip="Order placement is not enabled on this account — bucket management and assignment only"
            >non-agentic</span>
          }
        </mat-button-toggle>
      }
    </mat-button-toggle-group>
  `,
  styles: [`
    .account-switcher {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
    }
    .account-switcher .mat-button-toggle { font-size: 12px; }
    .non-agentic {
      margin-left: 6px;
      padding: 1px 5px;
      border-radius: 6px;
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
  `],
})
export class AccountSwitcherComponent {
  readonly accounts = input.required<readonly AccountInfo[]>();
  readonly selectedIndex = input.required<number>();
  readonly selectionChange = output<number>();

  /** Re-clicking the selected pill deselects it (value undefined) — an
   *  account must always be selected, so don't emit that. */
  onSelect(index: number | undefined): void {
    if (index != null) this.selectionChange.emit(index);
  }
}
