/// <reference types="jest" />
/**
 * CompanyInfoStripComponent — inline profile strip in the page header.
 * Renders every StSymbolProfile field; missing fields show an em-dash.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { CompanyInfoStripComponent } from './company-info.component';
import type { StSymbolProfile } from '../../services/types';

const FULL: StSymbolProfile = {
  symbol: 'TSLA',
  enabled: true,
  createdAt: '',
  name: 'Tesla Inc.',
  sector: 'Consumer Cyclical',
  industry: 'Auto Manufacturers',
  exchange: 'NASDAQ',
  marketCap: 1_400_000_000_000,
  marketCapTier: 'mega',
  beta: 2.31,
  peRatio: 78.5,
  week52High: 488.54,
  week52Low: 214.25,
  ma200: 310.4,
  ma50: 295.1,
  dividendYield: 0,
};

describe('CompanyInfoStripComponent', () => {
  let fixture: ComponentFixture<CompanyInfoStripComponent>;
  let component: CompanyInfoStripComponent;

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyInfoStripComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(CompanyInfoStripComponent);
    component = fixture.componentInstance;
  });

  it('renders every profile field inline', () => {
    fixture.componentRef.setInput('symbol', 'TSLA');
    fixture.componentRef.setInput('profile', FULL);
    fixture.detectChanges();
    const t = text();
    expect(t).toContain('TSLA');
    expect(t).toContain('Tesla Inc.');
    expect(t).toContain('Consumer Cyclical');
    expect(t).toContain('Auto Manufacturers');
    expect(t).toContain('NASDAQ');
    expect(t).toContain('1.4T');          // marketCap formatted
    expect(t).toContain('MEGA');          // tier label
    expect(t).toContain('2.31');          // beta
    expect(t).toContain('78.5');          // P/E
    expect(t).toContain('488.54');        // 52w high
    expect(t).toContain('214.25');        // 52w low
    expect(t).toContain('295.1');         // ma50
    expect(t).toContain('310.4');         // ma200
  });

  it('renders dividend yield as a percentage of the raw fraction', () => {
    fixture.componentRef.setInput('symbol', 'KO');
    fixture.componentRef.setInput('profile', { ...FULL, symbol: 'KO', dividendYield: 0.0301 });
    fixture.detectChanges();
    expect(text()).toContain('3.0%');
  });

  it('renders ticker + em-dashes for a missing profile (unsynced symbol)', () => {
    fixture.componentRef.setInput('symbol', 'NEWCO');
    fixture.componentRef.setInput('profile', undefined);
    fixture.detectChanges();
    const t = text();
    expect(t).toContain('NEWCO');
    expect(t).toContain('—');
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('null');
  });

  it('renders em-dashes for sparse fields on a real profile', () => {
    fixture.componentRef.setInput('symbol', 'QQQ');
    fixture.componentRef.setInput('profile', { symbol: 'QQQ', enabled: true, createdAt: '', name: 'Invesco QQQ Trust' });
    fixture.detectChanges();
    const t = text();
    expect(t).toContain('Invesco QQQ Trust');
    expect(t).toContain('—');
    // Both 52w bounds absent → single dash, not a '— – —' artifact.
    expect(t).not.toContain('— – —');
  });

  it('renders the bound present when only one 52w bound exists', () => {
    fixture.componentRef.setInput('symbol', 'X');
    fixture.componentRef.setInput('profile', { ...FULL, symbol: 'X', week52High: undefined, week52Low: 214.25 });
    fixture.detectChanges();
    expect(text()).toContain('214.25 – —');
  });

  it('drops trailing zeros on numeric fields (beta 2.30 → 2.3, P/E 80 → 80)', () => {
    fixture.componentRef.setInput('symbol', 'X');
    fixture.componentRef.setInput('profile', { ...FULL, symbol: 'X', beta: 2.3, peRatio: 80 });
    fixture.detectChanges();
    const t = text();
    expect(t).toContain('2.3');
    expect(t).not.toContain('2.30');
    expect(t).toContain('80');
    expect(t).not.toContain('80.0');
  });
});
