import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

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
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="account-switcher pill-group" data-testid="account-switcher"
      role="radiogroup"
      aria-label="Select account"
    >
      @for (acct of accounts(); track acct.accountNumber; let i = $index) {
        <button type="button" class="pill" role="radio" [attr.aria-checked]="selectedIndex() === i"
          [class.active]="selectedIndex() === i" (click)="onSelect(i)"
          [attr.data-testid]="'acct-toggle-' + acct.accountNumber">
          {{ acct.accountName }}
          @if (!acct.agenticAllowed) {
            <span class="non-agentic" [attr.data-testid]="'non-agentic-flag-' + acct.accountNumber"
              tabindex="0" role="note" aria-label="Non-agentic account — order placement not enabled" title="Order placement is not enabled on this account — bucket management and assignment only"
            >non-agentic</span>
          }
        </button>
      }
    </div>
  `,
  styles: [`
    .account-switcher { border-radius: 4px; }
    .account-switcher .pill { font-size: 12px; }
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

  /** Emit only on a real selection change — an account must always be
   *  selected, so re-clicking the active pill is a no-op. */
  onSelect(index: number): void {
    if (index !== this.selectedIndex()) this.selectionChange.emit(index);
  }
}
