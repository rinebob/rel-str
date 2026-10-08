/**
 * GalleryGroupComponent spec (#783) — expando panel: label, card count,
 * card grid body, and expansion event pass-through.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { GalleryGroupComponent } from './gallery-group.component';
import { GalleryCardChartStore } from '../../stores/gallery-card-chart.store';
import { GalleryCard, GalleryGroup } from '../../utils/gallery-cards.util';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';

function card(
  symbol: string,
  side: 'buy' | 'sell' = 'buy',
  timeframe: SignalTimeframe = SignalTimeframe.DAILY,
): GalleryCard {
  return {
    key: `${symbol}:${side}`,
    symbol,
    side,
    direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
    profile: { symbol, enabled: true, createdAt: '2026-01-01' },
    occurrences: [{
      id: '2026-08-25',
      symbol,
      barDate: '2026-08-25',
      marketDate: '2026-08-25',
      runId: 'run-1',
      timeframe,
      direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
      signalType: 'RS_RISE',
      status: SignalStatus.INTERIM,
      indicators: {},
    }],
    allOccurrences: [{
      id: '2026-08-25',
      symbol,
      barDate: '2026-08-25',
      marketDate: '2026-08-25',
      runId: 'run-1',
      timeframe,
      direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
      signalType: 'RS_RISE',
      status: SignalStatus.INTERIM,
      indicators: {},
    }],
    status: 'pending',
    allRejected: false,
    actionedAt: '',
  };
}

const GROUP: GalleryGroup = { key: 'sector:Tech', label: 'Tech', cards: [card('AAPL'), card('MSFT')] };

describe('GalleryGroupComponent', () => {
  let fixture: ComponentFixture<GalleryGroupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryGroupComponent],
      providers: [
        provideNoopAnimations(),
        // GalleryCardComponent reads barsFor for the price/change meta —
        // the deferred chart cell never mounts in jsdom (no IO).
        {
          provide: GalleryCardChartStore,
          useValue: { barsFor: () => () => undefined },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryGroupComponent);
    fixture.componentRef.setInput('group', GROUP);
    fixture.componentRef.setInput('expanded', true);
    fixture.componentRef.setInput('actionsDisabled', false);
    fixture.detectChanges();
  });

  it('shows the group label and signal count in the header', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Tech');
    expect(text).toContain('2 signals');
  });

  it('shows daily/weekly and long/short counts in the header', () => {
    fixture.componentRef.setInput('group', {
      key: 'sector:Tech',
      label: 'Tech',
      cards: [
        // D+W buy — the weekly leg lives in the full occurrence set.
        {
          ...card('AAPL'),
          occurrences: [
            ...card('AAPL').occurrences,
            ...card('AAPL', 'buy', SignalTimeframe.WEEKLY).occurrences,
          ],
          allOccurrences: [
            ...card('AAPL').occurrences,
            ...card('AAPL', 'buy', SignalTimeframe.WEEKLY).occurrences,
          ],
        },
        card('TSLA', 'sell'), // D sell
      ],
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('2 signals');
    expect(text).toContain('D 2');
    expect(text).toContain('W 1');
    expect(text).toContain('↑ 1');
    expect(text).toContain('↓ 1');
  });

  it('renders the card grid inside the panel', () => {
    const cardEls = (fixture.nativeElement as HTMLElement).querySelectorAll('app-gallery-card');
    expect(cardEls).toHaveLength(2);
  });

  it('emits expandedChange when the panel is toggled', () => {
    const emitted: boolean[] = [];
    fixture.componentInstance.expandedChange.subscribe((v: boolean) => emitted.push(v));

    const header = (fixture.nativeElement as HTMLElement).querySelector('.mat-expansion-panel-header') as HTMLElement;
    header.click();
    fixture.detectChanges();

    expect(emitted).toEqual([false]);
  });

  it('forwards card actions to the page (#755)', () => {
    const emitted: string[] = [];
    fixture.componentInstance.cardAction.subscribe((a) => emitted.push(a.type));

    (fixture.nativeElement.querySelector('.action-reject') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(emitted).toEqual(['reject']);
  });
});
