/// <reference types="jest" />
/** Tests for sliceSvgRight — right-anchored native-scale variant windows. */
import { sliceSvgRight } from './svg-slice.util';

const SVG =
  '<svg viewBox="0 0 800 560" width="800" height="560" data-plot-x="4"><text>x</text></svg>';

describe('sliceSvgRight', () => {
  it('slices the rightmost N units: viewBox + size attrs stay consistent', () => {
    const out = sliceSvgRight(SVG, 180);
    expect(out).toContain('viewBox="620 0 180 560"');
    expect(out).toContain('width="180" height="560"');
  });

  it('returns the input unchanged when the svg already fits', () => {
    expect(sliceSvgRight(SVG, 800)).toBe(SVG);
    expect(sliceSvgRight(SVG, 1200)).toBe(SVG);
  });

  it('returns the input unchanged when the viewBox is missing', () => {
    const bare = '<svg><text>y</text></svg>';
    expect(sliceSvgRight(bare, 180)).toBe(bare);
  });

  it('inserts size attrs when the svg root lacks them', () => {
    const noAttrs = '<svg viewBox="0 0 800 560"><text>y</text></svg>';
    expect(sliceSvgRight(noAttrs, 180)).toContain('width="180" height="560"');
  });
});
