/**
 * #1171 — foundation-mixin consumer migration relay.
 *
 * Sweeps the remaining hand-rolled duplicates of the foundation mixins:
 * error-banner, state-block, stat-strip, dense-table (plain <table>s only),
 * and the duplicate `spin` keyframes. The two `mat-table` holdouts
 * (rs-table, spread-builder-dialog) are NOT in scope — MDC class selectors
 * (.mat-mdc-cell) outrank the mixin's tbody/td rules; they migrate under
 * #1163 De-Materify when the tables convert.
 *
 * Run from the rel-str root:
 *   npx tsx scripts/verify/design-system-foundation-migration-1171.ts
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FEATURES = join(ROOT, 'src', 'app', 'features');
const ST = join(FEATURES, 'savant-trader');
const PD = join(FEATURES, 'portfolio-dashboard');
const PACKAGE_STYLES = join(ROOT, 'vendor', 'savant-ds', 'styles');
const GUIDE = join(ROOT, 'scripts', 'verify', 'design-system-foundation-migration-1171.md');
const RUN_ALL = join(ROOT, 'scripts', 'verify', 'run-all.ts');
const VERIFY_INDEX = join(ROOT, 'scripts', 'verify', 'README.md');

const FILES = {
  paperTrading: join(ST, 'pages', 'paper-trading', 'paper-trading.component.scss'),
  strategyBuilder: join(ST, 'pages', 'strategy-builder', 'strategy-builder.component.scss'),
  optionsDash: join(ST, 'pages', 'options-strategy-dashboard', 'options-strategy-dashboard.component.scss'),
  analysis: join(ST, 'pages', 'analysis', 'analysis.component.scss'),
  scatter: join(ST, 'components', 'analysis-views', 'analysis-scatter.component.scss'),
  histogram: join(ST, 'components', 'analysis-views', 'analysis-histogram.component.scss'),
  flexChart: join(FEATURES, 'shared', 'components', 'flex-chart', 'flex-chart.component.scss'),
  orderQueue: join(ST, 'components', 'order-queue', 'order-queue.component.scss'),
  // chart-review scss was checked here until the page was retired (#1260).
  chainGrid: join(ST, 'pages', 'option-chain', 'components', 'chain-grid.component.scss'),
  runList: join(ST, 'backtest', 'components', 'backtest-run-list', 'backtest-run-list.component.scss'),
  runSummary: join(ST, 'backtest', 'components', 'backtest-run-summary', 'backtest-run-summary.component.scss'),
  permDetail: join(ST, 'backtest', 'components', 'backtest-permutation-detail', 'backtest-permutation-detail.component.scss'),
  signalReview: join(ST, 'pages', 'signal-review', 'signal-review.component.scss'),
  runHistory: join(ST, 'components', 'run-history-panel', 'run-history-panel.component.scss'),
  heatmap: join(FEATURES, 'heatmap-view', 'heatmap-view.component.scss'),
  order: join(ST, 'pages', 'signal-order', 'order.component.scss'),
  allocDetailScss: join(PD, 'allocation-bucket-detail-dialog.component.scss'),
  allocDetailTs: join(PD, 'allocation-bucket-detail-dialog.component.ts'),
  bucketsScss: join(PD, 'allocation-buckets-table.component.scss'),
  bucketsTs: join(PD, 'allocation-buckets-table.component.ts'),
  metrics: join(ST, 'components', 'run-metrics-strip', 'run-metrics-strip.component.scss'),
} as const;

let checks = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) console.log(`OK   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const text = (path: string) => readFileSync(path, 'utf8');
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*/, '')).join('\n');
const hasInclude = (source: string, mixin: string) =>
  new RegExp(`@include\\s+vl\\.${mixin}\\b`).test(stripComments(source));
const importsShim = (source: string) =>
  /@use\s+['"][^'"]*pd-visual-language['"]\s+as\s+vl/.test(stripComments(source));

const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, text(p)])) as Record<keyof typeof FILES, string>;
const exec: Record<keyof typeof FILES, string> = Object.fromEntries(
  Object.entries(src).map(([k, s]) => [k, stripComments(s)]),
) as Record<keyof typeof FILES, string>;

// ── Mixin consumption ────────────────────────────────────────────────────────
const errorBannerFiles = ['paperTrading', 'strategyBuilder', 'optionsDash'] as const;
const stateBlockFiles = [
  'paperTrading', 'strategyBuilder', 'optionsDash', 'analysis', 'scatter', 'histogram',
  'flexChart', 'orderQueue', 'chainGrid', 'runList',
  'runSummary', 'permDetail', 'signalReview', 'runHistory', 'heatmap',
] as const;
const statStripFiles = ['order', 'allocDetailScss', 'bucketsScss'] as const;
// Plain <table> consumers only — mat-table holdouts are #1163 (MDC classes
// outrank the mixin's element selectors).
const denseTableFiles = ['paperTrading', 'strategyBuilder', 'optionsDash'] as const;

for (const key of errorBannerFiles) {
  check(`${key} uses error-banner`, hasInclude(src[key], 'error-banner'));
}
for (const key of stateBlockFiles) {
  check(`${key} uses state-block`, hasInclude(src[key], 'state-block'));
}
for (const key of statStripFiles) {
  check(`${key} uses stat-strip`, hasInclude(src[key], 'stat-strip'));
}
for (const key of denseTableFiles) {
  check(`${key} uses dense-table`, hasInclude(src[key], 'dense-table'));
}
for (const key of [...errorBannerFiles, ...stateBlockFiles, ...statStripFiles, ...denseTableFiles]) {
  check(`${key} imports the visual-language shim`, importsShim(src[key]));
}

// ── Canonical error-banner markup (icon + .error-text child) ────────────────
const BANNER_HTML = {
  paperTrading: join(ST, 'pages', 'paper-trading', 'paper-trading.component.html'),
  strategyBuilder: join(ST, 'pages', 'strategy-builder', 'strategy-builder.component.html'),
  optionsDash: join(ST, 'pages', 'options-strategy-dashboard', 'options-strategy-dashboard.component.html'),
};
for (const key of errorBannerFiles) {
  const html = text(BANNER_HTML[key]);
  check(`${key} banner uses canonical .error-text markup`, /class="error-text"/.test(html));
  check(`${key} banner carries the error mat-icon`, /<mat-icon[^>]*>error<\/mat-icon>/.test(html));
}

// ── Canonical stat-strip markup (inline templates) ──────────────────────────
for (const [key, name] of [['allocDetailTs', 'alloc-detail'], ['bucketsTs', 'buckets-table']] as const) {
  for (const cls of ['sb-item', 'sb-label', 'sb-value'] as const) {
    check(`${name} template uses ${cls}`, new RegExp(`class="sb-`).test(src[key]) && src[key].includes(cls));
  }
}
check('alloc-detail template uses sb-sep', src.allocDetailTs.includes('sb-sep'));

// ── Dead-literal / duplication guards ────────────────────────────────────────
for (const key of errorBannerFiles) {
  check(`${key} drops the #ffebee literal`, !/#ffebee/i.test(exec[key]));
  check(`${key} drops the #c62828 literal`, !/#c62828/i.test(exec[key]));
}
for (const key of ['paperTrading', 'strategyBuilder', 'optionsDash'] as const) {
  check(`${key} drops the rgba(0,0,0,0.54) literal`, !/rgba\(0,\s*0,\s*0,\s*0\.54\)/.test(exec[key]));
}
check('strategy-builder retokenizes the stopped badge', /var\(--mat-sys-error-container\)/.test(exec.strategyBuilder));
check('run-metrics-strip drops local @keyframes spin', !/@keyframes\s+spin\b/.test(exec.metrics));
check('order keeps the local sb-sub rule', /\.sb-sub\b/.test(exec.order));
check('flex-chart keeps the --fc-no-data-text override', /--fc-no-data-text/.test(exec.flexChart));
check('analysis splits empty-state from loading-container', !/\.loading-container\s*,[\s\S]*?\.empty-state\s*\{/.test(exec.analysis));
check('trades-table keeps border-collapse: separate for sticky th', /border-collapse:\s*separate/.test(exec.paperTrading));
check('instances-table keeps its 24px dense-row override', /tbody td\s*\{[^}]*height:\s*24px/.test(exec.strategyBuilder));

// ── Compiled-state assertions ────────────────────────────────────────────────
try {
  const sass: typeof import('sass') = createRequire(join(ROOT, 'package.json'))('sass');
  const allScss = [
    ...errorBannerFiles, ...stateBlockFiles, ...statStripFiles, 'metrics',
  ] as const;
  const unique = [...new Set(allScss)];
  for (const key of unique) {
    const css = sass.compile(FILES[key], { loadPaths: [PACKAGE_STYLES] }).css;
    check(`${key} SCSS compiles`, css.length > 50);
  }
  const bannerCss = sass.compile(FILES.paperTrading, { loadPaths: [PACKAGE_STYLES] }).css;
  check('compiled error-banner reads error-container tokens', /var\(--mat-sys-error-container\)/.test(bannerCss));
  const reviewCss = sass.compile(FILES.signalReview, { loadPaths: [PACKAGE_STYLES] }).css;
  check('compiled state-block reads on-surface-variant', /var\(--mat-sys-on-surface-variant\)/.test(reviewCss));
  const orderCss = sass.compile(FILES.order, { loadPaths: [PACKAGE_STYLES] }).css;
  check('compiled stat-strip emits sb-item', /\.[\w-]+.*\.sb-item|\.sb-item/.test(orderCss));
  // .neg on sb-value must outrank the mixin's `.strip .sb-value` color —
  // plain `.sb-value.neg` ties on specificity and loses on emit order.
  const bucketsCss = sass.compile(FILES.bucketsScss, { loadPaths: [PACKAGE_STYLES] }).css;
  check('expand-stats neg value wins the mixin color', /\.expand-stats \.sb-value\.neg/.test(bucketsCss));
  const dialogCss = sass.compile(FILES.allocDetailScss, { loadPaths: [PACKAGE_STYLES] }).css;
  check('dialog strips keep neg values red', /\.stats-strip \.sb-value\.neg/.test(dialogCss) && /\.pos-stats \.sb-value\.neg/.test(dialogCss));
} catch (err) {
  check('migrated component SCSS compiles', false, String(err).slice(0, 300));
}

// ── Registration ─────────────────────────────────────────────────────────────
check('verification guide exists', existsSync(GUIDE), GUIDE);
check('run-all registers migration relay', text(RUN_ALL).includes("file: 'design-system-foundation-migration-1171.ts'"));
check('verification index registers migration guide', text(VERIFY_INDEX).includes('design-system-foundation-migration-1171.md'));

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
