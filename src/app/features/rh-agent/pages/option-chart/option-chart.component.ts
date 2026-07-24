/**
 * Option Chart Page
 *
 * Options contract viewer dashboard. Input an OCC contract ID, fetch the
 * historical time-series, and plot it on a dedicated chart with underlying
 * price overlay, Greeks, and volume/OI panes.
 */
import { Component, inject, computed, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatNativeDateModule } from '@angular/material/core';

import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionsContractChartComponent } from '../../components/options-contract-chart/options-contract-chart.component';
import { UiStateService } from '../../../../core/services/ui-state.service';

@Component({
  selector: 'app-option-chart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    OptionsContractChartComponent,
  ],
  templateUrl: './option-chart.component.html',
  styleUrl: './option-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChartComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionsContractViewerStore);
  readonly uiStateService = inject(UiStateService);

  occIdInput = 'QQQ240719C00450000';

  /** Whether the left control panel is open. */
  controlPanelOpen = true;

  // Builder fields (signals so computed/derived state reacts)
  symbol = signal('QQQ');
  expiration = signal<Date | null>(new Date('2024-07-19'));
  type = signal<'call' | 'put'>('call');
  strike = signal(450);
  contractLength = signal<string | null>('1M');

  readonly lengthOptions: { value: string; label: string; group: string }[] = [
    { value: '0DTE', label: '0DTE', group: 'Ultra short' },
    { value: '1D', label: '1 day', group: 'Ultra short' },
    { value: '2D', label: '2 day', group: 'Ultra short' },
    { value: '3D', label: '3 day', group: 'Ultra short' },
    { value: '5D', label: '5 day', group: 'Ultra short' },
    { value: '1W', label: '1 week', group: 'Weekly' },
    { value: '2W', label: '2 week', group: 'Weekly' },
    { value: '3W', label: '3 week', group: 'Weekly' },
    { value: '1M', label: '1 mo', group: 'Monthly' },
    { value: '2M', label: '2 mo', group: 'Monthly' },
    { value: '3M', label: '3 mo', group: 'Monthly' },
    { value: '6M', label: '6 mo', group: 'Monthly' },
    { value: '9M', label: '9 mo', group: 'Monthly' },
    { value: '12M', label: '12 mo / LEAP', group: 'LEAPS' },
    { value: '2Y', label: '2 yr', group: 'LEAPS' },
    { value: '3Y', label: '3 yr', group: 'LEAPS' },
  ];

  /** Build OCC ID from builder fields. */
  readonly builtOccId = computed(() => {
    const sym = (this.symbol() || '').trim().toUpperCase();
    const exp = this.expiration();
    const stk = this.strike();
    if (!sym || !exp || !stk) return '';
    const d = exp;
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const cp = this.type() === 'call' ? 'C' : 'P';
    const strikeStr = String(Math.round(stk * 1000)).padStart(8, '0');
    return `${sym}${yy}${mm}${dd}${cp}${strikeStr}`;
  });

  /** Sync built OCC ID to the input field. */
  onBuildChange(): void {
    const id = this.builtOccId();
    if (id) this.occIdInput = id;
  }

  /** Label for the selected contract length. */
  readonly lengthLabel = computed(() => {
    const length = this.contractLength();
    return this.lengthOptions.find((o) => o.value === length)?.label ?? (length ?? '');
  });

  /** Length options grouped for the dropdown. */
  readonly lengthGroups = computed(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const opt of this.lengthOptions) {
      if (!groups.has(opt.group)) groups.set(opt.group, []);
      groups.get(opt.group)!.push({ value: opt.value, label: opt.label });
    }
    return Array.from(groups.entries()).map(([name, options]) => ({ name, options }));
  });

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  onLoad(): void {
    const id = this.occIdInput.trim().toUpperCase();
    if (!id) return;
    this.store.loadContract(id, this.contractLength());
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.onLoad();
    }
  }
}
