/**
 * GalleryViewComponent spec (#754) — page shell: header wiring, card grid,
 * and empty states, driven by a stubbed GalleryFacade.
 */
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { GalleryViewComponent } from './gallery-view.component';
import { GalleryFacade } from '../../stores/gallery.facade';
import { GalleryCardActionsService } from '../../stores/gallery-card-actions.service';
import { GalleryCard, GalleryGroup } from '../../utils/gallery-cards.util';
import { GroupDimension, SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';
import { StSymbolProfile } from '../../services/types';

function card(symbol: string, side: 'buy' | 'sell'): GalleryCard {
  const profile: StSymbolProfile = { symbol, enabled: true, createdAt: '2026-01-01', name: `${symbol} Inc` };
  return {
    key: `${symbol}:${side}`,
    symbol,
    side,
    direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
    profile,
    occurrences: [{
      id: '2026-08-25',
      symbol,
      barDate: '2026-08-25',
      marketDate: '2026-08-25',
      runId: 'run-1',
      timeframe: SignalTimeframe.DAILY,
      direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
      signalType: 'RS_RISE',
      status: SignalStatus.INTERIM,
      indicators: {},
      closePrice: 123.45,
    }],
    status: 'pending',
    allRejected: false,
    actionedAt: '',
  };
}

describe('GalleryViewComponent', () => {
  let fixture: ComponentFixture<GalleryViewComponent>;
  let facadeMock: {
    enterGallery: jest.Mock;
    setTimeframe: jest.Mock;
    setDirection: jest.Mock;
    setListFilter: jest.Mock;
    setGroupDimension: jest.Mock;
    setGroupExpanded: jest.Mock;
    toggleAllGroups: jest.Mock;
    expandedGroups: ReturnType<typeof signal<Record<string, boolean>>>;
    viewedRun: ReturnType<typeof signal<{ marketDate: string } | null>>;
    cards: ReturnType<typeof signal<GalleryCard[]>>;
    visibleCards: ReturnType<typeof signal<GalleryCard[]>>;
    groups: ReturnType<typeof signal<GalleryGroup[]>>;
    pageInitializing: ReturnType<typeof signal<boolean>>;
    allFilteredOut: ReturnType<typeof signal<boolean>>;
    loadError: ReturnType<typeof signal<string | null>>;
    cardCount: ReturnType<typeof signal<number>>;
    timeframe: ReturnType<typeof signal<SignalTimeframe>>;
    direction: ReturnType<typeof signal<SignalDirection>>;
    listFilter: ReturnType<typeof signal<string>>;
    groupDimension: ReturnType<typeof signal<GroupDimension>>;
    allGroupsExpanded: ReturnType<typeof signal<boolean>>;
    filterOptionGroups: ReturnType<typeof signal<never[]>>;
  };
  let actionsMock: {
    isActionableRun: ReturnType<typeof signal<boolean>>;
    busyCardKeys: ReturnType<typeof signal<ReadonlySet<string>>>;
    config: ReturnType<typeof signal<null>>;
    warmConfig: jest.Mock;
    rejectCard: jest.Mock;
    paperCard: jest.Mock;
    tradeCard: jest.Mock;
    discardStagedTicket: jest.Mock;
  };

  let dialogMock: { open: jest.Mock };

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const cardEls = (): HTMLElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('app-gallery-card'));

  beforeEach(async () => {
    facadeMock = {
      enterGallery: jest.fn(),
      setTimeframe: jest.fn(),
      setDirection: jest.fn(),
      setListFilter: jest.fn(),
      setGroupDimension: jest.fn(),
      setGroupExpanded: jest.fn(),
      toggleAllGroups: jest.fn(),
      expandedGroups: signal<Record<string, boolean>>({}),
      viewedRun: signal({ marketDate: '2026-08-25' }),
      cards: signal<GalleryCard[]>([]),
      visibleCards: signal<GalleryCard[]>([]),
      groups: signal<GalleryGroup[]>([]),
      pageInitializing: signal(false),
      allFilteredOut: signal(false),
      loadError: signal<string | null>(null),
      cardCount: signal(0),
      timeframe: signal(SignalTimeframe.ALL),
      direction: signal(SignalDirection.ALL),
      listFilter: signal('ALL'),
      groupDimension: signal(GroupDimension.INDUSTRY),
      allGroupsExpanded: signal(true),
      filterOptionGroups: signal<never[]>([]),
    };
    actionsMock = {
      isActionableRun: signal(true),
      busyCardKeys: signal<ReadonlySet<string>>(new Set()),
      config: signal(null),
      warmConfig: jest.fn(),
      rejectCard: jest.fn(),
      paperCard: jest.fn(),
      tradeCard: jest.fn(),
      discardStagedTicket: jest.fn(),
    };
    dialogMock = { open: jest.fn().mockReturnValue({ afterClosed: () => of(null) }) };

    await TestBed.configureTestingModule({
      imports: [GalleryViewComponent],
      providers: [
        provideNoopAnimations(),
        { provide: GalleryFacade, useValue: facadeMock },
        { provide: GalleryCardActionsService, useValue: actionsMock },
        { provide: MatDialog, useValue: dialogMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryViewComponent);
    fixture.detectChanges();
  });

  it('calls enterGallery on init', () => {
    expect(facadeMock.enterGallery).toHaveBeenCalled();
  });

  it('shows the loading state while initializing', () => {
    facadeMock.pageInitializing.set(true);
    fixture.detectChanges();
    expect(text()).toContain('Loading signals');
  });

  it('shows the no-signals empty state when there are no cards', () => {
    expect(text()).toContain('No signals for this run');
  });

  it('shows the load-error state when the symbols load failed', () => {
    facadeMock.loadError.set('callable failed');
    fixture.detectChanges();
    expect(text()).toContain('Failed to load signals');
  });

  it('shows the filtered empty state when all cards are filtered out', () => {
    facadeMock.cards.set([card('AAPL', 'buy')]);
    facadeMock.allFilteredOut.set(true);
    fixture.detectChanges();
    expect(text()).toContain('No signals match the current filters');
  });

  it('renders one card shell per visible card with signal details (#783: inside groups)', () => {
    const cards = [card('AAPL', 'buy'), card('TSLA', 'sell')];
    facadeMock.cards.set(cards);
    facadeMock.visibleCards.set(cards);
    facadeMock.groups.set([{ key: 'industry:Software', label: 'Software', cards }]);
    facadeMock.cardCount.set(2);
    fixture.detectChanges();

    expect(cardEls()).toHaveLength(2);
    expect(text()).toContain('AAPL');
    expect(text()).toContain('TSLA');
    expect(text()).toContain('BUY');
    expect(text()).toContain('SELL');
    expect(text()).toContain('RS_RISE');
  });

  it('renders one expando per group with label and count (#783)', () => {
    const cards = [card('AAPL', 'buy')];
    facadeMock.cards.set(cards);
    facadeMock.groups.set([
      { key: 'sector:Tech', label: 'Tech', cards },
      { key: 'sector:Energy', label: 'Energy', cards: [card('TSLA', 'sell')] },
    ]);
    fixture.detectChanges();

    const groupEls = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-gallery-group'),
    );
    expect(groupEls).toHaveLength(2);
    expect(text()).toContain('Tech');
    expect(text()).toContain('Energy');
  });

  it('routes group expansion events back to the facade (#783)', () => {
    const cards = [card('AAPL', 'buy')];
    facadeMock.cards.set(cards);
    facadeMock.groups.set([{ key: 'sector:Tech', label: 'Tech', cards }]);
    fixture.detectChanges();

    const group = fixture.debugElement.query((el) => el.name === 'app-gallery-group')
      .componentInstance as { expandedChange: { emit: (v: boolean) => void } };
    group.expandedChange.emit(false);
    expect(facadeMock.setGroupExpanded).toHaveBeenCalledWith('sector:Tech', false);
  });

  it('wires header filter/group events to the facade', () => {
    const header = fixture.debugElement.query(
      (el) => el.name === 'app-gallery-header',
    ).componentInstance as {
      timeframeChange: { emit: (v: SignalTimeframe) => void };
      directionChange: { emit: (v: SignalDirection) => void };
      listFilterChange: { emit: (v: string) => void };
      dimensionChange: { emit: (v: GroupDimension) => void };
      expandAllToggle: { emit: () => void };
    };

    header.timeframeChange.emit(SignalTimeframe.WEEKLY);
    header.directionChange.emit(SignalDirection.SHORT);
    header.listFilterChange.emit('PRIMARY');
    header.dimensionChange.emit(GroupDimension.MARKET_CAP_TIER);
    header.expandAllToggle.emit();

    expect(facadeMock.setTimeframe).toHaveBeenCalledWith(SignalTimeframe.WEEKLY);
    expect(facadeMock.setDirection).toHaveBeenCalledWith(SignalDirection.SHORT);
    expect(facadeMock.setListFilter).toHaveBeenCalledWith('PRIMARY');
    expect(facadeMock.setGroupDimension).toHaveBeenCalledWith(GroupDimension.MARKET_CAP_TIER);
    expect(facadeMock.toggleAllGroups).toHaveBeenCalled();
  });

  it('dispatches card actions to the facade (#755/#759)', async () => {
    const c = card('AAPL', 'buy');
    const stagedTicket = { id: 't-1' };
    actionsMock.tradeCard.mockResolvedValue({ ticket: stagedTicket, created: true });
    facadeMock.cards.set([c]);
    facadeMock.groups.set([{ key: 'sector:Tech', label: 'Tech', cards: [c] }]);
    fixture.detectChanges();

    const group = fixture.debugElement.query((el) => el.name === 'app-gallery-group')
      .componentInstance as { cardAction: { emit: (v: { type: string; card: GalleryCard }) => void } };
    group.cardAction.emit({ type: 'reject', card: c });
    group.cardAction.emit({ type: 'paper', card: c });
    group.cardAction.emit({ type: 'trade', card: c });
    await fixture.whenStable();

    expect(actionsMock.rejectCard).toHaveBeenCalledWith(c);
    expect(actionsMock.paperCard).toHaveBeenCalledWith(c);
    expect(actionsMock.tradeCard).toHaveBeenCalledWith(c);
    expect(dialogMock.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 't-1' }),
      }),
    );
    // Dialog cancelled (closed while still STAGED) → the created ticket is discarded.
    expect(actionsMock.discardStagedTicket).toHaveBeenCalledWith('t-1');
  });

  it('does not discard a reopened ticket on dialog close (#759)', async () => {
    const c = card('AAPL', 'buy');
    actionsMock.tradeCard.mockResolvedValue({ ticket: { id: 't-9' }, created: false });
    facadeMock.cards.set([c]);
    facadeMock.groups.set([{ key: 'sector:Tech', label: 'Tech', cards: [c] }]);
    fixture.detectChanges();

    const group = fixture.debugElement.query((el) => el.name === 'app-gallery-group')
      .componentInstance as { cardAction: { emit: (v: { type: string; card: GalleryCard }) => void } };
    group.cardAction.emit({ type: 'trade', card: c });
    await fixture.whenStable();

    expect(actionsMock.discardStagedTicket).not.toHaveBeenCalled();
  });
});
