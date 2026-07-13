/**
 * Scroll Into View Directive
 *
 * Angular-native replacement for imperative `querySelector` scrolling.
 * The element scrolls itself into view when its bound symbol matches the
 * current `ScrollTargetService.target` value, then clears the target.
 */
import { Directive, ElementRef, inject, input, effect } from '@angular/core';
import { ScrollTargetService } from '../services/scroll-target.service';

@Directive({
  selector: '[appScrollIntoView]',
  standalone: true,
})
export class ScrollIntoViewDirective {
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly scrollTarget = inject(ScrollTargetService);

  /** Symbol this element represents. */
  readonly appScrollIntoView = input.required<string>();

  constructor() {
    effect(() => {
      const target = this.scrollTarget.target();
      const symbol = this.appScrollIntoView();
      if (target && target === symbol) {
        this.el.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        this.scrollTarget.clear();
      }
    });
  }
}
