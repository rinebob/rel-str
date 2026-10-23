/**
 * @topic #1024 — Savant Design System | @task #1207
 *
 * ThemeService — the app's single theme authority. Signal-backed
 * 'dark' | 'light' state; `set`/`toggle` write `data-theme` on
 * `documentElement` and persist to `localStorage['savant-theme']`.
 * The synchronous bootstrap in index.html sets the attribute before
 * first paint; this service reconciles it on init and is the only
 * post-bootstrap writer (the /dev/ds explorer's preview stays
 * host-scoped and never touches the app theme). Default is 'dark';
 * corrupt/unknown stored values fall back to 'dark' — no
 * prefers-color-scheme probing.
 */
import { Injectable, signal } from '@angular/core';

export type AppTheme = 'dark' | 'light';

const STORAGE_KEY = 'savant-theme';
const DEFAULT_THEME: AppTheme = 'dark';

/** Stored value → theme; anything unrecognized resolves to the default. */
function resolveStoredTheme(): AppTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<AppTheme>(resolveStoredTheme());

  constructor() {
    this.applyAttribute(this.theme());
  }

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: AppTheme): void {
    this.theme.set(theme);
    this.applyAttribute(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode, quota) — the theme still
      // applies for this session; persistence is best-effort.
    }
  }

  private applyAttribute(theme: AppTheme): void {
    document.documentElement.dataset.theme = theme;
  }
}
