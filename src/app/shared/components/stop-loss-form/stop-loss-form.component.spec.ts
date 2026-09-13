import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { StopLossFormComponent } from './stop-loss-form.component';

describe('StopLossFormComponent', () => {
  let fixture: ComponentFixture<StopLossFormComponent>;
  let component: StopLossFormComponent;

  function setInput(el: HTMLElement, selector: string, value: string): void {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function clickStepper(el: HTMLElement, ariaLabel: string): void {
    const btn = el.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement;
    btn.click();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StopLossFormComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(StopLossFormComponent);
    component = fixture.componentInstance;
  });

  describe('initialization', () => {
    it('initializes stop percent to DEFAULT_STOP_PERCENT', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      expect(component.stopLossPercent()).toBe('8');
    });

    it('initializes stop price from reference price and default percent', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      // 150 * (1 - 8/100) = 138.00
      expect(component.stopLossPrice()).toBe('138.00');
    });

    it('leaves stop price empty when reference price is null', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', null);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      expect(component.stopLossPrice()).toBe('');
    });
  });

  describe('bidirectional linking', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();
    });

    it('updates stop percent when stop price changes', () => {
      const inputEl = fixture.nativeElement.querySelector('.sl-input[placeholder="0.00"]') as HTMLInputElement;
      inputEl.value = '140.00';
      inputEl.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // ((150 - 140) / 150) * 100 = 6.7 (rounded to 1 decimal)
      expect(component.stopLossPercent()).toBe('6.7');
    });

    it('updates stop price when stop percent changes', () => {
      const inputEl = fixture.nativeElement.querySelector('.sl-input[placeholder="8.0"]') as HTMLInputElement;
      inputEl.value = '5';
      inputEl.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // 150 * (1 - 5/100) = 142.50
      expect(component.stopLossPrice()).toBe('142.50');
    });

    it('leaves stop percent unchanged when reference price is zero', () => {
      fixture.componentRef.setInput('referencePrice', 0);
      fixture.detectChanges();

      // Simulate user typing stop price — with ref price 0, percent can't be computed
      const inputEl = fixture.nativeElement.querySelector('.sl-input[placeholder="0.00"]') as HTMLInputElement;
      inputEl.value = '100.00';
      inputEl.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Percent stays at default since ref price is 0 (can't compute meaningful percent)
      expect(component.stopLossPercent()).toBe('8');
    });
  });

  describe('dollar risk', () => {
    it('computes dollar risk as shares × (reference price − stop price)', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      // Default: stop at 138.00, risk = 100 × (150 - 138) = 1200
      expect(component.dollarRisk()).toBe(1200);
    });

    it('updates dollar risk when stop price changes', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      component.stopLossPrice.set('145.00');
      fixture.detectChanges();

      // risk = 100 × (150 - 145) = 500
      expect(component.dollarRisk()).toBe(500);
    });

    it('returns 0 when stop price is invalid', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      component.stopLossPrice.set('');
      fixture.detectChanges();

      expect(component.dollarRisk()).toBe(0);
    });

    it('returns 0 when quantity is invalid', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '0');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      expect(component.dollarRisk()).toBe(0);
    });
  });

  describe('canPlace', () => {
    it('returns true when stop price > 0 and quantity > 0', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      expect(component.canPlace()).toBe(true);
    });

    it('returns false when stop price is 0 or invalid', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      component.stopLossPrice.set('0');
      fixture.detectChanges();

      expect(component.canPlace()).toBe(false);
    });

    it('returns false when quantity is 0', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '0');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      expect(component.canPlace()).toBe(false);
    });
  });

  describe('preview', () => {
    it('shows correct order parameters', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      const preview = component.preview();
      expect(preview).toEqual({
        symbol: 'AAPL',
        side: 'sell',
        orderType: 'stop_market',
        quantity: '100',
        stopPrice: '138.00',
        stopLossPercent: '8',
        timeInForce: 'gtc',
        marketHours: 'regular_hours',
        accountNumber: 'acc-1',
      });
    });
  });

  describe('placeStopLoss output', () => {
    it('emits placeStopLoss with stop price when onPlace is called', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      let emitted: { stopPrice: number } | null = null;
      component.placeStopLoss.subscribe((e: { stopPrice: number }) => (emitted = e));

      component.onPlace();

      expect(emitted).toEqual({ stopPrice: 138 });
    });

    it('does not emit when canPlace is false', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '0');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      let emitted = false;
      component.placeStopLoss.subscribe(() => (emitted = true));

      component.onPlace();

      expect(emitted).toBe(false);
    });
  });

  describe('stepper methods', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();
    });

    it('stopPriceUp increments stop price by 0.25', () => {
      component.stopLossPrice.set('138.00');
      component.stopPriceUp();

      // stepPrice nudges to avoid round endings (0 or 5): 138.25 → 138.27
      expect(component.stopLossPrice()).toBe('138.27');
    });

    it('stopPriceDown decrements stop price by 0.25', () => {
      component.stopLossPrice.set('138.00');
      component.stopPriceDown();

      // stepPrice nudges to avoid round endings (0 or 5): 137.75 → 137.77
      expect(component.stopLossPrice()).toBe('137.77');
    });

    it('stopPercentUp increments stop percent by 0.5', () => {
      component.stopLossPercent.set('8');
      component.stopPercentUp();

      expect(component.stopLossPercent()).toBe('8.5');
    });

    it('stopPercentDown decrements stop percent by 0.5', () => {
      component.stopLossPercent.set('8');
      component.stopPercentDown();

      expect(component.stopLossPercent()).toBe('7.5');
    });
  });

  describe('template rendering', () => {
    it('renders stop price and stop percent inputs', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.sl-input[placeholder="0.00"]')).toBeTruthy();
      expect(el.querySelector('.sl-input[placeholder="8.0"]')).toBeTruthy();
    });

    it('renders dollar risk display', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('$1,200.00');
    });

    it('renders submit button disabled when canPlace is false', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '0');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('button[color="warn"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('renders submit button enabled when canPlace is true', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const btn = el.querySelector('button[color="warn"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('does not clobber user edits when reference price changes after editing', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      // User edits stop price
      const inputEl = fixture.nativeElement.querySelector('.sl-input[placeholder="0.00"]') as HTMLInputElement;
      inputEl.value = '140.00';
      inputEl.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Reference price changes (e.g., live price tick)
      fixture.componentRef.setInput('referencePrice', 160);
      fixture.detectChanges();

      // Stop price should NOT be reset to default — user edit preserved
      expect(component.stopLossPrice()).toBe('140.00');
    });

    it('returns 0 dollar risk for negative stop price', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      component.stopLossPrice.set('-10');
      fixture.detectChanges();

      expect(component.dollarRisk()).toBe(0);
      expect(component.canPlace()).toBe(false);
    });

    it('handles empty quantity string', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      expect(component.dollarRisk()).toBe(0);
      expect(component.canPlace()).toBe(false);
    });

    it('handles fractional quantity by truncating to whole shares', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100.5');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.detectChanges();

      // parseInt truncates — 100 shares used for risk calculation
      // Default stop at 138.00, risk = 100 × (150 - 138) = 1200
      expect(component.dollarRisk()).toBe(1200);
    });

    it('disables inputs and submit button when disabled input is true', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const inputs = el.querySelectorAll('.sl-input');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).disabled).toBe(true);
      });
      const btn = el.querySelector('button[color="warn"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('does not emit placeStopLoss when disabled', () => {
      fixture.componentRef.setInput('symbol', 'AAPL');
      fixture.componentRef.setInput('quantity', '100');
      fixture.componentRef.setInput('referencePrice', 150);
      fixture.componentRef.setInput('accountNumber', 'acc-1');
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();

      let emitted = false;
      component.placeStopLoss.subscribe(() => (emitted = true));

      component.onPlace();

      expect(emitted).toBe(false);
    });
  });
});

