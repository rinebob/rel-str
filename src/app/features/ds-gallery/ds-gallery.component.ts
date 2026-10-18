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
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
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
  | 'stat-strip';

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
    blurb: 'Surface/feedback colors alias --mat-sys-* (stay in sync through the Material exit); up/down are literal P&L accents.',
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
    blurb: 'Radius + two shadow stops. Shadows deepen under [data-theme="dark"] — the only tokens that differ today.',
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

@Component({
  selector: 'app-ds-gallery',
  standalone: true,
  imports: [MatIconModule],
  templateUrl: './ds-gallery.component.html',
  styleUrl: './ds-gallery.component.scss',
  host: { '[attr.data-theme]': 'dark() ? "dark" : null' },
  // The dialog demo renders Material's DOM shape (mat-dialog-content,
  // mat-dialog-actions) as bare custom elements — the mixin's selectors
  // style them without needing the MatDialog directives/DialogRef DI.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DsGalleryComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly entries = ENTRIES;
  readonly colorTokens = COLOR_TOKENS;
  readonly spaceTokens = SPACE_TOKENS;

  /** Dark preview — flips [data-theme="dark"] on the gallery root. */
  readonly dark = signal(false);
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
