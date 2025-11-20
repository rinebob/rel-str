import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PositionsStore } from '../positions.store';
import { PvOpenCardComponent } from '../open-card/open-card.component';

@Component({
  selector: 'app-pv-closed-grid',
  standalone: true,
  imports: [CommonModule, PvOpenCardComponent],
  templateUrl: './closed-grid.component.html',
  styleUrls: ['./closed-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvClosedGridComponent {
  private readonly store = inject(PositionsStore);

  readonly positions = computed(() => this.store.closedList());
}
