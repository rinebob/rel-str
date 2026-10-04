/**
 * Gallery View Page
 *
 * The gallery's page shell (#743/#754): header with filters + group dimension, a
 * scrollable stack of expando groups whose bodies are responsive card grids
 * (#783), and empty states.
 * Charts (#756) and actions (#757-#761) attach to the card shell in later
 * tasks; the card grid is intentionally card-type-agnostic per ADR-009.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { GalleryFacade } from '../../stores/gallery.facade';
import { GalleryHeaderComponent } from '../../components/gallery-header/gallery-header.component';
import { GalleryGroupComponent } from '../../components/gallery-group/gallery-group.component';

@Component({
  selector: 'app-gallery-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GalleryHeaderComponent, GalleryGroupComponent],
  templateUrl: './gallery-view.component.html',
  styleUrl: './gallery-view.component.scss',
})
export class GalleryViewComponent implements OnInit {
  readonly facade = inject(GalleryFacade);

  ngOnInit(): void {
    this.facade.enterGallery();
  }
}
