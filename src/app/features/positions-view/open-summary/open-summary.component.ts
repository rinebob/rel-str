import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { PositionsStore } from '../positions.store';
import { TruncPipe } from '../../decision-board/truncate.pipe';
import { PvOpenSummaryCardComponent } from '../open-summary-card/open-summary-card.component';

@Component({
  selector: 'app-pv-open-summary',
  standalone: true,
  imports: [TruncPipe, PvOpenSummaryCardComponent],
  templateUrl: './open-summary.component.html',
  styleUrls: ['./open-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvOpenSummaryComponent {
  readonly store = inject(PositionsStore);
}
