/**
 * #1115 — chart/gallery widget-mixin migration relay.
 *
 * Run from the rel-str root:
 *   npx tsx scripts/verify/design-system-widget-migration-1115.ts
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = join(ROOT, 'src', 'app', 'features', 'savant-trader', 'components');
const PACKAGE_STYLES = join(ROOT, 'vendor', 'savant-ds', 'styles');
const GUIDE = join(ROOT, 'scripts', 'verify', 'design-system-widget-migration-1115.md');
const RUN_ALL = join(ROOT, 'scripts', 'verify', 'run-all.ts');
const VERIFY_INDEX = join(ROOT, 'scripts', 'verify', 'README.md');

const chartScssPath = join(COMPONENTS, 'chart-toolbar', 'chart-toolbar.component.scss');
const chartHtmlPath = join(COMPONENTS, 'chart-toolbar', 'chart-toolbar.component.html');
const groupScssPath = join(COMPONENTS, 'group-panel', 'group-panel.component.scss');
const groupHtmlPath = join(COMPONENTS, 'group-panel', 'group-panel.component.html');

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

const chartScss = text(chartScssPath);
const chartHtml = text(chartHtmlPath);
const groupScss = text(groupScssPath);
const groupHtml = text(groupHtmlPath);

for (const [label, source] of [['chart-toolbar', chartScss], ['group-panel', groupScss]] as const) {
  check(
    `${label} imports the real visual-language shim`,
    /@use\s+['"]\.\.\/\.\.\/\.\.\/portfolio-dashboard\/styles\/pd-visual-language['"]\s+as\s+vl/.test(source),
  );
}

for (const mixin of ['toolbar-row', 'icon-btn', 'pill-toggle', 'nav-stepper']) {
  check(`chart-toolbar uses ${mixin}`, hasInclude(chartScss, mixin));
}
check('group-panel uses icon-btn', hasInclude(groupScss, 'icon-btn'));
check('group-panel uses badge', hasInclude(groupScss, 'badge'));

const widgetSource = stripComments(text(join(PACKAGE_STYLES, '_widgets.scss')));
const flatActive = /&\.flat\s+#\{\$option\}\.active\s*\{([\s\S]*?)\}/.exec(widgetSource)?.[1] ?? '';
check(
  'flat active pill has a distinct filled background',
  /background:\s*var\(--mat-sys-primary\)/.test(flatActive),
);
check(
  'flat active pill uses matching foreground',
  /color:\s*var\(--mat-sys-on-primary\)/.test(flatActive),
);

for (const [name, source, pattern] of [
  ['chart toolbar root', chartHtml, /class="chart-toolbar"/],
  ['chart icon button', chartHtml, /class="icon-btn"/],
  ['chart dim icon state', chartHtml, /\[class\.dim\]/],
  ['chart pill options', chartHtml, /class="pill"/],
  ['chart toolbar spacer', chartHtml, /class="toolbar-spacer"/],
  ['chart nav stepper', chartHtml, /class="symbol-nav"/],
  ['chart nav buttons', chartHtml, /class="nav-btn"/],
  ['chart nav position', chartHtml, /class="nav-position"/],
  ['group icon button', groupHtml, /class="icon-btn expand-all-btn"/],
  ['group long badge', groupHtml, /class="badge dir-long"/],
  ['group short badge', groupHtml, /class="badge dir-short"/],
] as const) {
  check(name, pattern.test(source));
}
check(
  'chart has exactly two flat pill groups',
  (chartHtml.match(/class="pill-group flat"/g) ?? []).length === 2,
);

const executableGroup = stripComments(groupScss);
for (const [name, pattern] of [
  ['signal-badge', /\.signal-badge\b/],
  ['total-badge', /\.total-badge\b/],
  ['grp-dir', /\.grp-dir\b/],
] as const) {
  check(`group-panel omits dead selector ${name}`, !pattern.test(executableGroup));
}

check('verification guide exists', existsSync(GUIDE), GUIDE);
check('run-all registers migration relay', text(RUN_ALL).includes("file: 'design-system-widget-migration-1115.ts'"));
check('verification index registers migration guide', text(VERIFY_INDEX).includes('design-system-widget-migration-1115.md'));

try {
  const sass: typeof import('sass') = createRequire(join(ROOT, 'package.json'))('sass');
  for (const path of [chartScssPath, groupScssPath]) {
    const css = sass.compile(path, { loadPaths: [PACKAGE_STYLES] }).css;
    check(`${path.split(/[\\/]/).at(-2)} SCSS compiles`, css.length > 100);
  }
} catch (err) {
  check('migrated component SCSS compiles', false, String(err).slice(0, 300));
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
