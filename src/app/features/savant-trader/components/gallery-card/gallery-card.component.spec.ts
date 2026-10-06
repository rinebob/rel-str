/**
 * GalleryCardComponent spec (#754) — renders the card shell's signal details.
 */
import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { GalleryCardComponent } from './gallery-card.component';
import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { GalleryCard } from '../../utils/gallery-cards.util';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';
import { EquityOrderTicket, InstrumentType, OrderSource, OrderTicketStatus } from '../../services/order-ticket.types';

function ticket(): EquityOrderTicket {
  return {
    id: 't-1',
    refId: 'ref-1',
    source: OrderSource.SIGNAL_PIPELINE,
    status: OrderTicketStatus.RESTING,
    accountNumber: 'acct-1',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol: 'AAPL',
    quantity: '10',
    limitPrice: '210.50',
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
  };
}

function card(): GalleryCard {
  return {
    key: 'AAPL:buy',
    symbol: 'AAPL',
    side: 'buy',
    direction: SignalDirection.LONG,
    profile: { symbol: 'AAPL', enabled: true, createdAt: '2026-01-01', name: 'Apple Inc' },
    occurrences: [
      {
        id: '2026-08-25',
        symbol: 'AAPL',
        barDate: '2026-08-25',
        marketDate: '2026-08-25',
        runId: 'run-1',
        timeframe: SignalTimeframe.DAILY,
        direction: SignalDirection.LONG,
        signalType: 'RS_RISE',
        status: SignalStatus.INTERIM,
        indicators: {},
        closePrice: 213.44,
      },
      {
        id: '2026-08-22',
        symbol: 'AAPL',
        barDate: '2026-08-22',
        marketDate: '2026-08-25',
        runId: 'run-1',
        timeframe: SignalTimeframe.WEEKLY,
        direction: SignalDirection.LONG,
        signalType: 'RS_WEEKLY',
        status: SignalStatus.CONFIRMED,
        indicators: {},
      },
    ],
    status: 'pending',
    allRejected: false,
    actionedAt: '',
  };
}

describe('GalleryCardComponent', () => {
  let fixture: ComponentFixture<GalleryCardComponent>;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryCardComponent],
      providers: [
        provideNoopAnimations(),
        // The chart cell is @defer (on viewport) — jsdom has no
        // IntersectionObserver, so defer blocks stay manual and the chart
        // store is stubbed for the one test that completes the block.
        {
          provide: GalleryCardChartStore,
          useValue: {
            ensureBars: jest.fn(),
            barsFor: () => () => undefined,
            versionFor: () => () => '',
            errorFor: () => () => null,
          },
        },
        {
          provide: IndicatorSeriesStore,
          useValue: { responseFor: () => () => undefined },
        },
      ],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryCardComponent);
    fixture.componentRef.setInput('card', card());
    fixture.detectChanges();
  });

  it('renders the symbol, name, and side badge', () => {
    expect(text()).toContain('AAPL');
    expect(text()).toContain('Apple Inc');
    expect(text()).toContain('BUY');
  });

  it('renders each occurrence with timeframe, type, and bar date', () => {
    expect(text()).toContain('RS_RISE');
    expect(text()).toContain('RS_WEEKLY');
    expect(text()).toContain('2026-08-25');
    expect(text()).toContain('2026-08-22');
    expect(text()).toContain('213.44');
  });

  it('shows no status chip for pending cards (#755)', () => {
    expect(fixture.nativeElement.querySelector('.status-chip')).toBeNull();
  });

  it('shows the status chip and dims sunk cards (#755)', () => {
    fixture.componentRef.setInput('card', { ...card(), status: 'watched' });
    fixture.detectChanges();

    expect(text()).toContain('Watched');
    expect(fixture.nativeElement.querySelector('.gallery-card.sunk')).toBeTruthy();
  });

  it('renders the ticket-status line when a ticket exists (#755)', () => {
    fixture.componentRef.setInput('card', {
      ...card(),
      status: 'resting',
      ticket: ticket(),
    });
    fixture.detectChanges();

    expect(text()).toContain('Resting');
    expect(text()).toContain('limit 10 @ 210.50 · Resting');
  });

  it('renders the dollar amount for signal-staged market tickets (#755)', () => {
    // buildSignalOrderTickets emits dollar-based market orders with no
    // quantity/limitPrice — the line must show the notional, not a blank.
    const { quantity: _q, limitPrice: _lp, ...base } = ticket();
    const staged: EquityOrderTicket = {
      ...base,
      status: OrderTicketStatus.STAGED,
      orderType: 'market',
      dollarAmount: '200',
    };
    fixture.componentRef.setInput('card', { ...card(), ticket: staged });
    fixture.detectChanges();

    expect(text()).toContain('market $200 · Staged');
  });

  it('renders the labeled decision toolbar — Trade / Reject / Paper / Chart stub (#755/#759)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.action-trade')).toBeTruthy();
    expect(el.querySelector('.action-reject')).toBeTruthy();
    expect(el.querySelector('.action-paper')).toBeTruthy();
    const chart = el.querySelector<HTMLButtonElement>('.action-chart');
    expect(chart).toBeTruthy();
    expect(chart?.disabled).toBe(true); // stub until #756
    expect(text()).toContain('Trade');
    expect(text()).toContain('Reject');
    expect(text()).toContain('Paper');
  });

  it('emits a typed card action for each toolbar button (#755)', () => {
    const emitted: { type: string }[] = [];
    fixture.componentInstance.action.subscribe((a) => emitted.push(a));

    const click = (cls: string) =>
      (fixture.nativeElement.querySelector(`.${cls}`) as HTMLButtonElement).click();
    click('action-trade');
    click('action-reject');
    click('action-paper');

    expect(emitted.map((a) => a.type)).toEqual(['trade', 'reject', 'paper']);
  });

  it('shows Restore on a rejected sunk card', () => {
    fixture.componentRef.setInput('card', { ...card(), status: 'rejected' });
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.action-reject') as HTMLButtonElement;
    expect(btn.textContent).toContain('Restore');
    expect(btn.classList.contains('active')).toBe(true);
  });

  it('a fully-rejected watched card shows Restore and blocks Trade/Paper (#755 review)', () => {
    // Monitor wins status precedence — the chip says Watched but every
    // occurrence is rejected; the REJECTs must stay restorable and the
    // card untradeable.
    fixture.componentRef.setInput('card', { ...card(), status: 'watched', allRejected: true });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const reject = el.querySelector<HTMLButtonElement>('.action-reject')!;
    expect(reject.textContent).toContain('Restore');
    expect(reject.disabled).toBe(false); // Restore stays reachable
    expect(el.querySelector<HTMLButtonElement>('.action-trade')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('.action-paper')!.disabled).toBe(true);
  });

  it('defers the chart cell — placeholder until the block completes (#756)', async () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.chart-placeholder')).toBeTruthy();
    expect(el.querySelector('app-gallery-card-chart')).toBeNull();

    const blocks = await fixture.getDeferBlocks();
    expect(blocks.length).toBe(1);
    await blocks[0].render(DeferBlockState.Complete);

    expect(el.querySelector('app-gallery-card-chart')).toBeTruthy();
  });

  it('disables the decision buttons when the run is not actionable', () => {
    fixture.componentRef.setInput('actionsDisabled', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    for (const cls of ['.action-trade', '.action-reject', '.action-paper']) {
      expect(el.querySelector<HTMLButtonElement>(cls)?.disabled).toBe(true);
    }
  });
});
