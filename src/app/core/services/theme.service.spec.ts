/**
 * ThemeService spec (#1024/#1207) — the app's theme authority.
 *
 * Seam: the public API (`theme()`, `toggle()`, `set()`) with two
 * observable effects — `localStorage['savant-theme']` and
 * `document.documentElement.dataset.theme`. The index.html bootstrap
 * sets the attribute before paint; the service reconciles it on init
 * and is the only post-bootstrap writer.
 */
import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

describe('ThemeService (#1207)', () => {
  const KEY = 'savant-theme';
  const attr = () => document.documentElement.dataset.theme;

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    TestBed.resetTestingModule();
  });

  afterEach(() => jest.restoreAllMocks());

  it('defaults to dark when storage is empty', () => {
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('dark');
    expect(attr()).toBe('dark');
  });

  it('reads a stored light value', () => {
    localStorage.setItem(KEY, 'light');
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('light');
    expect(attr()).toBe('light');
  });

  it('falls back to dark on a corrupt stored value and does not throw', () => {
    localStorage.setItem(KEY, 'banana');
    let svc: ThemeService | undefined;
    expect(() => (svc = TestBed.inject(ThemeService))).not.toThrow();
    expect(svc!.theme()).toBe('dark');
    expect(attr()).toBe('dark');
  });

  it('falls back to dark when localStorage.getItem throws (private mode)', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    const svc = TestBed.inject(ThemeService);
    expect(spy).toHaveBeenCalled();
    expect(svc.theme()).toBe('dark');
    expect(attr()).toBe('dark');
    spy.mockRestore();
  });

  it('still flips the attribute when localStorage.setItem throws (quota)', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota');
    });
    const svc = TestBed.inject(ThemeService);
    svc.set('light');
    expect(spy).toHaveBeenCalled();
    expect(svc.theme()).toBe('light');
    expect(attr()).toBe('light');
    spy.mockRestore();
  });

  it('toggle flips dark → light, updates the attribute, and persists', () => {
    const svc = TestBed.inject(ThemeService);
    svc.toggle();
    expect(svc.theme()).toBe('light');
    expect(attr()).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('light');
  });

  it('toggle flips light → dark on a second call', () => {
    localStorage.setItem(KEY, 'light');
    const svc = TestBed.inject(ThemeService);
    svc.toggle();
    expect(svc.theme()).toBe('dark');
    expect(attr()).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
  });

  it('set(light) applies attribute + storage without toggling', () => {
    const svc = TestBed.inject(ThemeService);
    svc.set('light');
    svc.set('light');
    expect(svc.theme()).toBe('light');
    expect(attr()).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('light');
  });
});
