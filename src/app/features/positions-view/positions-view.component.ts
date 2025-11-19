import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DecisionBoardStore } from '../decision-board/decision-board.store';
import { TruncPipe } from '../decision-board/truncate.pipe';

@Component({
  selector: 'app-positions-view',
  standalone: true,
  imports: [CommonModule, TruncPipe],
  templateUrl: './positions-view.component.html',
  styleUrls: ['./positions-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositionsViewComponent implements OnInit {
  readonly store = inject(DecisionBoardStore);

  readonly latestDayVm = computed(() => {
    const days = this.store.daysDesc();
    const latest = days[0];
    if (!latest) {
      return undefined;
    }
    return latest;
  });

  readonly hasAnyPositionsToday = computed(() => {
    const latest = this.latestDayVm();
    if (!latest) {
      return false;
    }
    const items = latest.items;
    return (
      (items.newCloses?.length || 0) +
      (items.holds?.length || 0) +
      (items.newOpens?.length || 0)
    ) > 0;
  });

  ngOnInit(): void {
    // Load only the current day's positions
    this.store.loadLastNDays(1);
  }

  trackByPositionId = (_: number, it: { positionId: string }) => it.positionId;
}
