/// <reference types="jest" />
/**
 * Price label formatting — axis labels, tooltips, gutter labels.
 */
import { formatPrice } from './price-format';

describe('formatPrice', () => {
  it('rounds dollar-and-up prices with thousands separators', () => {
    expect(formatPrice(1234.56)).toBe('$1,235');
    expect(formatPrice(95.42)).toBe('$95');
    expect(formatPrice(1)).toBe('$1');
  });

  it('keeps sub-dollar ticks readable — no collapse to "$0"', () => {
    expect(formatPrice(0.15)).toBe('$0.15');
    expect(formatPrice(0.5)).toBe('$0.5');
    // The log-axis floor — must not render "$0".
    expect(formatPrice(0.001)).toBe('$0.001');
  });
});
