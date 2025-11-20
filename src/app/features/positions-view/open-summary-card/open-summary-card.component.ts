import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pv-open-summary-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './open-summary-card.component.html',
  styleUrls: ['./open-summary-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvOpenSummaryCardComponent {
  label = input<string>('');
  value = input<string | number>('');
  subValue = input<string | number | undefined>(undefined);
  /** Numeric sign source for profit/loss coloring; >0 profit, <0 loss. */
  sign = input<number | null>(null);
}
