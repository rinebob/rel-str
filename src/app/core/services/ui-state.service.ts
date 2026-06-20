import { Injectable, signal } from '@angular/core';

/**
 * App-wide UI state service.
 * Manages global layout toggles like fullscreen mode.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  /** When true, the app header is hidden for maximum content area */
  readonly fullscreen = signal(false);

  /** When true, the sidebar/signal-list is collapsed */
  readonly sidebarCollapsed = signal(false);

  /** Chart layout mode: single chart or triple (W/M left, D right) */
  readonly chartLayout = signal<'single' | 'triple'>('triple');

  toggleFullscreen(): void {
    this.fullscreen.update(v => !v);
  }

  setFullscreen(value: boolean): void {
    this.fullscreen.set(value);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  toggleChartLayout(): void {
    this.chartLayout.update(v => v === 'single' ? 'triple' : 'single');
  }
}
