/**
 * Verification script for Task #767 — chart data assembler.
 *
 * Runs the real data path end-to-end: Firestore symbol-data bars →
 * computeSymbolIndicatorSeries → assembleRenderModel → renderChartSvg,
 * then validates structural invariants and writes the SVG to
 * .devin/tmp/screenshot-capture-767/ for visual inspection against a live
 * quick-chart.
 *
 * Requires ADC (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS). Firestore project: rel-str.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/screenshot-capture-767-assemble.ts [SYMBOL] [BARS]
 *   SYMBOL  default GOOG
 *   BARS    visibleBars — number or 'all' (default 30)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleChartModels } from '../../src/screenshot-capture/chart-data-loader';
import { renderChartSvg } from '../../src/screenshot-capture/svg-renderer';
import {
  CaptureEvent,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';
import type { VisibleBars } from '@screenshot-capture/contracts';
import type { ChartRenderModel } from '../../src/screenshot-capture/render-model';
import { checkXmlBalance } from './svg-check';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../../../.devin/tmp/screenshot-capture-767');

const SYMBOL = process.argv[2] ?? 'GOOG';
const BARS_ARG = process.argv[3] ?? '30';
const VISIBLE_BARS: VisibleBars = BARS_ARG === 'all' ? 'all' : Number(BARS_ARG);

let checks = 0;
let passed = 0;
const infos: string[] = [];

function check(label: string, condition: boolean): void {
  checks++;
  if (condition) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    console.log(`  ✖ ${label}`);
  }
}

function info(label: string, value: unknown): void {
  infos.push(`${label}: ${value}`);
}

function modelXs(model: ChartRenderModel): number[] {
  return model.panes.flatMap((p) => p.series.flatMap((s) => s.data.map((pt) => pt.x)));
}

async function main(): Promise<void> {
  console.log(`assemble ${SYMBOL} — intervals [daily, weekly], visibleBars=${BARS_ARG}`);

  const charts = await assembleChartModels({
    symbol: SYMBOL,
    event: CaptureEvent.MANUAL,
    positionType: PositionType.STOCK,
    refId: 'verify',
    visibleBars: VISIBLE_BARS,
  });

  check('assembles a model per requested interval', charts.length === 2);
  check(
    'intervals are daily + weekly in order',
    charts[0].interval === ChartInterval.DAILY && charts[1].interval === ChartInterval.WEEKLY,
  );

  for (const { interval, model } of charts) {
    console.log(`\n— ${interval} —`);
    const n = model.bars.length;
    check('bars loaded and sliced to window', n > 0 && (VISIBLE_BARS === 'all' || n <= VISIBLE_BARS));
    check('pane order is FE visual (main, lower-3, lower-2, lower-1)',
      model.panes.map((p) => p.id).join(',') === 'main,lower-3,lower-2,lower-1');
    check('every series point rebased into [0, barCount)', modelXs(model).every((x) => x >= 0 && x < n));

    const main = model.panes[0];
    const mainKinds = main.series.map((s) => s.kind);
    const priceIdx = main.series.findIndex(
      (s) => s.kind === 'candle' && s.upColor === '#26a69a',
    );
    check('band candles precede the price candle on main',
      priceIdx > 0 && mainKinds.slice(0, priceIdx).every((k) => k === 'candle'));

    const lower1 = model.panes.find((p) => p.id === 'lower-1');
    check('lower-1 fixed ±50 axis', lower1?.axisMin === -50 && lower1?.axisMax === 50);
    const lower3 = model.panes.find((p) => p.id === 'lower-3');
    check('lower-3 fixed ±7 axis', lower3?.axisMin === -7 && lower3?.axisMax === 7);

    // Render twice — byte-identical determinism.
    const svgA = renderChartSvg(model);
    const svgB = renderChartSvg(model);
    check('render deterministic', svgA === svgB);
    check('svg contains no NaN/undefined', !/NaN|undefined/.test(svgA));
    check('svg tag balance', checkXmlBalance(svgA) === null);

    info(`${interval} bars`, n);
    info(`${interval} main series`, `${main.series.length} (${mainKinds.join('/')})`);
    info(`${interval} windows layers`, (main.windows ?? []).map((l) => `${l.color}×${l.data.length}`).join(' ') || 'none');
    for (const p of model.panes.slice(1)) {
      info(`${interval} ${p.id} series`, p.series.map((s) => `${s.kind}(${s.data.length})`).join(' ') || 'empty');
    }

    const out = resolve(OUT_DIR, `screenshot-767-${interval}.svg`);
    writeFileSync(out, svgA);
    console.log(`  → wrote ${out}`);
  }

  console.log('\nInfo:');
  infos.forEach((i) => console.log(`  ${i}`));
  console.log(`\n${passed}/${checks} checks passed`);
  if (passed !== checks) process.exitCode = 1;
}

mkdirSync(OUT_DIR, { recursive: true });
main().catch((err) => {
  console.error('verify failed:', err);
  process.exitCode = 1;
});
