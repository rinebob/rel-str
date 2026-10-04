/**
 * Gallery Card
 *
 * Card shell for the gallery view (#743/#754): signal details only for now —
 * chart cell (#756), actions (#757-#758), and the ticket button (#759) land
 * on this shell in later tasks.
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SignalTimeframe } from '../../common/constants';
import { GalleryCard } from '../../utils/gallery-cards.util';

@Component({
  selector: 'app-gallery-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  templateUrl: './gallery-card.component.html',
  styleUrl: './gallery-card.component.scss',
})
export class GalleryCardComponent {
  card = input.required<GalleryCard>();
  readonly SignalTimeframe = SignalTimeframe;
}
