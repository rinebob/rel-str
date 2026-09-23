/**
 * Option Chain Page
 *
 * Single-session option chain browser. Renders a full chain in
 * strikes x expirations matrix form — the pct-change grid's visual
 * layout — showing mark price, change vs the prior session, delta,
 * and IV per contract, with the full payload on hover.
 *
 * Interim controls (symbol input + Load) are placeholders until the
 * header/filters task (#503) lands. Grid layout variants (BOTH,
 * per-side orientation) are #501; hover popup is #502.
 */
import { Component, ChangeDetectionStrategy, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';

import { OptionChainStore } from './option-chain.store';
import { ChainGridComponent } from './components/chain-grid.component';
import { buildChainGrid, type StrikeOrientation } from './utils/chain.utils';
import { OptionType } from '@options-contract/contracts';
import { UiStateService } from '../../../../core/services/ui-state.service';

/** Which side panes are shown — both is calls left + puts right. */
type SideLayout = 'call' | 'put' | 'both';

@Component({
  selector: 'app-option-chain',
  standalone: true,
  imports: [ChainGridComponent],
  templateUrl: './option-chain.component.html',
  styleUrl: './option-chain.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChainComponent implements OnInit, OnDestroy {
  protected readonly store = inject(OptionChainStore);
  protected readonly OptionType = OptionType;
  private readonly ui = inject(UiStateService);

  /** CALLS / PUTS / BOTH pane layout — pure view state. */
  readonly layout = signal<SideLayout>('both');

  /** Per-side strike ordering — each pane flips independently (the single
   *  visible pane's toggle applies in CALLS/PUTS mode). */
  readonly callOrientation = signal<StrikeOrientation>('desc');
  readonly putOrientation = signal<StrikeOrientation>('desc');

  toggleOrientation(side: 'call' | 'put'): void {
    const s = side === 'call' ? this.callOrientation : this.putOrientation;
    s.update((o) => (o === 'desc' ? 'asc' : 'desc'));
  }

  /** Full-screen page like the other savant-trader tools — the chain grid
   *  wants the whole viewport. Auto-loads the default symbol. */
  ngOnInit(): void {
    this.ui.setFullscreen(true);
    if (this.store.symbol()) this.store.loadChain();
  }

  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
  }

  protected readonly callsModel = computed(() =>
    buildChainGrid(
      this.store.sessionContracts(),
      this.store.priorContracts(),
      OptionType.CALL,
      this.store.sessionClose(),
      this.callOrientation(),
    ),
  );

  protected readonly putsModel = computed(() =>
    buildChainGrid(
      this.store.sessionContracts(),
      this.store.priorContracts(),
      OptionType.PUT,
      this.store.sessionClose(),
      this.putOrientation(),
    ),
  );

  onSymbolInput(event: Event): void {
    this.store.setSymbol((event.target as HTMLInputElement).value);
  }

  onLoad(): void {
    this.store.loadChain();
  }
}
