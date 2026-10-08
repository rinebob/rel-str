/**
 * AccountSwitcherComponent — shared account pill switcher (#778).
 *
 * ACs: one pill per account (accountName only, no number); non-agentic
 * chip inside the label; emits the selected index; re-clicking the
 * selected pill never emits (an account must stay selected).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { AccountSwitcherComponent } from './account-switcher.component';
import type { AccountInfo } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeAccount(overrides: Partial<AccountInfo> = {}): AccountInfo {
  return {
    accountNumber: '5AC11111',
    accountName: 'Investing',
    accountType: 'INDIVIDUAL',
    agenticAllowed: true,
    ...overrides,
  };
}

describe('AccountSwitcherComponent', () => {
  let fixture: ComponentFixture<AccountSwitcherComponent>;

  async function setup(accounts: AccountInfo[], selectedIndex = 0) {
    await TestBed.configureTestingModule({
      imports: [AccountSwitcherComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountSwitcherComponent);
    fixture.componentRef.setInput('accounts', accounts);
    fixture.componentRef.setInput('selectedIndex', selectedIndex);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  function pill(accountNumber: string): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-testid="acct-toggle-${accountNumber}"]`);
  }

  it('renders one pill per account — accountName only, no number', async () => {
    await setup([
      makeAccount({ accountNumber: '111', accountName: 'Investing' }),
      makeAccount({ accountNumber: '222', accountName: 'Roth IRA' }),
    ]);

    expect(pill('111').textContent).toContain('Investing');
    expect(pill('222').textContent).toContain('Roth IRA');
    expect(fixture.nativeElement.textContent).not.toContain('111222333');
    expect(pill('111').textContent).not.toContain('(111)');
  });

  it('flags non-agentic accounts inside the pill with tooltip/ARIA', async () => {
    await setup([
      makeAccount({ accountNumber: '111' }),
      makeAccount({ accountNumber: '222', agenticAllowed: false }),
    ]);

    const flag = fixture.nativeElement.querySelector('[data-testid="non-agentic-flag-222"]');
    expect(flag).toBeTruthy();
    expect(flag.textContent).toMatch(/non-agentic/i);
    expect(flag.getAttribute('aria-label')).toContain('Non-agentic');
    expect(fixture.nativeElement.querySelector('[data-testid="non-agentic-flag-111"]')).toBeNull();
  });

  it('emits selectionChange with the clicked index', async () => {
    await setup([makeAccount({ accountNumber: '111' }), makeAccount({ accountNumber: '222' })]);
    const emitted: number[] = [];
    fixture.componentInstance.selectionChange.subscribe((i: number) => emitted.push(i));

    pill('222').querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(emitted).toEqual([1]);
  });

  it('does not emit when the selected pill is re-clicked (no deselect)', async () => {
    await setup([makeAccount({ accountNumber: '111' }), makeAccount({ accountNumber: '222' })], 0);
    const emitted: number[] = [];
    fixture.componentInstance.selectionChange.subscribe((i: number) => emitted.push(i));

    pill('111').querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(emitted).toEqual([]);
  });
});
