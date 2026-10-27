/**
 * Verification: /dev/ds explorer + palette lock (task #1211, FE blueprint).
 *
 * Proves the ds-gallery explorer binds the SHIPPED --ds-* token names,
 * stays host-scoped (no app-state leak), persists save/compare and the
 * palette lock, and carries the green-family accent↔up adjacency check:
 *
 *  1. ds-gallery.component.scss compiles through the real vendored
 *     includePaths (dart-sass `compile`).
 *  2. The host binds data-theme explicitly for BOTH modes
 *     ("dark"|"light") — an attributeless host would inherit whatever
 *     the app root carries, leaking app state into the light preview.
 *  3. Accent previews bind --ds-accent (shipped name) to --picker-accent
 *     in both modes — not just the --mat-sys bridge.
 *  4. Light-preview --ds-* restate parity: every --ds-* literal in the
 *     shipped :root light set that differs under [data-theme='dark']
 *     (vendor/savant-ds/styles/_tokens.scss) is restated verbatim under
 *     :host[data-theme=light] — pinned against the vendored file so the
 *     two can't drift silently.
 *  5. Dark-preview --mat-sys parity: the :host[data-theme='dark'] block
 *     carries every --mat-sys-* literal the app :root dark bridge emits
 *     (src/styles.scss) — needed when the app is light; identical (and
 *     harmless) when it's dark.
 *  6. Palette lock: lockPalette/clearPaletteLock + the
 *     'ds-gallery.palette-lock' localStorage key.
 *  7. Adjacency: hue helpers + upAdjacency computed + the warning
 *     rendered in the up-picker and on the direction-badge demo.
 *  8. No app-state leak: the app-accent preview's <html> writes are the
 *     one deliberate exception — color custom properties only, never
 *     data-theme/ThemeService, self-clearing on destroy; the SCSS emits
 *     no :root/[data-theme] selectors outside :host.
 *  9. Explorer persistence intact: swatches + palettes localStorage
 *     keys, inspectColors, compareName.
 * 10. SHIPPED_ACCENT parity: the component's 'current' fallback copies
 *     the vendored --ds-accent literals — pinned so a post-bake token
 *     edit can't leave the lock/adjacency resolution stale.
 *
 * Usage: npx tsx scripts/verify/design-system-palette-lock-1211.ts
 *
 * No credentials. Pass: every check prints OK; exit 0.
 * Fail: FAIL lines + exit 1.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  checks++;
  if (!ok) failures++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GALLERY_DIR = path.join(ROOT, 'src', 'app', 'features', 'ds-gallery');
const GALLERY_SCSS = path.join(GALLERY_DIR, 'ds-gallery.component.scss');
const GALLERY_TS = readFileSync(path.join(GALLERY_DIR, 'ds-gallery.component.ts'), 'utf8');
const GALLERY_HTML = readFileSync(path.join(GALLERY_DIR, 'ds-gallery.component.html'), 'utf8');
const STYLES_SCSS = path.join(ROOT, 'src', 'styles.scss');
const TOKENS_SCSS = path.join(ROOT, 'vendor', 'savant-ds', 'styles', '_tokens.scss');
const DS_STYLES = path.join(ROOT, 'node_modules', 'savant-ds', 'styles');

// ── 1. Compile the gallery stylesheet ────────────────────────────────────

if (!existsSync(DS_STYLES)) {
  // file:vendor dep — missing means npm install hasn't run; nothing
  // meaningful can compile. Report, don't hard-fail the run-all sweep.
  console.log('SKIP — node_modules/savant-ds missing (run npm install)');
  process.exit(0);
}

const require2 = createRequire(path.join(ROOT, 'package.json'));
let cssRaw = '';
try {
  const sass = require2('sass') as {
    compile(file: string, opts: { loadPaths: string[] }): { css: string };
  };
  ({ css: cssRaw } = sass.compile(GALLERY_SCSS, { loadPaths: [DS_STYLES] }));
  check('gallery scss compiles through vendored includePaths', cssRaw.length > 0);
} catch (err) {
  check('gallery scss compiles through vendored includePaths', false, String(err).slice(0, 200));
  console.log(`\n${failures} FAIL`);
  process.exit(1);
}

// Strip comments — a comment can fake a declaration.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

/** Pull `--name: value` declarations from a CSS block body. */
function decls(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/** Selector → declaration-block map; dart-sass strips attr-selector quotes. */
function blocksFor(selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push(m[1]);
  return out;
}

// ── 2. Host data-theme is explicit in both modes ─────────────────────────

check('host data-theme binding is explicit dark|light (never attributeless)',
  /isDark\(\) \? "dark" : "light"/.test(GALLERY_TS));

// ── 3. Accent previews bind the shipped --ds-accent name ─────────────────

const darkAccentBlock = blocksFor(":host[data-theme=dark]:not([data-accent=current])").join('\n');
const lightAccentBlock = blocksFor(":host[data-theme=light]:not([data-accent=current])").join('\n');
check('dark accent block binds --ds-accent to --picker-accent',
  /--ds-accent\s*:\s*var\(--picker-accent\)/.test(darkAccentBlock));
check('dark accent block derives the full --ds-accent family',
  decls(darkAccentBlock).has('--ds-on-accent')
    && decls(darkAccentBlock).has('--ds-accent-container')
    && decls(darkAccentBlock).has('--ds-on-accent-container')
    && decls(darkAccentBlock).has('--ds-accent-border')
    && decls(darkAccentBlock).has('--ds-accent-glow'));
check('light accent block derives the full --ds-accent family',
  decls(lightAccentBlock).has('--ds-accent')
    && decls(lightAccentBlock).has('--ds-on-accent')
    && decls(lightAccentBlock).has('--ds-accent-container')
    && decls(lightAccentBlock).has('--ds-on-accent-container')
    && decls(lightAccentBlock).has('--ds-accent-border')
    && decls(lightAccentBlock).has('--ds-accent-glow'));
check('up/down pickers bind --ds-up/--ds-down on the host',
  /\[style\.--ds-up\]/.test(GALLERY_TS) && /\[style\.--ds-down\]/.test(GALLERY_TS));

// ── 4. Light-preview --ds-* restate parity with the shipped light set ────

const tokensSrc = readFileSync(TOKENS_SCSS, 'utf8').replace(/\/\/[^\n]*/g, '');
const tokensRoot = decls(tokensSrc.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '');
const tokensDark = decls(tokensSrc.match(/\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? '');
check('vendored _tokens.scss parsed (light :root + dark override)', tokensRoot.size > 0 && tokensDark.size > 0);

// The restate must cover every --ds-* key the dark set re-declares —
// those are exactly the tokens that would leak dark values into a light
// preview under a dark app.
const galleryLight = blocksFor(":host[data-theme=light]").join('\n');
const galleryLightDecls = decls(galleryLight);
const restateMisses = [...tokensDark.keys()].filter(
  (k) => galleryLightDecls.get(k) !== tokensRoot.get(k));
check('light preview restates every dark-differing --ds-* literal verbatim',
  restateMisses.length === 0,
  restateMisses.slice(0, 4).map((k) => `${k}: want ${tokensRoot.get(k)}, got ${galleryLightDecls.get(k)}`).join(', '));

// 'current' resolves to SHIPPED_ACCENT in the component — a copy of the
// shipped --ds-accent literals that would silently go stale after the
// locked palette is baked into _tokens.scss.
const shipped = GALLERY_TS.match(
  /SHIPPED_ACCENT\s*=\s*\{\s*light:\s*'(#[0-9a-fA-F]+)',\s*dark:\s*'(#[0-9a-fA-F]+)'/);
check('SHIPPED_ACCENT matches the vendored --ds-accent literals',
  !!shipped
    && shipped[1].toLowerCase() === tokensRoot.get('--ds-accent')?.toLowerCase()
    && shipped[2].toLowerCase() === tokensDark.get('--ds-accent')?.toLowerCase(),
  shipped
    ? `light want ${tokensRoot.get('--ds-accent')} got ${shipped[1]}; dark want ${tokensDark.get('--ds-accent')} got ${shipped[2]}`
    : 'SHIPPED_ACCENT const not found');

// ── 5. Dark-preview --mat-sys parity with the app :root bridge ───────────

const stylesSrc = readFileSync(STYLES_SCSS, 'utf8').replace(/\/\/[^\n]*/g, '');
const appDark = decls(stylesSrc.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '');
const galleryDark = blocksFor(":host[data-theme=dark]").join('\n');
const galleryDarkDecls = decls(galleryDark);
const darkMisses = [...appDark.entries()].filter(
  ([k, v]) => k.startsWith('--mat-sys') && galleryDarkDecls.get(k) !== v);
const appDarkMatSysCount = [...appDark.keys()].filter((k) => k.startsWith('--mat-sys')).length;
check(`dark preview mirrors the app :root --mat-sys bridge (all ${appDarkMatSysCount} keys)`,
  darkMisses.length === 0,
  darkMisses.slice(0, 4).map(([k, v]) => `${k}: want ${v}, got ${galleryDarkDecls.get(k)}`).join(', '));

// ── 6. Palette lock ──────────────────────────────────────────────────────

check('lockPalette records accent+up+down+mode to ds-gallery.palette-lock',
  /lockPalette\(\)/.test(GALLERY_TS)
    && GALLERY_TS.includes("'ds-gallery.palette-lock'")
    && /lockedPalette/.test(GALLERY_TS));
check('lock UI renders current lock (accent/up/down hexes + clear)',
  /lockPalette\(\)/.test(GALLERY_HTML)
    && /lockedPalette\(\)/.test(GALLERY_HTML)
    && /clearPaletteLock\(\)/.test(GALLERY_HTML));

// ── 7. Green-family accent↔up adjacency check ────────────────────────────

check('hue helpers + upAdjacency computed exist',
  /hueOf\(/.test(GALLERY_TS)
    && /hueDistance\(/.test(GALLERY_TS)
    && /upAdjacency/.test(GALLERY_TS)
    && /UP_ADJACENCY_DEG/.test(GALLERY_TS));
check('adjacency warning rendered on the up-picker and direction-badge demo',
  /adjacency-warn/.test(GALLERY_HTML) && /upAdjacency\(\)\.warn/.test(GALLERY_HTML));

// ── 8. No app-state leak ─────────────────────────────────────────────────
// The app-accent preview is the one deliberate exception — it writes color
// custom properties on <html> but must never write the theme attribute,
// never touch ThemeService, and must self-clear on destroy.

check('component never writes data-theme or app-level theme state',
  !/document\.documentElement\.setAttribute/.test(GALLERY_TS)
    && !/dataset\.theme\s*=(?!=)/.test(GALLERY_TS)
    && !/ThemeService/.test(GALLERY_TS)
    && !/document\.body/.test(GALLERY_TS));
check('app-accent preview is self-cleaning (clear on toggle-off + destroy)',
  /appAccentPreview/.test(GALLERY_TS)
    && /clearAppAccent/.test(GALLERY_TS)
    && /ngOnDestroy[\s\S]*clearAppAccent/.test(GALLERY_TS));
check('gallery scss emits no :root or [data-theme] selectors without :host',
  !/^(?!.*:host).*(?::root|\[data-theme)/m.test(cssRaw));

// ── 9. Explorer persistence intact ───────────────────────────────────────

check('swatch + palette localStorage keys intact',
  GALLERY_TS.includes("'ds-gallery.swatches'") && GALLERY_TS.includes("'ds-gallery.palettes'"));
check('token inspector + compare survive',
  /inspectColors\(\)/.test(GALLERY_TS) && /compareName/.test(GALLERY_TS));

console.log('');
if (failures === 0) {
  console.log(`=== ALL ${checks} CHECKS PASSED ===`);
} else {
  console.log(`=== ${failures}/${checks} CHECKS FAILED ===`);
  process.exit(1);
}
