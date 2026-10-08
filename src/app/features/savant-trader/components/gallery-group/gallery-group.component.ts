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
import { GalleryCardAction, GalleryCardComponent } from '../gallery-card/gallery-card.component';

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

  /** Card decision-button state, forwarded to each card (#755). */
  readonly actionsDisabled = input.required<boolean>();
  /** Card keys with an action in flight — disables that card's buttons
   *  while the stage/send resolves (#755). */
  readonly busyKeys = input<ReadonlySet<string>>(new Set<string>());
  /** Card decision actions re-emitted for the page to dispatch. */
  readonly cardAction = output<GalleryCardAction>();

  /** Cards carrying at least one daily occurrence (D+W cards count in both).
   *  Counts read allOccurrences — the card's true content — so a timeframe
   *  filter doesn't zero out the opposite count while the card's chart can
   *  still draw those dots (#819 r2). */
  readonly dailyCount = computed(() =>
    this.group().cards.filter((c) => c.allOccurrences.some((o) => o.timeframe === SignalTimeframe.DAILY)).length,
  );
  readonly weeklyCount = computed(() =>
    this.group().cards.filter((c) => c.allOccurrences.some((o) => o.timeframe === SignalTimeframe.WEEKLY)).length,
  );
  readonly longCount = computed(() => this.group().cards.filter((c) => c.side === 'buy').length);
  readonly shortCount = computed(() => this.group().cards.filter((c) => c.side === 'sell').length);
}
