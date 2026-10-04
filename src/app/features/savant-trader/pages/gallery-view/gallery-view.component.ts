/**
 * Gallery View Page
 *
 * The gallery's page shell (#743/#754): header with filters/sort, a
 * responsive grid of card shells carrying signal details, and empty states.
 * Charts (#756) and actions (#757-#761) attach to the card shell in later
 * tasks; the card grid is intentionally card-type-agnostic per ADR-009.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { GalleryFacade } from '../../stores/gallery.facade';
import { GalleryHeaderComponent } from '../../components/gallery-header/gallery-header.component';
import { GalleryCardComponent } from '../../components/gallery-card/gallery-card.component';

@Component({
  selector: 'app-gallery-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GalleryHeaderComponent, GalleryCardComponent],
  templateUrl: './gallery-view.component.html',
  styleUrl: './gallery-view.component.scss',
})
export class GalleryViewComponent implements OnInit {
  readonly facade = inject(GalleryFacade);

  ngOnInit(): void {
    this.facade.enterGallery();
  }
}
