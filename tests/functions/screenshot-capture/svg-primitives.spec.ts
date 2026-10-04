/**
 * SVG primitive tests — number normalization, XML escaping, stroke-attr
 * emission. Small contract surface, but the -0 normalization and escaping
 * are what keep the renderer's determinism guarantee honest.
 */
import {
  escapeXml,
  n2,
  polyline,
  text,
} from '../../../functions/src/screenshot-capture/svg-primitives';

describe('n2', () => {
  it('rounds to 2 decimals', () => {
    expect(n2(1.007)).toBe('1.01');
    expect(n2(24.5333)).toBe('24.53');
    expect(n2(100)).toBe('100');
  });

  it('normalizes -0 to 0', () => {
    expect(n2(-0.001)).toBe('0');
    expect(n2(-0)).toBe('0');
    expect(n2(-0.001)).not.toBe('-0');
  });
});

describe('escapeXml', () => {
  it('escapes all five XML entities', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });
});

describe('polyline', () => {
  it('emits optional stroke attrs only when provided', () => {
    const plain = polyline([{ px: 0, py: 0 }, { px: 1, py: 1 }], '#fff');
    expect(plain).not.toContain('stroke-width');
    expect(plain).not.toContain('stroke-dasharray');
    expect(plain).not.toContain('stroke-opacity');

    const full = polyline([{ px: 0, py: 0 }], '#fff', { width: 2, dashArray: '4,2', opacity: 0.5 });
    expect(full).toContain('stroke-width="2"');
    expect(full).toContain('stroke-dasharray="4,2"');
    expect(full).toContain('stroke-opacity="0.5"');
  });

  it('returns empty string for empty input', () => {
    expect(polyline([], '#fff')).toBe('');
  });
});

describe('text', () => {
  it('escapes content and requires explicit fill', () => {
    const s = text(1, 2, '<script>', { fill: '#fff', size: 9 });
    expect(s).toContain('&lt;script&gt;');
    expect(s).toContain('fill="#fff"');
  });
});
