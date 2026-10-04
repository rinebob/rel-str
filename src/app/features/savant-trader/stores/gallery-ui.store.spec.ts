/**
 * GalleryUiStore unit tests (#754) — page-local filter/sort state.
 */
import { TestBed } from '@angular/core/testing';
import { GalleryUiStore } from './gallery-ui.store';
import { SignalDirection, SignalTimeframe } from '../common/constants';

describe('GalleryUiStore', () => {
  let store: InstanceType<typeof GalleryUiStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(GalleryUiStore);
  });

  it('defaults to all signals and sector sort', () => {
    expect(store.timeframe()).toBe(SignalTimeframe.ALL);
    expect(store.direction()).toBe(SignalDirection.ALL);
    expect(store.listFilter()).toBe('ALL');
    expect(store.sort()).toBe('sector');
  });

  it('setters update individual filter parts', () => {
    store.setTimeframe(SignalTimeframe.WEEKLY);
    store.setDirection(SignalDirection.SHORT);
    store.setListFilter('MONITOR');
    store.setSort('marketCap');

    expect(store.timeframe()).toBe(SignalTimeframe.WEEKLY);
    expect(store.direction()).toBe(SignalDirection.SHORT);
    expect(store.listFilter()).toBe('MONITOR');
    expect(store.sort()).toBe('marketCap');
  });

  it('resetForPage restores page-entry defaults', () => {
    store.setTimeframe(SignalTimeframe.DAILY);
    store.setListFilter('PRIMARY');
    store.resetForPage();

    expect(store.timeframe()).toBe(SignalTimeframe.ALL);
    expect(store.direction()).toBe(SignalDirection.ALL);
    expect(store.listFilter()).toBe('ALL');
    expect(store.sort()).toBe('sector');
  });
});
