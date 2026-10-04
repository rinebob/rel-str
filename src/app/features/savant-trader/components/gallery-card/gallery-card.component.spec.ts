/**
 * GalleryCardComponent spec (#754) — renders the card shell's signal details.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { GalleryCardComponent } from './gallery-card.component';
import { GalleryCard } from '../../utils/gallery-cards.util';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';

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
  };
}

describe('GalleryCardComponent', () => {
  let fixture: ComponentFixture<GalleryCardComponent>;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryCardComponent],
      providers: [provideNoopAnimations()],
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
});
