/**
 * #1112 — widget package/gallery contract relay.
 *
 * Run from the rel-str root:
 *   npx tsx scripts/verify/design-system-widgets-1112.ts
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = resolve(ROOT, '..', 'savant-ds');
const SA = resolve(ROOT, '..', 'av-proxy-api');
const PACKAGE_STYLES = join(DS, 'styles');
const REL_VENDOR = join(ROOT, 'vendor', 'savant-ds', 'styles');
const SA_VENDOR = join(SA, 'vendor', 'savant-ds', 'styles');
const GALLERY = join(ROOT, 'src', 'app', 'features', 'ds-gallery');
const SHIM_DIR = join(ROOT, 'src', 'app', 'features', 'portfolio-dashboard', 'styles');
const INVENTORY = join(
  ROOT,
  'docs',
  'topics',
  '1024-design-system',
  '1024-1025-DS-INVENTORY.md',
);
const GUIDE = join(ROOT, 'scripts', 'verify', 'design-system-widgets-1112.md');
const RUN_ALL = join(ROOT, 'scripts', 'verify', 'run-all.ts');
const VERIFY_INDEX = join(ROOT, 'scripts', 'verify', 'README.md');

const MIXINS = [
  'pill-toggle',
  'pill-btn',
  'badge',
  'icon-btn',
  'toolbar-row',
  'nav-stepper',
  'field-input',
  'toggle-chip',
  'dir-edge',
] as const;

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

function text(path: string): string {
  return readFileSync(path, 'utf8');
}

function sameBytes(left: string, right: string): boolean {
  return readFileSync(left).equals(readFileSync(right));
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*/, ''))
    .join('\n');
}

for (const [label, dir] of [
  ['savant-ds package', PACKAGE_STYLES],
  ['rel-str vendor', REL_VENDOR],
  ['SavantApi vendor', SA_VENDOR],
] as const) {
  check(`${label} styles directory exists`, existsSync(dir), dir);
}

const packageWidgets = join(PACKAGE_STYLES, '_widgets.scss');
const packageIndex = join(PACKAGE_STYLES, '_index.scss');
const copies = [
  ['rel-str', join(REL_VENDOR, '_widgets.scss'), join(REL_VENDOR, '_index.scss')],
  ['SavantApi', join(SA_VENDOR, '_widgets.scss'), join(SA_VENDOR, '_index.scss')],
] as const;

check('package _widgets.scss exists', existsSync(packageWidgets), packageWidgets);
check('package _index.scss exists', existsSync(packageIndex), packageIndex);

if (existsSync(packageWidgets) && existsSync(packageIndex)) {
  for (const [label, widgets, index] of copies) {
    check(`${label} _widgets.scss exists`, existsSync(widgets), widgets);
    check(`${label} _index.scss exists`, existsSync(index), index);
    if (existsSync(widgets)) {
      check(
        `${label} _widgets.scss byte-identical to package`,
        sameBytes(widgets, packageWidgets),
      );
    }
    if (existsSync(index)) {
      check(`${label} _index.scss byte-identical to package`, sameBytes(index, packageIndex));
    }
  }

  const packageIndexSource = stripComments(text(packageIndex));
  check(
    "package index forwards 'widgets' exactly once",
    (packageIndexSource.match(/@forward\s+['"]widgets['"]/g) ?? []).length === 1,
  );

  const executableWidgets = stripComments(text(packageWidgets));
  const foundMixins = [...executableWidgets.matchAll(/@mixin\s+([\w-]+)/g)].map((m) => m[1]);
  check(
    'widget partial exports exactly the nine contracted mixins',
    foundMixins.sort().join(',') === [...MIXINS].sort().join(','),
    foundMixins.join(','),
  );
  for (const mixin of MIXINS) {
    check(`mixin ${mixin} present`, foundMixins.includes(mixin));
  }

  for (const retired of ['verdict', 'acr', 'expando', 'expansion', '--ds-verdict']) {
    check(`retired executable scope absent: ${retired}`, !executableWidgets.toLowerCase().includes(retired));
  }
}

const shim = join(SHIM_DIR, '_pd-visual-language.scss');
check('_pd-visual-language shim exists', existsSync(shim), shim);
if (existsSync(shim)) {
  check("shim forwards 'index'", /@forward\s+['"]index['"]/.test(stripComments(text(shim))));
}

try {
  const sass: typeof import('sass') = createRequire(join(DS, 'package.json'))('sass');
  const fixture = [
    "@use 'pd-visual-language' as vl;",
    ...MIXINS.map((mixin, i) => `.widget-${i} { @include vl.${mixin}; }`),
  ].join('\n');
  const css = sass.compileString(fixture, { loadPaths: [SHIM_DIR, PACKAGE_STYLES] }).css;
  check('all widget mixins resolve through vl.* shim', css.length > 3000, `${css.length} chars`);
} catch (err) {
  check('all widget mixins resolve through vl.* shim', false, String(err).slice(0, 300));
}

const galleryTs = join(GALLERY, 'ds-gallery.component.ts');
const galleryHtml = join(GALLERY, 'ds-gallery.component.html');
const galleryScss = join(GALLERY, 'ds-gallery.component.scss');
for (const path of [galleryTs, galleryHtml, galleryScss]) {
  check(`${path.split(/[\\/]/).at(-1)} exists`, existsSync(path), path);
}
if ([galleryTs, galleryHtml, galleryScss].every(existsSync)) {
  const ts = stripComments(text(galleryTs));
  const html = stripComments(text(galleryHtml));
  const scss = stripComments(text(galleryScss));
  for (const mixin of MIXINS) {
    check(`gallery entry ${mixin}`, new RegExp(`kind:\\s*['"]${mixin}['"]`).test(ts));
    check(`gallery case ${mixin}`, new RegExp(`@case\\s*\\(\\s*['"]${mixin}['"]\\s*\\)`).test(html));
    check(`gallery consumes ds.${mixin}`, new RegExp(`@include\\s+ds\\.${mixin}\\b`).test(scss));
  }
  const widgetKind = new RegExp(`kind:\\s*['"](?:${MIXINS.join('|')})['"]`, 'g');
  check(
    'gallery has exactly the contracted widget entries',
    (ts.match(widgetKind) ?? []).length === MIXINS.length,
  );
}

check('verification guide exists', existsSync(GUIDE), GUIDE);
check(
  'run-all registers widget relay',
  existsSync(RUN_ALL)
    && text(RUN_ALL).includes("file: 'design-system-widgets-1112.ts'")
    && text(RUN_ALL).includes("needsPaths: ['../savant-ds', '../av-proxy-api']"),
);
check(
  'verification index registers task and guide',
  existsSync(VERIFY_INDEX)
    && text(VERIFY_INDEX).includes('#1112 — FE widget contract relay')
    && text(VERIFY_INDEX).includes('design-system-widgets-1112.md'),
);

check('inventory document exists', existsSync(INVENTORY), INVENTORY);
if (existsSync(INVENTORY)) {
  const inventory = text(INVENTORY);
  const extracted = inventory.split('## Extracted elements')[1]?.split('##')[0] ?? '';
  const candidates = inventory.split('## Candidate elements')[1] ?? '';
  for (const mixin of MIXINS) {
    check(`inventory extracted row: ${mixin}`, new RegExp('^\\| `' + mixin + '`', 'm').test(extracted));
    check(
      `inventory no longer has candidate row: ${mixin}`,
      !new RegExp('^\\| `?' + mixin + '`?\\s*\\|', 'mi').test(candidates),
    );
  }
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
