/**
 * Tests for screenshot-capture shared contracts — enum surfaces, defaults,
 * and the wire types (Topic #746 / Thread #747 / task #765).
 */

import {
  CaptureEvent,
  ChartInterval,
  PositionType,
  DEFAULT_CAPTURE_INTERVALS,
  DEFAULT_CAPTURE_VISIBLE_BARS,
  VISIBLE_BARS_ALL,
  type CaptureChartSpec,
  type CaptureArtifact,
} from './screenshot-capture-contracts';

describe('screenshot-capture contracts', () => {
  describe('ChartInterval', () => {
    it('carries the lowercase wire values the indicator-series API expects', () => {
      expect(ChartInterval.DAILY).toBe('daily');
      expect(ChartInterval.WEEKLY).toBe('weekly');
      expect(ChartInterval.MONTHLY).toBe('monthly');
    });
  });

  describe('CaptureEvent', () => {
    it('carries the four lifecycle/manual events as lowercase path-safe values', () => {
      expect(CaptureEvent.ORDER_PLACED).toBe('order-placed');
      expect(CaptureEvent.ORDER_FILLED).toBe('order-filled');
      expect(CaptureEvent.POSITION_CLOSED).toBe('position-closed');
      expect(CaptureEvent.MANUAL).toBe('manual');
    });
  });

  describe('PositionType', () => {
    it('is limited to stock in this thread', () => {
      expect(PositionType.STOCK).toBe('stock');
      expect(Object.values(PositionType)).toEqual(['stock']);
    });
  });

  describe('defaults', () => {
    it('defaults to daily + weekly intervals and the quick-charts 30-bar window', () => {
      expect(DEFAULT_CAPTURE_INTERVALS).toEqual([
        ChartInterval.DAILY,
        ChartInterval.WEEKLY,
      ]);
      expect(DEFAULT_CAPTURE_VISIBLE_BARS).toBe(30);
      expect(VISIBLE_BARS_ALL).toBe('all');
    });

    it('the exported default is assignable to the spec field (readonly contract)', () => {
      // Compile-time regression: `intervals?: readonly CaptureInterval[]`
      // must accept DEFAULT_CAPTURE_INTERVALS — mutable [] would fail here.
      const spec: CaptureChartSpec = {
        symbol: 'AAPL',
        intervals: DEFAULT_CAPTURE_INTERVALS,
        event: CaptureEvent.MANUAL,
        positionType: PositionType.STOCK,
      };
      expect(spec.intervals).toHaveLength(2);
    });
  });

  describe('spec/artifact shapes (compile-time surface)', () => {
    it('accepts a minimal spec with required fields only', () => {
      const spec: CaptureChartSpec = {
        symbol: 'AAPL',
        event: CaptureEvent.MANUAL,
        positionType: PositionType.STOCK,
      };
      expect(spec.event).toBe(CaptureEvent.MANUAL);
    });

    it('accepts render params, a refId, and the all-window visibleBars sentinel', () => {
      const spec: CaptureChartSpec = {
        symbol: 'AAPL',
        intervals: [ChartInterval.DAILY],
        event: CaptureEvent.POSITION_CLOSED,
        positionType: PositionType.STOCK,
        refId: 'order-123',
        width: 320,
        height: 560,
        visibleBars: VISIBLE_BARS_ALL,
      };
      expect(spec.visibleBars).toBe('all');
    });

    it('artifact carries interval, inline svg, and per-format storage paths', () => {
      const artifact: CaptureArtifact = {
        interval: ChartInterval.WEEKLY,
        svg: '<svg/>',
        svgPath: 'st-trade-screenshots/AAPL/2026-10-03-143022-manual-stock-weekly.svg',
        pngPath: 'st-trade-screenshots/AAPL/2026-10-03-143022-manual-stock-weekly.png',
      };
      expect(artifact.pngPath).toBeDefined();
    });
  });
});
