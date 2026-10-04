/**
 * Gallery Group
 *
 * One expando section of the grouped gallery layout (#743/#783): a
 * mat-expansion-panel whose header carries the group label + card count and
 * whose body is the card grid for that group. Mirrors the signal-review
 * GroupPanelComponent shape, but the panel body renders GalleryCards instead
 * of symbol rows.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { SignalTimeframe } from '../../common/constants';
import { GalleryGroup } from '../../utils/gallery-cards.util';
import { GalleryCardComponent } from '../gallery-card/gallery-card.component';

@Component({
  selector: 'app-gallery-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatExpansionModule, GalleryCardComponent],
  templateUrl: './gallery-group.component.html',
  styleUrl: './gallery-group.component.scss',
})
export class GalleryGroupComponent {
  readonly group = input.required<GalleryGroup>();
  /** Expansion state — owned by GalleryUiStore so expand-all can drive it. */
  readonly expanded = input.required<boolean>();
  readonly expandedChange = output<boolean>();

  /** Cards carrying at least one daily occurrence (D+W cards count in both). */
  readonly dailyCount = computed(() =>
    this.group().cards.filter((c) => c.occurrences.some((o) => o.timeframe === SignalTimeframe.DAILY)).length,
  );
  readonly weeklyCount = computed(() =>
    this.group().cards.filter((c) => c.occurrences.some((o) => o.timeframe === SignalTimeframe.WEEKLY)).length,
  );
  readonly longCount = computed(() => this.group().cards.filter((c) => c.side === 'buy').length);
  readonly shortCount = computed(() => this.group().cards.filter((c) => c.side === 'sell').length);
}
