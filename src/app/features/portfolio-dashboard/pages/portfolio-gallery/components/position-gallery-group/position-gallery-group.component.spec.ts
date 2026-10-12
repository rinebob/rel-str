/**
 * Specs for PositionGalleryGroupComponent (#926/#951) — one expando section
 * of the grouped portfolio gallery: group label, position count, long/short
 * tallies, expansion state forwarded to the page store, and the position-card
 * grid.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { PositionGalleryGroupComponent } from './position-gallery-group.component';
import { PositionCard, PositionCardGroup } from '../../utils/position-cards.util';

function card(symbol: string, side: 'long' | 'short' = 'long'): PositionCard {
  return {
    key: `a:${symbol}`,
    accountNumber: 'a',
    symbol,
    side,
    quantity: side === 'long' ? 10 : -10,
    averageCost: 100,
    marketPrice: 105,
    dayChange: 1,
    dayChangePct: 1,
    unrealizedPnl: 50,
    unrealizedPnlPct: 5,
    marketValue: 1050,
    daysHeld: 3,
    bucketName: null,
    protected: false,
    stopPrice: null,
    stopDistancePct: null,
    openOrders: [],
    companyName: `${symbol} Co`,
    sector: 'T',
    industry: 'I',
    capTier: 'mid',
    marketCap: 1e9,
  };
}

const GROUP: PositionCardGroup = {
  key: 'SECTOR:Technology',
  label: 'Technology',
  cards: [card('AAPL'), card('MSFT'), card('XYZ', 'short')],
};

describe('PositionGalleryGroupComponent', () => {
  let fixture: ComponentFixture<PositionGalleryGroupComponent>;

  function render(group: PositionCardGroup = GROUP, expanded = false): HTMLElement {
    fixture = TestBed.createComponent(PositionGalleryGroupComponent);
    fixture.componentRef.setInput('group', group);
    fixture.componentRef.setInput('expanded', expanded);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PositionGalleryGroupComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    });
  });

  it('renders the group label, position count, and long/short tallies', () => {
    const el = render();
    expect(el.querySelector('.group-label')!.textContent).toContain('Technology');
    const summary = el.querySelector('.group-summary')!.textContent!;
    expect(summary).toContain('3 positions');
    expect(summary).toContain('2'); // 2 longs
    expect(summary).toContain('1'); // 1 short
  });

  it('toggles on panel-header clicks and emits expandedChange', () => {
    const el = render();
    const panel = el.querySelector('mat-expansion-panel')!;
    const header = el.querySelector<HTMLElement>('.mat-expansion-panel-header')!;
    const events: boolean[] = [];
    fixture.componentInstance.expandedChange.subscribe((v) => events.push(v));

    header.click();
    fixture.detectChanges();
    expect(panel.classList.contains('mat-expanded')).toBe(true);

    header.click();
    fixture.detectChanges();
    expect(panel.classList.contains('mat-expanded')).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it('renders one app-position-card per group card', () => {
    const el = render(GROUP, true);
    fixture.detectChanges();
    expect(el.querySelectorAll('app-position-card').length).toBe(3);
  });

  it('re-emits child card actions for the page to dispatch', () => {
    const el = render(GROUP, true);
    const actions: { type: string }[] = [];
    fixture.componentInstance.cardAction.subscribe((a) => actions.push(a));
    el.querySelector<HTMLButtonElement>('.action-close')!.click();
    expect(actions.map((a) => a.type)).toEqual(['close']);
  });
});
