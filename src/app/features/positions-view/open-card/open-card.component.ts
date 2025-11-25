import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { PositionDoc, PositionDirection } from '../../../core/models/fe-position.types';
import { TruncPipe } from '../../decision-board/truncate.pipe';
import { PvPercentBarComponent } from './percent-bar/percent-bar.component';

@Component({
  selector: 'app-pv-open-card',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, TruncPipe, PvPercentBarComponent],
  templateUrl: './open-card.component.html',
  styleUrls: ['./open-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvOpenCardComponent {
  position = input<PositionDoc>();
  mode = input<'open' | 'closed'>('open');
  readonly Direction = PositionDirection;

  readonly percentForBar = computed(() => {
    const pos = this.position();
    const isOpen = this.mode() === 'open';
    if (!pos) return 0;

    const entry = pos.entryPrice ?? 0;

    if (isOpen) {
      const priceChange = (pos.currentPrice ?? 0) - entry;

      const rawPct = typeof pos.currentPctChange === 'number' && Number.isFinite(pos.currentPctChange)
        ? Math.abs(pos.currentPctChange)
        : (entry !== 0 ? Math.abs((priceChange / entry) * 100) : 0);

      const openPnl = pos.currentChange ?? priceChange;
      const sign = openPnl >= 0 ? 1 : -1;
      return sign * rawPct;
    }

    // Closed: use net PnL / percentReturn when available, otherwise exit-entry.
    const exit = pos.exitPrice ?? 0;
    const priceChange = exit - entry;

    const rawPct = typeof pos.percentReturn === 'number' && Number.isFinite(pos.percentReturn)
      ? Math.abs(pos.percentReturn)
      : (entry !== 0 ? Math.abs((priceChange / entry) * 100) : 0);

    const closedPnl = pos.netPnL ?? priceChange;
    const sign = closedPnl >= 0 ? 1 : -1;

    return sign * rawPct;
  });
}
