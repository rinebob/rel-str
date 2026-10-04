/**
 * Verification script for Task #766 — SVG chart renderer.
 *
 * Renders a deterministic render-model fixture that exercises every series
 * kind (band candles, price candles, range fill, line, scatter overlays,
 * columns, HTF window, reference lines) plus header, event marker, and
 * panes — then validates the output structurally and writes the SVG to
 * .devin/tmp/ for visual inspection in a browser.
 *
 * This is the render stage only — no Firestore/Storage access (#767/#768
 * cover data assembly and persistence).
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/screenshot-capture-766-render.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderChartSvg } from '../../src/screenshot-capture/svg-renderer';
import type { ChartRenderModel } from '../../src/screenshot-capture/render-model';
import { CaptureEvent, ChartInterval, PositionType } from '@screenshot-capture/contracts';
import { checkXmlBalance } from './svg-check';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../../.devin/tmp/screenshot-capture-766');
const WIDTH = 800;
const HEIGHT = 560;

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  if (condition) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    console.log(`  ✖ ${label}`);
  }
}

// ── Fixture ──────────────────────────────────────────────────────────────────

/** 30 daily bars — a slow uptrend with a pullback, OHLC consistent. */
function fixtureBars(): ChartRenderModel['bars'] {
  const closes = [
    98, 99, 101, 100, 102, 104, 103, 105, 108, 107,
    106, 104, 102, 103, 101, 103, 105, 107, 109, 110,
    112, 111, 113, 115, 114, 116, 118, 117, 119, 121,
  ];
  return closes.map((close, i) => {
    const open = i === 0 ? 97 : closes[i - 1];
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String(9 + Math.floor(i / 28)).padStart(2, '0');
    return {
      date: `2026-${month}-${day}`,
      open,
      high: Math.max(open, close) + 1.5,
      low: Math.min(open, close) - 1.5,
      close,
    };
  });
}

function fixtureModel(): ChartRenderModel {
  const bars = fixtureBars();
  return {
    symbol: 'GOOG',
    interval: ChartInterval.DAILY,
    event: CaptureEvent.ORDER_FILLED,
    positionType: PositionType.STOCK,
    refId: 'ord123',
    timestampIso: '2026-10-03T14:30:22Z',
    width: WIDTH,
    height: HEIGHT,
    logScale: true,
    bars,
    panes: [
      {
        id: 'main',
        // HTF zone window — pane background shading.
        windows: [{ data: [{ x0: 4, x1: 11 }], color: '#2196f3', opacity: 0.12 }],
        series: [
          // Two trend-band candle layers behind price (FE zOrder -1).
          {
            kind: 'candle',
            data: bars.map((b, x) => ({
              x,
              open: b.open + 1.2,
              close: b.close + 0.6,
              high: Math.max(b.open, b.close) + 1.6,
              low: Math.min(b.open, b.close) + 0.2,
            })),
            upColor: '#ffeb3b',
            downColor: '#2196f3',
          },
          {
            kind: 'candle',
            data: bars.map((b, x) => ({
              x,
              open: b.open + 0.4,
              close: b.close - 0.2,
              high: Math.max(b.open, b.close) + 0.8,
              low: Math.min(b.open, b.close) - 0.4,
            })),
            upColor: '#ff9800',
            downColor: '#1565c0',
          },
          // Price candles.
          {
            kind: 'candle',
            data: bars.map((b, x) => ({ x, open: b.open, high: b.high, low: b.low, close: b.close })),
            upColor: '#26a69a',
            downColor: '#ef5350',
          },
          // Std-dev fill zone + center/band lines.
          {
            kind: 'range',
            data: bars.map((b, x) => ({ x, high: b.high + 7, low: b.low - 7 })),
            color: '#9e9e9e',
            opacity: 0.12,
          },
          {
            kind: 'line',
            data: bars.map((b, x) => ({ x, y: b.high + 7 })),
            color: '#bdbdbd',
            width: 1,
            dashArray: '4,2',
          },
          {
            kind: 'line',
            data: bars.map((b, x) => ({ x, y: b.low - 7 })),
            color: '#bdbdbd',
            width: 1,
            dashArray: '4,2',
          },
          {
            kind: 'line',
            data: bars.map((b, x) => ({ x, y: (b.high + b.low) / 2 })),
            color: '#e0e0e0',
            width: 1.5,
          },
          // Uptick dots overlay.
          {
            kind: 'scatter',
            data: [
              { x: 9, y: bars[9].high + 3, color: '#4caf50' },
              { x: 16, y: bars[16].low - 3, color: '#f44336' },
              { x: 24, y: bars[24].high + 3, color: '#8bc34a' },
            ],
            color: '#9e9e9e',
            radius: 5,
          },
        ],
      },
      // FE visual order: lower slots stack top→bottom descending
      // (main, lower-4 … lower-1) — so lower-3 renders above lower-1.
      {
        id: 'lower-3',
        axisMin: -7,
        axisMax: 7,
        series: [
          {
            kind: 'scatter',
            data: bars.filter((_, x) => x % 4 === 0).map((_, k) => ({ x: k * 4, y: 4 * Math.sin(k / 2) })),
            color: '#9e9e9e',
            radius: 2,
          },
        ],
      },
      {
        id: 'lower-1',
        axisMin: -50,
        axisMax: 50,
        referenceLines: [
          { value: 0, color: '#9e9e9e', dashArray: '4,3' },
          { value: 10, color: 'rgba(158,158,158,0.5)', dashArray: '4,3' },
          { value: -10, color: 'rgba(158,158,158,0.5)', dashArray: '4,3' },
        ],
        series: [
          // HTF companion column behind the primary (FE draws y2 first).
          {
            kind: 'column',
            data: bars.map((_, x) => ({ x, y: 30 * Math.sin(x / 5) })),
            color: '#0d47a1',
            widthFactor: 0.75,
            opacity: 0.7,
          },
          {
            kind: 'column',
            data: bars.map((_, x) => ({ x, y: 35 * Math.sin(x / 3) })),
            color: '#2196f3',
          },
          // Signal dots on the same pane.
          {
            kind: 'scatter',
            data: [{ x: 6, y: 30, color: '#4caf50' }, { x: 15, y: -28, color: '#f44336' }],
            color: '#9e9e9e',
            radius: 2,
          },
        ],
      },
    ],
  };
}

// ── Checks ───────────────────────────────────────────────────────────────────

const svg = renderChartSvg(fixtureModel());

console.log('\nScreenshot capture #766 — SVG renderer verification\n');

check('root <svg> with xmlns + viewBox', svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.includes('viewBox="0 0 800 560"'));
check('bar-grid metadata present', /data-plot-x="4" data-bar-width="[\d.]+" data-bar-count="30"/.test(svg));
check('XML tag balance', checkXmlBalance(svg) === null);
check('no NaN/undefined leaked into output', !svg.includes('NaN') && !svg.includes('undefined'));
check('header fields present', ['GOOG', 'order-filled', '2026-10-03T14:30:22Z', 'stock', 'ord123', 'daily'].every((f) => svg.includes(f)));
check('event marker drawn (amber dashed vline)', svg.includes('stroke="#ffb300"') && svg.includes('stroke-dasharray="4,3"'));
check('price axis labels on the right', svg.includes(`x="${WIDTH - 60 + 4}"`));
check('deterministic', renderChartSvg(fixtureModel()) === svg);
check('pane clip-paths emitted and referenced', (svg.match(/<clipPath/g) ?? []).length === 3 && (svg.match(/<g clip-path/g) ?? []).length === 3);

const outPath = resolve(OUT_DIR, 'screenshot-766-daily.svg');
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(outPath, svg);
console.log(`\n  SVG written for visual inspection:\n  ${outPath}`);
console.log('  Open it in a browser — expect dark surface, teal/red candles,');
console.log('  band layers behind price, dashed std-dev lines, an amber dashed');
console.log('  event marker on the last bar, and two lower panes below price.\n');

console.log(`=== ${passed}/${checks} checks passed ===`);
process.exit(passed === checks ? 0 : 1);
