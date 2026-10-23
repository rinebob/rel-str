/**
 * /dev/ds — savant-ds element gallery (#1024 / task #1041).
 *
 * One card per element group: design tokens, then every `ds.*` mixin
 * rendered as a live demo inside the card. Each card carries a
 * "seen in" provenance footnote naming the real surfaces the element
 * was extracted from. Entries are data-driven — later threads add
 * elements by appending to ENTRIES (and a demo body for new kinds).
 *
 * Demos are styled by the package itself — `ds.*` mixins via
 * `@use 'index' as ds` (the vendored includePaths), never copied
 * declarations. The dark toggle sets `data-theme="dark"` on the
 * gallery root — the same attribute the token layer's dark overrides
 * scope to.
 */
import {
  Component,
  ChangeDetectionStrategy,
  computed,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

/** Demo body rendered inside a card — the template @switches on this. */
export type DsDemoKind =
  | 'color-tokens'
  | 'spacing'
  | 'typography'
  | 'density'
  | 'elevation'
  | 'page-shell'
  | 'dialog'
  | 'error-banner'
  | 'direction-badges'
  | 'dense-table'
  | 'state-block'
  | 'stat-strip'
  | 'pill-toggle'
  | 'pill-btn'
  | 'badge'
  | 'icon-btn'
  | 'toolbar-row'
  | 'nav-stepper'
  | 'field-input'
  | 'toggle-chip'
  | 'dir-edge';

export interface DsGalleryEntry {
  kind: DsDemoKind;
  title: string;
  blurb: string;
  /** Provenance — the surfaces this element was extracted from. */
  seenIn: string[];
}

const COLOR_TOKENS = [
  '--ds-surface',
  '--ds-on-surface',
  '--ds-surface-variant',
  '--ds-error',
  '--ds-border-subtle',
  '--ds-up',
  '--ds-down',
] as const;

const SPACE_TOKENS = [
  '--ds-space-1',
  '--ds-space-2',
  '--ds-space-3',
  '--ds-space-4',
  '--ds-space-5',
  '--ds-space-6',
] as const;

const ENTRIES: readonly DsGalleryEntry[] = [
  {
    kind: 'color-tokens',
    title: 'Color tokens',
    blurb: 'Full semantic vocabulary (#1204) — neutral surfaces, accent, direction, feedback families — all self-contained literals; nothing aliases --mat-sys.',
    seenIn: ['_tokens.scss — :root', 'consumed by every ds.* mixin'],
  },
  {
    kind: 'spacing',
    title: 'Spacing tokens',
    blurb: '4px base scale; used for padding, gaps, and section rhythm across the graduated mixins.',
    seenIn: ['_tokens.scss — :root', 'dense-table cell padding', 'dialog-chrome gaps'],
  },
  {
    kind: 'typography',
    title: 'Typography tokens',
    blurb: 'Sizes from the dense-table / dialog conventions; "bold" is 600 — the codebase emphasis weight, not 700.',
    seenIn: ['_tokens.scss — :root', 'dialog titles', 'table headers / totals'],
  },
  {
    kind: 'density',
    title: 'Density tokens',
    blurb: '32px action rows, 40px field containers — the spread-builder / dialog convention.',
    seenIn: ['_tokens.scss — :root', 'dialog action buttons', 'mat-form-field overrides'],
  },
  {
    kind: 'elevation',
    title: 'Elevation tokens',
    blurb: 'Radius + two shadow stops. Under [data-theme="dark"] every color token flips and shadows deepen for the darker surfaces.',
    seenIn: ['_tokens.scss — :root + dark overrides', 'card chrome', 'error-banner radius'],
  },
  {
    kind: 'page-shell',
    title: 'Page shell + header bar',
    blurb: 'page-host/page-shell/content-column give a routed page full height without the header-height overflow; header-bar is the compact action strip.',
    seenIn: ['portfolio-dashboard page shells', 'allocation page'],
  },
  {
    kind: 'dialog',
    title: 'Dialog chrome + status states',
    blurb: 'dialog-chrome standardizes density + title/action treatment; dialog-status renders submitting/success/error states.',
    seenIn: ['close-position dialog', 'stop-loss dialog', 'allocation dialogs (#781)'],
  },
  {
    kind: 'error-banner',
    title: 'Error banner',
    blurb: 'The inline error presentation — error-container surface, icon + text, radius token.',
    seenIn: ['portfolio-dashboard pages', 'signal review'],
  },
  {
    kind: 'direction-badges',
    title: 'Direction badges',
    blurb: 'P&L accents applied directly — $up/$down Sass vars read these same tokens at call sites.',
    seenIn: ['signal-table badges ($up/$down)', 'P&L cells across PD tables'],
  },
  {
    kind: 'dense-table',
    title: 'Dense table',
    blurb: 'Sticky header, hairline rows, hover tint, .num numerics, tfoot totals — the shared table chrome.',
    seenIn: ['8 call sites across 7 PD table stylesheets'],
  },
  {
    kind: 'state-block',
    title: 'State block',
    blurb: 'Centered loading / empty / error presentation with icon + hint.',
    seenIn: ['signal-review .empty-state', 'table empty rows'],
  },
  {
    kind: 'stat-strip',
    title: 'Stat strip',
    blurb: 'Scoreboard label/value pairs separated by pipe hairlines (.sb-item/.sb-label/.sb-value/.sb-sep).',
    seenIn: ['portfolio scoreboard rows'],
  },
];

/** Widget layer (#1108) — one card per `ds.*` widget mixin; markup is the
 *  canonical contract consumers copy (class names are the API). */
const WIDGET_ENTRIES: readonly DsGalleryEntry[] = [
  {
    kind: 'pill-toggle',
    title: 'Pill toggle',
    blurb: 'Segmented option group — .pill options inside the group container; .flat is the borderless toolbar variant. Direction options carry .long/.short for the success/error accents.',
    seenIn: ['signal-filter-pills', 'chart-toolbar interval/range toggles'],
  },
  {
    kind: 'pill-btn',
    title: 'Pill button + count',
    blurb: 'Micro action pill with an optional .pill-count chip; .emph is the display-total look (not a control), .small the 8px cut.',
    seenIn: ['signal-review-header refresh/review pills', 'review-header'],
  },
  {
    kind: 'badge',
    title: 'Badge family',
    blurb: 'Display markers — .dir-long/.dir-short (--ds-* 15% tints), .type, .tf, .count (+.muted). Direction counts ride this too.',
    seenIn: ['signal-table dir badges', 'review-header tf/count', 'signal-review-header dir counts'],
  },
  {
    kind: 'icon-btn',
    title: 'Icon button',
    blurb: '28px square icon control — hover tint, .dim pre-disabled quiet state, :disabled.',
    seenIn: ['chart-toolbar', 'review-header back/history', 'group-panel'],
  },
  {
    kind: 'toolbar-row',
    title: 'Toolbar row (composition)',
    blurb: 'Canonical header strip — gap 8 / padding 4px 8px / 40px min. Composes icon-btns, pill-toggle, nav-stepper, badges around a .toolbar-spacer.',
    seenIn: ['chart-toolbar', 'signal-review-header', 'review-header'],
  },
  {
    kind: 'nav-stepper',
    title: 'Nav stepper',
    blurb: 'Prev/next + position counter — .nav-btn 22px chevrons, tabular-nums .nav-position.',
    seenIn: ['chart-toolbar symbol-nav'],
  },
  {
    kind: 'field-input',
    title: 'Field input',
    blurb: 'Compact labeled input — .icon + bare input + .clear button, 32px. The filter-input pattern generalized; <select> is deferred.',
    seenIn: ['review-header header-filter'],
  },
  {
    kind: 'toggle-chip',
    title: 'Toggle chip',
    blurb: 'Single-select chip — hover outline, .active primary-container ring. Multi-select by toggling each chip.',
    seenIn: ['review-header strategy chips'],
  },
  {
    kind: 'dir-edge',
    title: 'Direction edge',
    blurb: 'Companion marker — .dir-edge-long/.dir-edge-short 3px left accent on any element: table rows, cards, list items. dense-table stays unmodified.',
    seenIn: ['signal-table tr.long/tr.short'],
  },
];

/** Accent presets for #1161 Theme & Palette — one swappable accent over a
 *  neutral grey ramp; derived colors compute live via color-mix, so any
 *  accent (incl. the free color picker) works. Direction accents
 *  --ds-up/--ds-down are NOT candidates — they stay. */
export const ACCENTS = [
  { id: 'cyan', label: 'Cyan', hex: '#22d3ee' },
  { id: 'mint', label: 'Mint', hex: '#00ff9d' },
  { id: 'acid', label: 'Acid', hex: '#7cff00' },
  { id: 'blue', label: 'Blue', hex: '#4f9fff' },
  { id: 'violet', label: 'Violet', hex: '#b18bff' },
  { id: 'magenta', label: 'Magenta', hex: '#ff5fd0' },
  { id: 'amber', label: 'Amber', hex: '#ffc24d' },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'] | 'current' | 'custom';

/** Direction colors — #1161 makes up/long and down/short themed tokens
 *  like the accent. Presets cover classic-to-neon; 'custom' free-picks. */
export const UP_ACCENTS = [
  { id: 'classic', label: 'Classic', hex: '#4caf50' },
  { id: 'neon', label: 'Neon', hex: '#00e676' },
  { id: 'acid', label: 'Acid', hex: '#39ff14' },
  { id: 'teal', label: 'Teal', hex: '#2dd4a7' },
  { id: 'lime', label: 'Lime', hex: '#a3e635' },
] as const;

export const DOWN_ACCENTS = [
  { id: 'classic', label: 'Classic', hex: '#f44336' },
  { id: 'neon', label: 'Neon', hex: '#ff3366' },
  { id: 'scarlet', label: 'Scarlet', hex: '#ff5252' },
  { id: 'coral', label: 'Coral', hex: '#ff7a5e' },
  { id: 'ember', label: 'Ember', hex: '#ff6d00' },
] as const;

interface SavedPalette {
  name: string;
  dark: boolean;
  accent: string | null;
  up: string;
  down: string;
  colors: Record<string, string>;
}

const PALETTE_TOKENS = [
  ...COLOR_TOKENS,
  ...['primary', 'on-primary', 'primary-container', 'on-primary-container',
    'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
    'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
    'surface', 'on-surface', 'surface-variant', 'on-surface-variant',
    'surface-container-low', 'surface-container', 'surface-container-high',
    'surface-container-highest', 'outline', 'outline-variant',
    'success', 'on-success', 'success-container', 'on-success-container',
    'error', 'on-error', 'error-container', 'on-error-container',
    'warning-container', 'on-warning-container'].map((role) => `--mat-sys-${role}`),
];

@Component({
  selector: 'app-ds-gallery',
  standalone: true,
  imports: [MatIconModule, NgTemplateOutlet],
  templateUrl: './ds-gallery.component.html',
  styleUrl: './ds-gallery.component.scss',
  host: {
    '[attr.data-theme]': 'isDark() ? "dark" : null',
    '[attr.data-accent]': 'accent()',
    '[attr.data-coverage]': 'coverage() ? "" : null',
    '[style.--picker-accent]': 'pickerAccent()',
    '[style.--ds-up]': 'upHex()',
    '[style.--ds-down]': 'downHex()',
  },
  // The dialog demo renders Material's DOM shape (mat-dialog-content,
  // mat-dialog-actions) as bare custom elements — the mixin's selectors
  // style them without needing the MatDialog directives/DialogRef DI.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DsGalleryComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly entries = ENTRIES;
  readonly widgetEntries = WIDGET_ENTRIES;
  readonly colorTokens = COLOR_TOKENS;
  readonly spaceTokens = SPACE_TOKENS;

  // ── Widget demo state (active indices only — behavior stays demo-local) ──
  /** Direction pill-toggle selection (0 ALL · 1 LONG · 2 SHORT). */
  readonly pillSel = signal(1);
  /** Flat interval pill-toggle selection (1D · 1W · 1M · 3M). */
  readonly intervalSel = signal(1);
  /** Toggle-chip multi-select set. */
  readonly chipSel = signal<ReadonlySet<number>>(new Set([0]));
  /** Field-input demo value. */
  readonly fieldValue = signal('RS_');

  toggleChip(i: number): void {
    const next = new Set(this.chipSel());
    if (next.has(i)) next.delete(i); else next.add(i);
    this.chipSel.set(next);
  }

  /** Dark preview — flips [data-theme="dark"] on the gallery root. */
  readonly dark = signal(false);

  readonly accents = ACCENTS;
  /** #1161 accent choice — 'current' = the shipped DS accent family
   *  (#1204 tokens; bridges to --mat-sys-primary* in the SCSS); picking
   *  an accent re-derives that family over the neutral ramp. The theme
   *  toggle flips light/dark within either. */
  readonly accent = signal<AccentId>('current');
  readonly customHex = signal('#22d3ee');
  /** #1161 chrome-coverage preview — the accent-everywhere saturation
   *  layer. Picked accents imply it; this checkbox applies it to the
   *  'current'/shipped-DS selection too so accent coverage on chrome
   *  (borders, titles, header rule, labels) can be judged against the
   *  shipped accent without leaving the default. */
  readonly coverage = signal(false);
  readonly savedAccents = signal<string[]>(this.readSaved<string[]>('ds-gallery.swatches', []));
  readonly savedPalettes = signal<SavedPalette[]>(this.readSaved<SavedPalette[]>('ds-gallery.palettes', []));
  readonly paletteName = signal('');
  readonly compareName = signal('');
  readonly inspectedColors = signal<Record<string, string>>({});
  readonly paletteTokens = PALETTE_TOKENS;
  readonly storageError = signal('');
  readonly comparedPalette = computed(() => this.savedPalettes().find((p) => p.name === this.compareName()));

  private readSaved<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as T : fallback;
    } catch {
      return fallback;
    }
  }

  private persist(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      this.storageError.set('');
    } catch {
      this.storageError.set('Browser storage is unavailable. Changes remain in this page session.');
    }
  }

  inspectColors(): Record<string, string> {
    const style = getComputedStyle(this.host.nativeElement);
    const colors = Object.fromEntries(PALETTE_TOKENS.map((token) => [token, style.getPropertyValue(token).trim()]));
    this.inspectedColors.set(colors);
    return colors;
  }

  savePalette(): void {
    const name = this.paletteName().trim();
    if (!name) return;
    const palette: SavedPalette = {
      name, dark: this.dark(), accent: this.pickerAccent(),
      up: this.upHex()!, down: this.downHex()!, colors: this.inspectColors(),
    };
    this.savedPalettes.update((items) => [...items.filter((p) => p.name !== name), palette]);
    this.persist('ds-gallery.palettes', this.savedPalettes());
  }

  applyPalette(palette: SavedPalette): void {
    this.accent.set(palette.accent ? 'custom' : 'current');
    if (palette.accent) this.customHex.set(palette.accent);
    this.upCustom.set(palette.up);
    this.downCustom.set(palette.down);
    this.setUp('custom');
    this.setDown('custom');
    this.dark.set(palette.dark);
    requestAnimationFrame(() => this.inspectColors());
  }

  saveAccent(): void {
    const hex = this.customHex().toLowerCase();
    this.savedAccents.update((colors) => colors.includes(hex) ? colors : [...colors, hex]);
    this.persist('ds-gallery.swatches', this.savedAccents());
  }

  loadAccent(hex: string): void {
    this.customHex.set(hex);
    this.setAccent('custom');
  }
  readonly isDark = computed(() => this.dark());
  readonly pickerAccent = computed(() =>
    this.accent() === 'custom' ? this.customHex()
    : ACCENTS.find((a) => a.id === this.accent())?.hex ?? null);

  setAccent(a: AccentId): void {
    this.accent.set(a);
    if (a !== 'current') this.dark.set(true);
    // Seed the free picker from the active preset so "Custom" opens on
    // the current color and can be nudged from there.
    if (a !== 'current' && a !== 'custom') {
      this.customHex.set(ACCENTS.find((p) => p.id === a)!.hex);
    }
  }

  setCustomHex(e: Event): void {
    this.customHex.set((e.target as HTMLInputElement).value);
    this.setAccent('custom');
  }

  // ── Direction colors (#1161) — up/down are pickable like the accent ──
  readonly upAccents = UP_ACCENTS;
  readonly downAccents = DOWN_ACCENTS;
  readonly upAccent = signal<string>('classic');
  readonly downAccent = signal<string>('classic');
  readonly upCustom = signal('#00e676');
  readonly downCustom = signal('#ff3366');
  readonly upHex = computed(() =>
    this.upAccent() === 'custom' ? this.upCustom()
    : UP_ACCENTS.find((a) => a.id === this.upAccent())?.hex ?? null);
  readonly downHex = computed(() =>
    this.downAccent() === 'custom' ? this.downCustom()
    : DOWN_ACCENTS.find((a) => a.id === this.downAccent())?.hex ?? null);

  setUp(a: string): void {
    this.upAccent.set(a);
    const p = UP_ACCENTS.find((x) => x.id === a);
    if (p) this.upCustom.set(p.hex);
  }

  setDown(a: string): void {
    this.downAccent.set(a);
    const p = DOWN_ACCENTS.find((x) => x.id === a);
    if (p) this.downCustom.set(p.hex);
  }
  /** Live-resolved values for the dark-differing tokens (AC evidence —
   *  getComputedStyle shows what the theme actually emits). */
  readonly resolvedShadow1 = signal('');
  readonly resolvedShadow2 = signal('');

  toggleDark(): void {
    this.dark.set(!this.dark());
    // The host data-theme binding lands on the change-detection pass after
    // this click — read resolved token values on the next frame.
    requestAnimationFrame(() => {
      const cs = getComputedStyle(this.host.nativeElement);
      this.resolvedShadow1.set(cs.getPropertyValue('--ds-shadow-1').trim());
      this.resolvedShadow2.set(cs.getPropertyValue('--ds-shadow-2').trim());
    });
  }
}
