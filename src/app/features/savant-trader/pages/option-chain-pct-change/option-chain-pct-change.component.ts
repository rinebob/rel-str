/**
 * Option Chain Pct Change Page
 *
 * Left panel: input form (symbol, start date, target dates, type, filters).
 * Right panel: stacked grids (one per target date), loading/error states.
 *
 * Follows the existing options-strategy-dashboard.component pattern.
 */
import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { UiStateService } from '../../../../core/services/ui-state.service';
import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { PctChangeGridComponent } from './components/pct-change-grid.component';
import { toNum } from './utils/pct-change.utils';
import { OptionType } from '@options-contract/contracts';

@Component({
  selector: 'app-option-chain-pct-change',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    PctChangeGridComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './option-chain-pct-change.component.html',
  styleUrl: './option-chain-pct-change.component.scss',
})
export class OptionChainPctChangeComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionChainPctChangeStore);
  readonly ui = inject(UiStateService);
  protected readonly optionTypeCall = OptionType.CALL;
  protected readonly optionTypePut = OptionType.PUT;
  protected readonly toNum = toNum;

  /** Enter fullscreen on page load. */
  ngOnInit(): void {
    this.ui.setFullscreen(true);
  }

  /** Restore header when leaving the page. */
  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
  }

  /** Add a target date from the date input element. */
  addTargetDate(input: HTMLInputElement): void {
    const value = input.value;
    if (value) {
      this.store.addTargetDate(value);
      input.value = '';
    }
  }

  /** Read a string value from an input event. */
  inputValue(ev: Event): string {
    return (ev.target as HTMLInputElement | null)?.value ?? '';
  }
}
