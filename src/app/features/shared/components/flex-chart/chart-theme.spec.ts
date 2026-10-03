import {
  CHART_PALETTES,
  buildLogTickStripLines,
  resolveChartPalette,
} from './chart-theme';

// =============================================================================
// resolveChartPalette
// =============================================================================

describe('resolveChartPalette', () => {
  it('defaults to the dark palette when appearance is omitted', () => {
    expect(resolveChartPalette(undefined)).toBe(CHART_PALETTES.dark);
  });

  it('returns the matching palette for each appearance', () => {
    expect(resolveChartPalette('dark')).toBe(CHART_PALETTES.dark);
    expect(resolveChartPalette('light')).toBe(CHART_PALETTES.light);
  });
});

// =============================================================================
// CHART_PALETTES
// =============================================================================

describe('CHART_PALETTES', () => {
  it('renders bullish candles teal and bearish candles red in both appearances', () => {
    // TradingView convention — previously inverted on the candle series
    // (bullFillColor was red, bearFillColor was teal).
    for (const palette of Object.values(CHART_PALETTES)) {
      expect(palette.candleUp).toBe('#26a69a');
      expect(palette.candleDown).toBe('#ef5350');
    }
  });

  it('dark palette uses a dark surface with light axis text', () => {
    const dark = CHART_PALETTES.dark;
    expect(dark.background).toBe('#131722');
    expect(dark.axisText).toBe('#b2b5be');
    expect(dark.crosshairLine).toBe('#758696');
  });

  it('light palette preserves the pre-theme chrome values', () => {
    const light = CHART_PALETTES.light;
    expect(light.background).toBe('transparent');
    // Syncfusion Material theme default axis-label color.
    expect(light.axisText).toBe('#686868');
    expect(light.axisLine).toBe('#9e9e9e');
    expect(light.gridLine).toBe('rgba(158,158,158,0.3)');
    expect(light.logTickLine).toBe('rgba(158,158,158,0.35)');
    expect(light.crosshairLine).toBe('#000000');
    expect(light.logAxisLabel).toBe('#9e9e9e');
  });
});

// =============================================================================
// Indicator color slots + emitted-hex remap — Task #734
//
// Indicator calculators and external dot builders emit the light-vocabulary
// hexes everywhere (per-point colors, band colors, default options). The
// adapter remaps known hexes through `palette.colorRemap`; light is identity,
// dark swaps muted Material tones for vibrant variants.
// =============================================================================

describe('CHART_PALETTES indicator colors', () => {
  it('dark palette lifts muted blues and greys to vibrant variants', () => {
    const remap = CHART_PALETTES.dark.colorRemap;
    expect(remap['#2196f3']).toBe('#3da5ff');
    expect(remap['#4caf50']).toBe('#33d17a');
    expect(remap['#f44336']).toBe('#ff5252');
    // Darkest std-dev grey is nearly invisible on the dark surface.
    expect(remap['#424242']).toBe('#6b7383');
    // Trend bands unify on the trend-strength yellow/blue vocabulary.
    expect(remap['#ff9800']).toBe('#ffeb3b');
    expect(remap['#1565c0']).toBe('#3da5ff');
  });

  it('dark palette exposes vibrant series fallback slots', () => {
    const dark = CHART_PALETTES.dark;
    expect(dark.seriesLine).toBe('#3da5ff');
    expect(dark.seriesSignal).toBe('#ff4081');
    expect(dark.seriesColumn).toBe('#26a69a');
    expect(dark.seriesColumnHtf).toBe('#4d8dff');
    expect(dark.scatterConnector).toBe('#8f97a3');
  });

  it('light palette leaves emitted indicator colors untouched', () => {
    expect(CHART_PALETTES.light.colorRemap).toEqual({});
    expect(CHART_PALETTES.light.seriesLine).toBe('#2196f3');
    expect(CHART_PALETTES.light.seriesSignal).toBe('#e91e63');
    expect(CHART_PALETTES.light.seriesColumn).toBe('#26a69a');
    expect(CHART_PALETTES.light.seriesColumnHtf).toBe('#0d47a1');
    expect(CHART_PALETTES.light.scatterConnector).toBe('#9e9e9e');
  });
});

// =============================================================================
// buildLogTickStripLines — log-mode gridlines carry the palette color
// =============================================================================

describe('buildLogTickStripLines', () => {
  it('builds a 1px stripLine per tick in the palette color', () => {
    const lines = buildLogTickStripLines([100, 200], CHART_PALETTES.dark);
    expect(lines).toHaveLength(2);
    for (const [i, line] of lines.entries()) {
      expect(line.start).toBe([100, 200][i]);
      expect(line.size).toBe(1);
      expect(line.sizeType).toBe('Pixel');
      expect(line.color).toBe(CHART_PALETTES.dark.logTickLine);
      expect(line.visible).toBe(true);
    }
  });

  it('uses the light palette color under the light appearance', () => {
    const lines = buildLogTickStripLines([50], CHART_PALETTES.light);
    expect(lines[0].color).toBe(CHART_PALETTES.light.logTickLine);
  });
});
