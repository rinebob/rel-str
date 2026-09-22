import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { OptionChainComponent } from './option-chain.component';
import { AppRoutes } from '../../../../core/common/interfaces';
import { NAV_MENU_ITEMS } from '../../../../core/common/constants';

describe('OptionChainComponent', () => {
  it('creates and renders the page shell with header', async () => {
    await TestBed.configureTestingModule({
      imports: [OptionChainComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionChainComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.option-chain-page')).toBeTruthy();
    expect(el.querySelector('.page-header')?.textContent).toContain('Option Chain');
  });
});

describe('option chain routing', () => {
  it('registers the savant-trader/option-chain path', () => {
    expect(AppRoutes.OPTION_CHAIN).toBe('savant-trader/option-chain');
  });

  it('exposes a sidenav entry routing to the page', () => {
    const item = NAV_MENU_ITEMS.find((i) => i.text === 'Option Chain');
    expect(item).toBeTruthy();
    expect(item?.href).toBe('savant-trader/option-chain');
  });
});
