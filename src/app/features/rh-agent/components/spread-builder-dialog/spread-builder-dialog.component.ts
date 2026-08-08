/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Material dialog component for constructing spreads.
 * Config-driven spread type forms with auto-assigned directions and debit/credit badge.
 */
import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';

import { SpreadViewerStore } from '../../stores/spread-viewer.store';
import { OptionType } from '@options/common';
import {
  SpreadType,
  DebitOrCredit,
  type SpreadDefinition,
  type SpreadLeg,
} from '@spread/contracts';

interface SpreadTypeConfig {
  type: SpreadType;
  legCount: number;
  optionTypeConstraint: 'single' | 'both' | 'none';
  expirationConstraint: 'same' | 'none';
  strikeConstraint: 'distinct' | 'same' | 'distinct_ordered' | 'none';
  autoAssignSides: boolean;
}

const SPREAD_CONFIGS: Record<SpreadType, SpreadTypeConfig> = {
  [SpreadType.VERTICAL]: {
    type: SpreadType.VERTICAL,
    legCount: 2,
    optionTypeConstraint: 'single',
    expirationConstraint: 'same',
    strikeConstraint: 'distinct',
    autoAssignSides: true,
  },
  [SpreadType.STRADDLE]: {
    type: SpreadType.STRADDLE,
    legCount: 2,
    optionTypeConstraint: 'both',
    expirationConstraint: 'same',
    strikeConstraint: 'same',
    autoAssignSides: true,
  },
  [SpreadType.STRANGLE]: {
    type: SpreadType.STRANGLE,
    legCount: 2,
    optionTypeConstraint: 'both',
    expirationConstraint: 'same',
    strikeConstraint: 'distinct_ordered',
    autoAssignSides: true,
  },
  [SpreadType.IRON_CONDOR]: {
    type: SpreadType.IRON_CONDOR,
    legCount: 4,
    optionTypeConstraint: 'both',
    expirationConstraint: 'same',
    strikeConstraint: 'distinct_ordered',
    autoAssignSides: true,
  },
  [SpreadType.CUSTOM]: {
    type: SpreadType.CUSTOM,
    legCount: 0,
    optionTypeConstraint: 'none',
    expirationConstraint: 'none',
    strikeConstraint: 'none',
    autoAssignSides: false,
  },
};

@Component({
  selector: 'app-spread-builder-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatChipsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
  ],
  templateUrl: './spread-builder-dialog.component.html',
  styleUrl: './spread-builder-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpreadBuilderDialogComponent {
  readonly store = inject(SpreadViewerStore);
  readonly dialogRef = inject(MatDialogRef<SpreadBuilderDialogComponent>);

  readonly spreadTypes = [
    { value: SpreadType.VERTICAL, label: 'Vertical' },
    { value: SpreadType.STRADDLE, label: 'Straddle' },
    { value: SpreadType.STRANGLE, label: 'Strangle' },
    { value: SpreadType.IRON_CONDOR, label: 'Iron Condor' },
    { value: SpreadType.CUSTOM, label: 'Custom' },
  ];

  selectedType = signal<SpreadType>(SpreadType.VERTICAL);
  selectedOptionType = signal<OptionType>(OptionType.CALL);
  selectedExpiration = signal<string | null>(null);
  selectedStrikes = signal<(number | null)[]>([null, null]);
  startDate = signal<string | null>(null);
  endDate = signal<string | null>(null);

  // Custom mode legs
  customLegs = signal<SpreadLeg[]>([]);

  readonly storeSymbol = computed(() => this.store.symbol() ?? '');
  readonly contractIndex = computed(() => this.store.contractIndex());
  readonly contractIndexStatus = computed(() => this.store.contractIndexStatus());

  /** Available expirations from the contract index. */
  readonly expirations = computed(() => {
    const idx = this.contractIndex();
    if (!idx) return [];
    return idx.expirations.map((e) => e.date).sort();
  });

  /** Strikes available for the selected expiration. */
  readonly availableStrikes = computed(() => {
    const idx = this.contractIndex();
    const exp = this.selectedExpiration();
    if (!idx || !exp) return [];
    const entry = idx.expirations.find((e) => e.date === exp);
    return entry ? [...entry.strikes].sort((a, b) => a - b) : [];
  });

  /** Current spread type config. */
  readonly config = computed(() => SPREAD_CONFIGS[this.selectedType()]);

  /** Whether option type selector should be shown. */
  readonly showOptionTypeSelector = computed(() => {
    const c = this.config();
    return c.optionTypeConstraint === 'single';
  });

  /** Number of strike selectors needed. */
  readonly strikeSelectorCount = computed(() => {
    const c = this.config();
    if (c.strikeConstraint === 'same') return 1;
    return c.legCount;
  });

  /** Strike selector labels. */
  readonly strikeLabels = computed<string[]>(() => {
    const type = this.selectedType();
    switch (type) {
      case SpreadType.VERTICAL: return ['Long Strike', 'Short Strike'];
      case SpreadType.STRADDLE: return ['Strike'];
      case SpreadType.STRANGLE: return ['Put Strike', 'Call Strike'];
      case SpreadType.IRON_CONDOR: return ['Put Long', 'Put Short', 'Call Short', 'Call Long'];
      default: return [];
    }
  });

  /** Computed debit or credit based on leg arrangement. */
  readonly debitOrCredit = computed<DebitOrCredit | null>(() => {
    const legs = this.buildLegs();
    if (legs.length === 0) return null;
    return computeDebitOrCredit(legs);
  });

  /** Whether the current form is valid for adding a spread. */
  readonly canAdd = computed(() => {
    const sym = this.storeSymbol();
    const exp = this.selectedExpiration();
    if (!sym || !exp) return false;

    const type = this.selectedType();
    if (type === SpreadType.CUSTOM) {
      return this.customLegs().length >= 2;
    }

    const strikes = this.selectedStrikes();
    const count = this.strikeSelectorCount();
    for (let i = 0; i < count; i++) {
      if (strikes[i] == null) return false;
    }

    // Validate distinct strikes where required
    const c = this.config();
    if (c.strikeConstraint === 'distinct') {
      const vals = strikes.slice(0, count).filter((s) => s != null);
      const unique = new Set(vals);
      if (unique.size !== vals.length) return false;
    }
    if (c.strikeConstraint === 'distinct_ordered') {
      const vals = strikes.slice(0, count);
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && (vals[i] as number) <= (vals[i - 1] as number)) {
          return false;
        }
      }
    }

    return true;
  });

  /** Running count of added spreads. */
  readonly addedCount = computed(() => this.store.spreads().length);

  /** Build legs from current form state. */
  buildLegs(): SpreadLeg[] {
    const type = this.selectedType();
    const exp = this.selectedExpiration();
    if (!exp) return [];

    if (type === SpreadType.CUSTOM) {
      return this.customLegs();
    }

    const strikes = this.selectedStrikes();
    const optType = this.selectedOptionType();
    const c = this.config();

    if (c.strikeConstraint === 'same') {
      // Straddle: long call + long put at same strike
      const strike = strikes[0];
      if (strike == null) return [];
      return [
        { optionType: OptionType.CALL, strike, expiration: exp, direction: 'long' },
        { optionType: OptionType.PUT, strike, expiration: exp, direction: 'long' },
      ];
    }

    if (type === SpreadType.STRANGLE) {
      const putStrike = strikes[0];
      const callStrike = strikes[1];
      if (putStrike == null || callStrike == null) return [];
      return [
        { optionType: OptionType.PUT, strike: putStrike, expiration: exp, direction: 'long' },
        { optionType: OptionType.CALL, strike: callStrike, expiration: exp, direction: 'long' },
      ];
    }

    if (type === SpreadType.IRON_CONDOR) {
      const [putLong, putShort, callShort, callLong] = strikes;
      if (putLong == null || putShort == null || callShort == null || callLong == null) return [];
      return [
        { optionType: OptionType.PUT, strike: putLong, expiration: exp, direction: 'long' },
        { optionType: OptionType.PUT, strike: putShort, expiration: exp, direction: 'short' },
        { optionType: OptionType.CALL, strike: callShort, expiration: exp, direction: 'short' },
        { optionType: OptionType.CALL, strike: callLong, expiration: exp, direction: 'long' },
      ];
    }

    // Vertical
    const [longStrike, shortStrike] = strikes;
    if (longStrike == null || shortStrike == null) return [];
    return [
      { optionType: optType, strike: longStrike, expiration: exp, direction: 'long' },
      { optionType: optType, strike: shortStrike, expiration: exp, direction: 'short' },
    ];
  }

  onTypeChange(type: SpreadType): void {
    this.selectedType.set(type);
    const count = SPREAD_CONFIGS[type].strikeConstraint === 'same' ? 1 : SPREAD_CONFIGS[type].legCount;
    this.selectedStrikes.set(new Array(count).fill(null));
    if (type === SpreadType.CUSTOM && this.customLegs().length === 0) {
      this.customLegs.set([
        { optionType: OptionType.CALL, strike: 0, expiration: '', direction: 'long' },
        { optionType: OptionType.CALL, strike: 0, expiration: '', direction: 'short' },
      ]);
    }
  }

  onExpirationChange(exp: string): void {
    this.selectedExpiration.set(exp);
    this.selectedStrikes.set(new Array(this.strikeSelectorCount()).fill(null));
  }

  onStrikeChange(index: number, value: number | null): void {
    const strikes = [...this.selectedStrikes()];
    strikes[index] = value;
    this.selectedStrikes.set(strikes);
  }

  onStartDateChange(date: Date | null): void {
    this.startDate.set(date ? date.toISOString().split('T')[0] : null);
  }

  onEndDateChange(date: Date | null): void {
    this.endDate.set(date ? date.toISOString().split('T')[0] : null);
  }

  onAddToList(): void {
    const sym = this.storeSymbol();
    const legs = this.buildLegs();
    if (!sym || legs.length === 0) return;

    const definition: SpreadDefinition = {
      spreadType: this.selectedType(),
      symbol: sym,
      legs,
      startDate: this.startDate() ?? undefined,
      endDate: this.endDate() ?? undefined,
    };

    this.store.addSpread(definition);

    // Reset strikes but keep symbol + expiration
    this.selectedStrikes.set(new Array(this.strikeSelectorCount()).fill(null));
  }

  onLoad(): void {
    const started = this.store.loadSpreads();
    if (started) {
      this.dialogRef.close();
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  // Custom leg management
  addCustomLeg(): void {
    this.customLegs.update((legs) => [
      ...legs,
      { optionType: OptionType.CALL, strike: 0, expiration: this.selectedExpiration() ?? '', direction: 'long' },
    ]);
  }

  removeCustomLeg(index: number): void {
    this.customLegs.update((legs) => legs.filter((_, i) => i !== index));
  }

  updateCustomLeg(index: number, field: keyof SpreadLeg, value: string | number): void {
    this.customLegs.update((legs) =>
      legs.map((leg, i) => (i === index ? { ...leg, [field]: value } : leg)),
    );
  }
}

/** Compute debit or credit from leg arrangement. */
function computeDebitOrCredit(legs: SpreadLeg[]): DebitOrCredit {
  // Simplified: if more longs than shorts (by premium), it's a debit
  // For structured spreads, the logic is:
  // - Vertical: long lower strike call = debit, short lower strike call = credit
  // - Straddle/Strangle: all long = debit
  // - Iron Condor: credit structure
  const longs = legs.filter((l) => l.direction === 'long').length;
  const shorts = legs.filter((l) => l.direction === 'short').length;

  if (longs > 0 && shorts === 0) return DebitOrCredit.DEBIT;
  if (shorts > longs) return DebitOrCredit.CREDIT;

  // For verticals and iron condors, check if it's a net debit or credit
  // by comparing strike distances (simplified heuristic)
  if (legs.length === 4) return DebitOrCredit.CREDIT; // Iron condor is always credit

  // Vertical: compare strikes
  if (legs.length === 2 && legs[0].optionType === legs[1].optionType) {
    const longLeg = legs.find((l) => l.direction === 'long');
    const shortLeg = legs.find((l) => l.direction === 'short');
    if (longLeg && shortLeg) {
      if (longLeg.optionType === OptionType.CALL) {
        return longLeg.strike < shortLeg.strike ? DebitOrCredit.DEBIT : DebitOrCredit.CREDIT;
      } else {
        return longLeg.strike > shortLeg.strike ? DebitOrCredit.DEBIT : DebitOrCredit.CREDIT;
      }
    }
  }

  return DebitOrCredit.DEBIT;
}
