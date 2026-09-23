/// <reference types="jest" />
/**
 * Tests for the symbol-profiles slice of SymbolListStore
 * (symbol-profiles.feature.ts). Seam: SignalService is mocked; the real
 * store is used so profilesBySymbol reacts to real profile state.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { SymbolListStore } from './symbol-list.store';
import { SymbolListService } from '../services/symbol-list.service';
import { SignalService } from '../services/signal.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import type { StSymbolProfile } from '../services/types';

function profile(symbol: string, over: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '', name: `${symbol} Inc.`, ...over };
}

interface Setup {
  store: InstanceType<typeof SymbolListStore>;
  signalService: { getAllSymbols: jest.Mock };
}

function setupProfiles(profiles: StSymbolProfile[] = [], getAllSymbols?: jest.Mock): Setup {
  const signalService = { getAllSymbols: getAllSymbols ?? jest.fn(() => of(profiles)) };
  const listService = {
    loadAllLists: jest.fn(() => of([])),
    moveToList: jest.fn(() => of(undefined)),
    addToList: jest.fn(() => of(undefined)),
    removeFromList: jest.fn(() => of(undefined)),
  };
  const db = { getTrackedSymbols$: jest.fn(() => of([])) };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: SignalService, useValue: signalService },
      { provide: SymbolListService, useValue: listService },
      { provide: RelStrDbV2Service, useValue: db },
      { provide: MatSnackBar, useValue: { open: jest.fn() } },
      SymbolListStore,
    ],
  });
  return { store: TestBed.inject(SymbolListStore), signalService };
}

describe('SymbolListStore.loadProfiles', () => {
  it('starts empty and not loading', () => {
    const { store } = setupProfiles();
    expect(store.profiles()).toEqual([]);
    expect(store.profilesLoading()).toBe(false);
    expect(store.profilesBySymbol().size).toBe(0);
  });

  it('populates profiles and indexes them by uppercased symbol', async () => {
    const { store } = setupProfiles([profile('tsla'), profile('QQQ')]);
    const result = await store.loadProfiles();
    expect(result.length).toBe(2);
    expect(store.profiles().length).toBe(2);
    expect(store.profilesBySymbol().get('TSLA')?.name).toBe('tsla Inc.');
    expect(store.profilesBySymbol().get('QQQ')?.name).toBe('QQQ Inc.');
  });

  it('is a no-op when already loaded — single fetch', async () => {
    const { store, signalService } = setupProfiles([profile('AAPL')]);
    await store.loadProfiles();
    await store.loadProfiles();
    expect(signalService.getAllSymbols).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent callers behind one in-flight fetch', async () => {
    const { store, signalService } = setupProfiles([profile('AAPL')]);
    const [a, b] = await Promise.all([store.loadProfiles(), store.loadProfiles()]);
    expect(signalService.getAllSymbols).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('resolves [] and does not throw on failure', async () => {
    const { store } = setupProfiles([], jest.fn(() => throwError(() => new Error('boom'))));
    await expect(store.loadProfiles()).resolves.toEqual([]);
    expect(store.profiles()).toEqual([]);
    expect(store.profilesLoaded()).toBe(false);
  });

  it('retries after a failure, then caches the success', async () => {
    const getAllSymbols = jest
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('boom')))
      .mockReturnValueOnce(of([profile('AAPL')]));
    const { store } = setupProfiles([], getAllSymbols);

    await expect(store.loadProfiles()).resolves.toEqual([]);
    await expect(store.loadProfiles()).resolves.toEqual([profile('AAPL')]);
    expect(store.profilesLoaded()).toBe(true);
    await store.loadProfiles();
    expect(getAllSymbols).toHaveBeenCalledTimes(2);
  });
});
