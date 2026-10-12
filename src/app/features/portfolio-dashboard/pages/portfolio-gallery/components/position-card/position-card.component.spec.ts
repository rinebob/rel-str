/**
 * Specs for PositionCardComponent (#926/#951) — one held position as a card:
 * symbol/side header, qty@cost · mark · day-change meta, P&L / value / days-held
 * row, sector·industry line, the PROTECTED/UNPROTECTED badge, the
 * action-row skeleton (Close/Stop emit; Add/Detail/Orders are disabled stubs
 * until #953 wires them) above the chart cell, and the cap-tier badge
 * leading the header.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { PositionCardComponent } from './position-card.component';
import { PositionCard } from '../../utils/position-cards.util';
import { makeOrder } from '../../../../portfolio-dashboard.spec-fixtures';

function makeCard(overrides: Partial<PositionCard> = {}): PositionCard {
  return {
    key: '123456789:AAPL',
    accountNumber: '123456789',
    symbol: 'AAPL',
    side: 'long',
    quantity: 100,
    averageCost: 150,
    marketPrice: 155,
    dayChange: 3,
    dayChangePct: 1.97,
    unrealizedPnl: 500,
    unrealizedPnlPct: 3.33,
    marketValue: 15500,
    daysHeld: 10,
    bucketName: 'Growth',
    protected: true,
    stopPrice: 145,
    stopDistancePct: 6.45,
    openOrders: [makeOrder({ orderId: 'o1' }), makeOrder({ orderId: 'o2' })],
    companyName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    capTier: 'mega',
    marketCap: 3.5e12,
    ...overrides,
  };
}

describe('PositionCardComponent', () => {
  let fixture: ComponentFixture<PositionCardComponent>;

  function render(card: PositionCard, actionsDisabled = false): HTMLElement {
    fixture = TestBed.createComponent(PositionCardComponent);
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('actionsDisabled', actionsDisabled);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PositionCardComponent],
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('renders the populated meta set — symbol, company, side, qty@cost, mark, day change', () => {
    const el = render(makeCard());
    const text = el.textContent!;
    expect(el.querySelector('.position-symbol')!.textContent).toContain('AAPL');
    expect(text).toContain('Apple Inc.');
    expect(text).toContain('LONG');
    expect(text).toContain('100 @ $150.00');
    expect(text).toContain('$155.00');
    expect(text).toContain('+$3.00 (+1.97%)');
    expect(text).toContain('Growth');
    expect(text).toContain('10d');
  });

  it('negates the day-change display for shorts — position perspective, not the instrument move', () => {
    const el = render(makeCard({
      side: 'short', quantity: -100, dayChange: 3, dayChangePct: 1.97,
      protected: false, stopPrice: null, stopDistancePct: null,
    }));
    const change = el.querySelector('.meta-change')!;
    expect(change.textContent).toContain('−$3.00 (−1.97%)');
    expect(change.classList.contains('down')).toBe(true);
  });

  it('renders the cap-tier badge in the header, left of the symbol', () => {
    const el = render(makeCard());
    const header = el.querySelector('.card-header')!;
    const badge = header.querySelector('.badge.tier')!;
    expect(badge.textContent).toContain('MEGA');
    const symbol = header.querySelector('.position-symbol')!;
    expect(badge.compareDocumentPosition(symbol) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('renders the action row above the chart cell', () => {
    const el = render(makeCard());
    const actions = el.querySelector('.card-actions')!;
    const chart = el.querySelector('.chart-placeholder')!;
    expect(actions.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('renders — for null fields without crashing', () => {
    const el = render(makeCard({
      marketPrice: null, dayChange: null, dayChangePct: null,
      unrealizedPnl: null, unrealizedPnlPct: null, marketValue: null,
      daysHeld: null, bucketName: null, companyName: null,
      sector: null, industry: null, capTier: null, marketCap: null,
      protected: false, stopPrice: null, stopDistancePct: null,
    }));
    expect(el.textContent).toContain('—');
    expect(el.querySelector('.protection-badge')!.textContent).toContain('UNPROTECTED');
  });

  it('shows PROTECTED @ price (pct) when a stop protects the position', () => {
    const badge = render(makeCard()).querySelector('.protection-badge')!;
    expect(badge.textContent).toContain('PROTECTED @ $145.00 (6.45%)');
  });

  it('shows UNPROTECTED when no stop rests', () => {
    const badge = render(makeCard({ protected: false, stopPrice: null, stopDistancePct: null }))
      .querySelector('.protection-badge')!;
    expect(badge.textContent).toContain('UNPROTECTED');
    expect(badge.classList.contains('unprotected')).toBe(true);
  });

  it('stop action label resolves Add Stop / Update Stop from card state', () => {
    expect(render(makeCard()).querySelector('.action-stop')!.textContent).toContain('Update Stop');
    expect(render(makeCard({ protected: false })).querySelector('.action-stop')!.textContent).toContain('Add Stop');
  });

  it('Add, Detail, and Orders render as disabled stubs with coming-soon tooltips', () => {
    const el = render(makeCard());
    const add = el.querySelector<HTMLButtonElement>('.action-add')!;
    const detail = el.querySelector<HTMLButtonElement>('.action-detail')!;
    const orders = el.querySelector<HTMLButtonElement>('.action-orders')!;
    expect(add.disabled && detail.disabled && orders.disabled).toBe(true);
    expect(add.getAttribute('title')).toContain('coming soon');
    expect(orders.textContent).toContain('(2)');
  });

  it('Close and Stop emit the card action for the page to dispatch', () => {
    const el = render(makeCard());
    const emitted: { type: string }[] = [];
    fixture.componentInstance.action.subscribe((a) => emitted.push(a));
    el.querySelector<HTMLButtonElement>('.action-close')!.click();
    el.querySelector<HTMLButtonElement>('.action-stop')!.click();
    expect(emitted.map((a) => a.type)).toEqual(['close', 'stop']);
  });

  it('actionsDisabled disables the actionable buttons', () => {
    const el = render(makeCard(), true);
    expect(el.querySelector<HTMLButtonElement>('.action-close')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('.action-stop')!.disabled).toBe(true);
  });
});
