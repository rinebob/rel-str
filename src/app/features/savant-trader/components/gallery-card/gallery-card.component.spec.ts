/**
 * GalleryCardComponent spec (#754) — renders the card shell's signal details.
 */
import { signal } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';

import { GalleryCardComponent } from './gallery-card.component';
import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { IndicatorSeriesStore } from '../../stores/indicator-series.store';
import { GalleryCard } from '../../utils/gallery-cards.util';
import { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
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
  const occurrences: GalleryCard['occurrences'] = [
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
    ];
  return {
    key: 'AAPL:buy',
    symbol: 'AAPL',
    side: 'buy',
    direction: SignalDirection.LONG,
    profile: { symbol: 'AAPL', enabled: true, createdAt: '2026-01-01', name: 'Apple Inc' },
    occurrences,
    allOccurrences: occurrences,
    status: 'pending',
    allRejected: false,
    actionedAt: '',
  };
}

describe('GalleryCardComponent', () => {
  let fixture: ComponentFixture<GalleryCardComponent>;
  let barsMap: ReturnType<typeof signal<Record<string, PriceBar[]>>>;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  const bar = (date: string, close: number): PriceBar => ({
    date,
    x: new Date(date),
    open: close,
    high: close,
    low: close,
    close,
  });

  beforeEach(async () => {
    barsMap = signal<Record<string, PriceBar[]>>({});
    await TestBed.configureTestingModule({
      imports: [GalleryCardComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        // The chart cell is @defer (on viewport) — jsdom has no
        // IntersectionObserver, so defer blocks stay manual and the chart
        // store is stubbed for the one test that completes the block.
        {
          provide: GalleryCardChartStore,
          useValue: {
            ensureBars: jest.fn(),
            ensureWeeklyBars: jest.fn(),
            epoch: signal(0),
            barsFor: () => (s: string) => barsMap()[s],
            weeklyBarsFor: () => () => undefined,
            versionFor: () => () => '',
            errorFor: () => () => null,
            weeklyErrorFor: () => () => null,
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

  it('option-chain link deep-links the card symbol in a new tab (#1055)', () => {
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="open-chain-btn"]');
    expect(link).toBeTruthy();
    expect(link!.textContent).toContain('Option chain');
    expect(link!.href).toContain('/options/chain?symbol=AAPL');
    expect(link!.target).toBe('_blank');
  });

  it('option-chain link stays reachable when decision actions are disabled', () => {
    fixture.componentRef.setInput('actionsDisabled', true);
    fixture.componentRef.setInput('actionBusy', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // Anchors can't be disabled — navigation is intentionally untouched
    // by actionsDisabled/actionBusy, so the deep link must still resolve.
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="open-chain-btn"]')!;
    expect(link.href).toContain('/options/chain?symbol=AAPL');
  });

  it('leads the financial row with price + day change once daily bars land', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.meta-price')).toBeNull(); // no bars yet

    barsMap.set({ AAPL: [bar('2026-08-22', 200), bar('2026-08-25', 210)] });
    fixture.detectChanges();

    const meta = el.querySelector('.card-meta')!;
    expect(meta.querySelector('.meta-price')!.textContent).toContain('210.00');
    const chg = meta.querySelector('.meta-change')!;
    expect(chg.textContent).toContain('+10.00');
    expect(chg.textContent).toContain('(+5.0%)');
    expect(chg.classList.contains('up')).toBe(true);
  });

  it('marks a down day with the down class and no leading +', () => {
    barsMap.set({ AAPL: [bar('2026-08-22', 200), bar('2026-08-25', 190)] });
    fixture.detectChanges();

    const chg = fixture.nativeElement.querySelector('.meta-change')!;
    expect(chg.textContent).toContain('-10.00');
    expect(chg.textContent).toContain('(-5.0%)');
    expect(chg.classList.contains('down')).toBe(true);
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

  it('shows the status chip and mutes actioned cards (#755)', () => {
    fixture.componentRef.setInput('card', { ...card(), status: 'rejected' });
    fixture.detectChanges();

    expect(text()).toContain('Rejected');
    expect(fixture.nativeElement.querySelector('.gallery-card.actioned')).toBeTruthy();
  });

  it('renders the ticket-status line as a deep link to the order when a ticket exists (#755/#762)', () => {
    fixture.componentRef.setInput('card', {
      ...card(),
      status: 'resting',
      ticket: ticket(),
    });
    fixture.detectChanges();

    expect(text()).toContain('Resting');
    expect(text()).toContain('limit 10 @ 210.50 · Resting');

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '[data-testid="ticket-line-link"]',
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toContain('/trading/live');
    expect(link?.getAttribute('href')).toContain('ticket=t-1');
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

  it('renders the labeled decision toolbar — Trade / Reject (#755/#759)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.action-trade')).toBeTruthy();
    expect(el.querySelector('.action-reject')).toBeTruthy();
    // Paper hidden while GALLERY_MANUAL_PAPER_ENABLED=false (#762 QA).
    expect(el.querySelector('.action-paper')).toBeNull();
    expect(text()).toContain('Trade');
    expect(text()).toContain('Reject');
  });

  it('emits a typed card action for each toolbar button (#755)', () => {
    const emitted: { type: string }[] = [];
    fixture.componentInstance.action.subscribe((a) => emitted.push(a));

    const click = (cls: string) =>
      (fixture.nativeElement.querySelector(`.${cls}`) as HTMLButtonElement).click();
    click('action-trade');
    click('action-reject');

    expect(emitted.map((a) => a.type)).toEqual(['trade', 'reject']);
  });

  it('hides the Paper button — manual paper is off while auto-paper covers the workflow (#762)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.action-paper')).toBeNull();
    expect(el.textContent).not.toContain('Paper');
  });

  it('shows Restore on a rejected actioned card', () => {
    fixture.componentRef.setInput('card', { ...card(), status: 'rejected' });
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.action-reject') as HTMLButtonElement;
    expect(btn.textContent).toContain('Restore');
    expect(btn.classList.contains('active')).toBe(true);
  });

  it('no Unwatch affordance — Monitor membership does not action a card (#762 QA)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.action-unwatch')).toBeNull();
  });

  it('failed card shows Requeue and enables Reject; Trade stays disabled', () => {
    const emitted: { type: string }[] = [];
    fixture.componentInstance.action.subscribe((a) => emitted.push(a));
    fixture.componentRef.setInput('card', { ...card(), status: 'failed' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const requeue = el.querySelector<HTMLButtonElement>('.action-requeue');
    expect(requeue).toBeTruthy();
    expect(requeue!.disabled).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('.action-unwatch')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('.action-reject')!.disabled).toBe(false);
    expect(el.querySelector<HTMLButtonElement>('.action-trade')!.disabled).toBe(true);

    requeue!.click();
    expect(emitted.map((a) => a.type)).toEqual(['requeue']);
  });

  it('settled card is terminal — no exit buttons, all decisions disabled', () => {
    fixture.componentRef.setInput('card', { ...card(), status: 'settled' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.action-unwatch')).toBeNull();
    expect(el.querySelector('.action-requeue')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('.action-trade')!.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('.action-reject')!.disabled).toBe(true);
  });

  it('a fully-rejected card shows Restore and blocks Trade (#755 review)', () => {
    // Every occurrence carries a REJECT; the REJECTs must stay restorable
    // and the card untradeable.
    fixture.componentRef.setInput('card', { ...card(), status: 'rejected', allRejected: true });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const reject = el.querySelector<HTMLButtonElement>('.action-reject')!;
    expect(reject.textContent).toContain('Restore');
    expect(reject.disabled).toBe(false); // Restore stays reachable
    expect(el.querySelector<HTMLButtonElement>('.action-trade')!.disabled).toBe(true);
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

  it('renders the action toolbar above the chart cell (#819)', async () => {
    const blocks = await fixture.getDeferBlocks();
    await blocks[0].render(DeferBlockState.Complete);

    const el = fixture.nativeElement as HTMLElement;
    const actions = el.querySelector('.card-actions')!;
    const chart = el.querySelector('app-gallery-card-chart')!;
    expect(
      actions.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('disables the decision buttons when the run is not actionable', () => {
    fixture.componentRef.setInput('actionsDisabled', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    for (const cls of ['.action-trade', '.action-reject']) {
      expect(el.querySelector<HTMLButtonElement>(cls)?.disabled).toBe(true);
    }
  });
});
