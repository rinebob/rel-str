/**
 * /dev/ds-elements — live element zoo (#1024 / task #1348).
 *
 * One live specimen per element archetype actually in use across the
 * app, grouped by family, each labeled with usage count + the surfaces
 * it came from (from ui-element-sites.json, #1347). This is the
 * de-materify (#1163) testbed: each blueprint phase replaces its
 * family here first, so the zoo always shows old-vs-new side by side.
 *
 * Material specimens render real Material components — that IS the
 * point: the page shows what the app actually ships today.
 *
 * Counts are a POINT-IN-TIME snapshot of ui-element-sites.json — the
 * spec re-reads the JSON and fails if they drift (the scanner counts
 * this page's own specimens too, so counts can only be snapshots).
 */
import { Component, ChangeDetectionStrategy, CUSTOM_ELEMENTS_SCHEMA, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { RhSelectMenuComponent, type RhSelectOption } from '../savant-trader/components/rh-select-menu/rh-select-menu.component';
import { ACCENTS, type AccentId, type AccentFamily, deriveAccentFamily } from '../../shared/utils/ds-accents';

import { FAMILIES } from './ds-elements.families';


@Component({
  selector: 'app-ds-elements',
  standalone: true,
  imports: [
    FormsModule, ReactiveFormsModule, NgTemplateOutlet,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, MatRadioModule, MatSlideToggleModule,
    MatDatepickerModule, MatNativeDateModule, MatAutocompleteModule,
    MatMenuModule, MatTooltipModule, MatSnackBarModule, MatTabsModule,
    MatExpansionModule, MatCardModule, MatToolbarModule, MatListModule,
    MatTableModule, MatPaginatorModule, MatSortModule, MatChipsModule,
    MatProgressSpinnerModule, MatProgressBarModule, MatButtonToggleModule,
    ScrollingModule, RhSelectMenuComponent,
  ],
  templateUrl: './ds-elements.component.html',
  styleUrl: './ds-elements.component.scss',
  host: {
    // Always explicit (never attributeless) — same rule as /dev/ds:
    // the subtree previews BOTH token layers under the picked theme.
    '[attr.data-theme]': 'dark() ? "dark" : "light"',
    // Accent preview — pushes the candidate accent + color-mix-derived
    // family onto the host so every specimen (ds-* AND Material) re-themes
    // live. 'current' = nulls → inherit the app accent untouched.
    '[style.--ds-accent]': 'effAccent().accent',
    '[style.--ds-on-accent]': 'effAccent().onAccent',
    '[style.--ds-accent-container]': 'effAccent().accentContainer',
    '[style.--ds-on-accent-container]': 'effAccent().onAccentContainer',
    '[style.--ds-accent-border]': 'effAccent().accentBorder',
    '[style.--ds-accent-glow]': 'effAccent().accentGlow',
    '[style.--ds-accent-text]': 'effAccent().accentText',
    '[style.--mat-sys-primary]': 'effAccent().accent',
    '[style.--mat-sys-on-primary]': 'effAccent().onAccent',
    '[style.--mat-sys-primary-container]': 'effAccent().accentContainer',
    '[style.--mat-sys-on-primary-container]': 'effAccent().onAccentContainer',
  },
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DsElementsComponent {
  private readonly snackBar = inject(MatSnackBar);

  // ── Theme controls — every new ds element must verify across
  //    palettes before it's called done (#1348 harness). ──────────
  readonly dark = signal(true);
  readonly accents = ACCENTS;
  readonly accent = signal<AccentId>('current');

  toggleDark(): void { this.dark.set(!this.dark()); }
  setAccent(id: AccentId): void { this.accent.set(id); }

  private pickedHex(): string | null {
    return ACCENTS.find((a) => a.id === this.accent())?.hex ?? null;
  }

  // Full derived family via the shared util — same derivation as
  // ds-gallery's app-accent preview; null when 'current' is picked.
  readonly effAccent = computed<Partial<AccentFamily>>(() => {
    const h = this.pickedHex();
    return h ? deriveAccentFamily(h, this.dark()) : {};
  });

  readonly families = FAMILIES;
  readonly totalUsages = FAMILIES.reduce((n, f) => n + f.items.reduce((m, i) => m + i.count, 0), 0);
  readonly cardCount = FAMILIES.reduce((n, f) => n + f.items.length, 0);
  readonly archetypeCount = FAMILIES.reduce(
    (n, f) => n + f.items.reduce((m, i) => m + i.archetypes.length, 0), 0);

  // ── Live specimen state ──────────────────────────────────────
  readonly matToggleSel = signal('ALL');
  readonly pillSel = signal(1);
  readonly intervalSel = signal(1);
  readonly chipSel = signal<ReadonlySet<number>>(new Set([0]));
  readonly fieldValue = signal('RS_');
  readonly checkVal = signal(true);
  readonly slideVal = signal(true);
  readonly radioVal = signal('a');
  readonly selectVal = signal('b');
  readonly nativeSelectVal = signal('x');
  readonly dsSelectVal = signal('x');
  readonly rhSelectVal = signal('MSFT');
  readonly rhOptions: RhSelectOption<string>[] = [
    { value: 'ALL', label: '— All symbols —' },
    { value: 'MSFT', label: 'MSFT' },
    { value: 'NVDA', label: 'NVDA' },
    { value: 'TSLA', label: 'TSLA' },
  ];
  readonly acOptions = ['MSFT', 'NVDA', 'TSLA', 'AAPL', 'AMAT'];
  readonly autocompleteVal = signal('');
  readonly comboVal = signal('');
  // mat-form-field-parts specimen — a real touched+invalid control so
  // <mat-error> is in a genuine error state, not class-faked.
  readonly reqCtrl = (() => {
    const c = new FormControl('', { nonNullable: true, validators: [Validators.required] });
    c.markAsTouched();
    return c;
  })();
  readonly tableRows = [
    { symbol: 'MSFT', side: 'LONG', pnl: 412 },
    { symbol: 'NVDA', side: 'SHORT', pnl: -88 },
    { symbol: 'TSLA', side: 'LONG', pnl: 150 },
  ];
  readonly cols = ['symbol', 'side', 'pnl'];
  readonly virtItems = Array.from({ length: 200 }, (_, i) => `Row ${i + 1}`);

  toggleChip(i: number): void {
    const next = new Set(this.chipSel());
    if (next.has(i)) next.delete(i); else next.add(i);
    this.chipSel.set(next);
  }

  fireSnack(): void {
    this.snackBar.open('Saved 3 signals', 'OK', { duration: 2500 });
  }
}
