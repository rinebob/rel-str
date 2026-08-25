/**
 * Scroll Target Service
 *
 * Coordinates Angular-native scroll-into-view behavior across loosely-coupled
 * components. A page sets the target symbol; directives on row elements react
 * and scroll themselves into view.
 */
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ScrollTargetService {
  /** Symbol that should be scrolled into view. */
  readonly target = signal<string | null>(null);

  /** Request that the element representing `symbol` scroll into view. */
  scrollTo(symbol: string): void {
    this.target.set(symbol);
  }

  /** Clear the active scroll request after it has been handled. */
  clear(): void {
    this.target.set(null);
  }
}
