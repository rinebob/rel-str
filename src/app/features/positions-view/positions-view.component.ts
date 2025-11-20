import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PositionsStore } from './positions.store';
import { TruncPipe } from '../decision-board/truncate.pipe';

@Component({
  selector: 'app-positions-view',
  standalone: true,
  imports: [CommonModule, TruncPipe],
  templateUrl: './positions-view.component.html',
  styleUrls: ['./positions-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositionsViewComponent {
  readonly store = inject(PositionsStore);

  readonly openLimit = signal(10);
  readonly closedLimit = signal(10);

  readonly visibleOpenLongs = computed(() => this.store.openLongs().slice(0, this.openLimit()));
  readonly visibleOpenShorts = computed(() => this.store.openShorts().slice(0, this.openLimit()));
  readonly visibleClosedLongs = computed(() => this.store.closedLongs().slice(0, this.closedLimit()));
  readonly visibleClosedShorts = computed(() => this.store.closedShorts().slice(0, this.closedLimit()));

  showMoreOpen(): void {
    this.openLimit.update((n) => n + 10);
  }

  showMoreClosed(): void {
    this.closedLimit.update((n) => n + 10);
  }

  dow(day?: string | null): string {
    if (!day) return '';
    const d = new Date(day);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
}
