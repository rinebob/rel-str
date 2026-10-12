/**
 * Position Gallery Group (#926/#951)
 *
 * One expando section of the grouped portfolio gallery: a
 * mat-expansion-panel whose header carries the group label + position
 * count + long/short tallies, and whose body is the position-card grid
 * for that group. Mirrors GalleryGroupComponent, minus the signal-only
 * D/W occurrence counts.
 */
import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';

import { PositionCardGroup } from '../../utils/position-cards.util';
import { PositionCardAction, PositionCardComponent } from '../position-card/position-card.component';

@Component({
  selector: 'app-position-gallery-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatExpansionModule, PositionCardComponent],
  templateUrl: './position-gallery-group.component.html',
  styleUrl: './position-gallery-group.component.scss',
})
export class PositionGalleryGroupComponent {
  readonly group = input.required<PositionCardGroup>();
  /** Expansion state — owned by PortfolioGalleryUiStore so expand-all can
   *  drive it. */
  readonly expanded = input.required<boolean>();
  readonly expandedChange = output<boolean>();

  /** Page-level disable (refresh in flight), forwarded to each card. */
  readonly actionsDisabled = input(false, { transform: booleanAttribute });
  /** Card actions re-emitted for the page to dispatch (#953 wires). */
  readonly cardAction = output<PositionCardAction>();

  readonly longCount = computed(() => this.group().cards.filter((c) => c.side === 'long').length);
  readonly shortCount = computed(() => this.group().cards.filter((c) => c.side === 'short').length);
}
