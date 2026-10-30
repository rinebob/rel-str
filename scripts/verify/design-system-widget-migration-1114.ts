/**
 * #1114 — signals/review widget-mixin migration relay.
 *
 * Run from the rel-str root:
 *   npx tsx scripts/verify/design-system-widget-migration-1114.ts
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = join(ROOT, 'src', 'app', 'features', 'savant-trader', 'components');
const PACKAGE_STYLES = join(ROOT, 'vendor', 'savant-ds', 'styles');
const GUIDE = join(ROOT, 'scripts', 'verify', 'design-system-widget-migration-1114.md');
const RUN_ALL = join(ROOT, 'scripts', 'verify', 'run-all.ts');
const VERIFY_INDEX = join(ROOT, 'scripts', 'verify', 'README.md');

const targets = {
  filter: join(COMPONENTS, 'signal-filter-pills', 'signal-filter-pills.component.scss'),
  signalHeader: join(COMPONENTS, 'signal-review-header', 'signal-review-header.component.scss'),
  signalHeaderHtml: join(COMPONENTS, 'signal-review-header', 'signal-review-header.component.html'),
  // review-header checks were dropped when the component was retired (#1260).
  table: join(COMPONENTS, 'signal-table', 'signal-table.component.scss'),
  tableHtml: join(COMPONENTS, 'signal-table', 'signal-table.component.html'),
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

const filter = text(targets.filter);
const signalHeader = text(targets.signalHeader);
const signalHeaderHtml = text(targets.signalHeaderHtml);
const table = text(targets.table);
const tableHtml = text(targets.tableHtml);

for (const [label, source] of [
  ['signal-filter-pills', filter],
  ['signal-review-header', signalHeader],
  ['signal-table', table],
] as const) {
  check(
    `${label} imports the real visual-language shim`,
    /@use\s+['"]\.\.\/\.\.\/\.\.\/portfolio-dashboard\/styles\/pd-visual-language['"]\s+as\s+vl/.test(source),
  );
}

for (const mixin of ['pill-toggle']) check(`signal-filter-pills uses ${mixin}`, hasInclude(filter, mixin));
for (const mixin of ['toolbar-row', 'pill-btn', 'badge']) {
  check(`signal-review-header uses ${mixin}`, hasInclude(signalHeader, mixin));
}
for (const mixin of ['badge', 'dir-edge']) check(`signal-table uses ${mixin}`, hasInclude(table, mixin));

for (const [name, source, pattern] of [
  ['signal header toolbar spacer', signalHeaderHtml, /class="toolbar-spacer"/],
  ['signal header timeframe badges', signalHeaderHtml, /class="badge tf"/],
  ['signal header long badge', signalHeaderHtml, /class="badge dir-long"/],
  ['signal header short badge', signalHeaderHtml, /class="badge dir-short"/],
  ['signal total emphasis', signalHeaderHtml, /class="pill-btn emph"/],
  ['signal table direction badge', tableHtml, /class="badge"/],
  ['signal table long edge', tableHtml, /class\.dir-edge-long/],
  ['signal table short edge', tableHtml, /class\.dir-edge-short/],
] as const) {
  check(name, pattern.test(source));
}

check('review/order pill variants remain local', /&\.review\b/.test(signalHeader) && /&\.order\b/.test(signalHeader));

const retiredDirectionLiterals = [
  ['#4caf50', /#4caf50/i],
  ['#f44336', /#f44336/i],
  ['rgba(76,175,80)', /rgba\(\s*76\s*,\s*175\s*,\s*80\s*,/i],
] as const;
for (const [label, source] of [
  ['signal-filter-pills', filter],
  ['signal-review-header', signalHeader],
  ['signal-table', table],
] as const) {
  const executable = stripComments(source);
  for (const [literal, pattern] of retiredDirectionLiterals) {
    check(`${label} omits retired direction literal ${literal}`, !pattern.test(executable));
  }
}

check('verification guide exists', existsSync(GUIDE), GUIDE);
check(
  'run-all registers migration relay',
  text(RUN_ALL).includes("file: 'design-system-widget-migration-1114.ts'"),
);
check(
  'verification index registers migration guide',
  text(VERIFY_INDEX).includes('design-system-widget-migration-1114.md'),
);

try {
  const sass: typeof import('sass') = createRequire(join(ROOT, 'package.json'))('sass');
  for (const path of [targets.filter, targets.signalHeader, targets.table]) {
    const css = sass.compile(path, { loadPaths: [PACKAGE_STYLES] }).css;
    check(`${path.split(/[\\/]/).at(-2)} SCSS compiles`, css.length > 100);
  }
} catch (err) {
  check('migrated component SCSS compiles', false, String(err).slice(0, 300));
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
