/**
 * ScannerChartPopupComponent spec (#1098/#1307) — the chart popup chrome
 * rendered inside the recipe table's cdkConnectedOverlay. Pins the
 * header (symbol + name), the tracked-mode fork, and the fetch-state
 * shells: loading spinner, error text, and the auth branch's reauth
 * affordance (the page owns the reauth flow — the popup only emits).
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScannerChartPopupComponent } from './scanner-chart-popup.component';

describe('ScannerChartPopupComponent', () => {
  let fixture: ComponentFixture<ScannerChartPopupComponent>;

  function mount(extras: {
    name?: string;
    tracked?: boolean;
    state?: 'loading' | 'error' | 'auth';
    error?: string | null;
  } = {}): void {
    fixture = TestBed.createComponent(ScannerChartPopupComponent);
    fixture.componentRef.setInput('symbol', 'AAPL');
    if (extras.name !== undefined) {
      fixture.componentRef.setInput('name', extras.name);
    }
    if (extras.tracked !== undefined) {
      fixture.componentRef.setInput('tracked', extras.tracked);
    }
    if (extras.state !== undefined) {
      fixture.componentRef.setInput('state', extras.state);
    }
    if (extras.error !== undefined) {
      fixture.componentRef.setInput('error', extras.error);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScannerChartPopupComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders the symbol + name header', () => {
    mount({ name: 'Apple Inc' });
    const head = el().querySelector('.popup-head')!;
    expect(head.textContent).toContain('AAPL');
    expect(head.textContent).toContain('Apple Inc');
  });

  it('omits the name span when the row carries no display name', () => {
    mount({});
    expect(el().querySelector('.popup-head')!.textContent).toContain('AAPL');
    expect(el().querySelector('.popup-name')).toBeNull();
  });

  it('marks the body with the tracked-mode fork for the chart tasks', () => {
    mount({ tracked: true });
    expect(
      el().querySelector('.popup-body')!.getAttribute('data-mode'),
    ).toBe('tracked');
  });

  it('marks the body untracked for new rows', () => {
    mount({ tracked: false });
    expect(
      el().querySelector('.popup-body')!.getAttribute('data-mode'),
    ).toBe('untracked');
  });

  it('shows the loading state by default — a spinner, not a blank frame', () => {
    mount({});
    const body = el().querySelector('.popup-body')!;
    expect(body.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(body.textContent).toContain('Loading chart');
  });

  it('error state renders the failure message, not a blank frame', () => {
    mount({ state: 'error', error: 'get_equity_historicals failed' });
    const body = el().querySelector('.popup-body')!;
    expect(body.textContent).toContain('get_equity_historicals failed');
    expect(body.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('error state without a message falls back to honest copy', () => {
    mount({ state: 'error' });
    expect(el().querySelector('.popup-body')!.textContent).toContain(
      'Chart unavailable',
    );
  });

  it('auth state surfaces the reauth affordance and emits on click', () => {
    mount({ state: 'auth' });
    let fired = 0;
    fixture.componentInstance.reauth.subscribe(() => fired++);
    const btn = el().querySelector<HTMLButtonElement>(
      '.popup-body button',
    )!;
    expect(btn.textContent).toContain('Re-authorize');
    btn.click();
    expect(fired).toBe(1);
  });

  it('containsFocus reports focus inside the popup (grace guard)', () => {
    mount({ state: 'auth' });
    expect(fixture.componentInstance.containsFocus()).toBe(false);
    const btn = el().querySelector<HTMLElement>('.popup-body button')!;
    btn.focus();
    expect(fixture.componentInstance.containsFocus()).toBe(true);
    btn.blur();
  });

  it('emits openChart from the header deep-link affordance in every state', () => {
    mount({ state: 'auth' });
    let fired = 0;
    fixture.componentInstance.openChart.subscribe(() => fired++);
    const btn = el().querySelector<HTMLButtonElement>(
      '[data-testid="open-chart-btn"]',
    )!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(fired).toBe(1);
  });

  it('Enter lands on the body affordance, not the header deep-link button', () => {
    mount({ state: 'auth' });
    fixture.componentInstance.focusPrimary();
    expect(
      document.activeElement?.textContent?.includes('Re-authorize'),
    ).toBe(true);
  });
});
