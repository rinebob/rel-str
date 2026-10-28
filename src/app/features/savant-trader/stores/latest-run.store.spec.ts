/// <reference types="jest" />
/**
 * LatestRunStore specs (#1232/#1258) — the read side of the latest-run
 * cache. ScannerService.listLatestRuns is the injected seam; the catalog
 * join and option labels are the store's own derivations.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { LatestRunStore } from './latest-run.store';
import { ScannerService } from '../services/scanner.service';
import { SCANNER_RECIPES } from '../scanner/scanner-recipes';
import { scanRun } from '../testing/scan-fixtures';

describe('LatestRunStore (#1258)', () => {
  let store: InstanceType<typeof LatestRunStore>;
  let service: { listLatestRuns: jest.Mock };

  beforeEach(() => {
    service = { listLatestRuns: jest.fn(() => Promise.resolve([])) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        LatestRunStore,
        { provide: ScannerService, useValue: service },
      ],
    });
    store = TestBed.inject(LatestRunStore);
  });

  it('loadLatestRuns() maps the cached runs by recipeId', async () => {
    service.listLatestRuns.mockResolvedValue([
      scanRun('quality-large', ['XYZ', 'ABC']),
      scanRun('gainers', ['UP']),
    ]);
    await store.loadLatestRuns();
    expect(store.latestRuns().size).toBe(2);
    expect(store.latestRuns().get('quality-large')?.rows.map((r) => r.ticker))
      .toEqual(['XYZ', 'ABC']);
  });

  it('loadLatestRuns() keeps the prior map and logs when the read fails', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      service.listLatestRuns.mockResolvedValueOnce([scanRun('gainers', ['UP'])]);
      await store.loadLatestRuns();
      service.listLatestRuns.mockRejectedValueOnce(new Error('denied'));
      await store.loadLatestRuns();
      // Stale cache beats no cache — the dropdown still offers the last run.
      expect(store.latestRuns().get('gainers')?.rows[0].ticker).toBe('UP');
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it('scanOptions yields one option per catalog recipe with a cache doc', async () => {
    service.listLatestRuns.mockResolvedValue([
      scanRun(SCANNER_RECIPES[0].id, ['A']),
      scanRun(SCANNER_RECIPES[1].id, ['B']),
      scanRun('retired-recipe', ['C']), // cache doc for a non-catalog id
    ]);
    await store.loadLatestRuns();
    const options = store.scanOptions();
    // Only the two catalog recipes — the retired doc stays in the map
    // but the dropdown never offers a source that can't resolve a title.
    expect(options.map((o) => o.value)).toEqual([
      `scan:${SCANNER_RECIPES[0].id}`,
      `scan:${SCANNER_RECIPES[1].id}`,
    ]);
    expect(options[0].label).toContain(SCANNER_RECIPES[0].title);
  });

  it('scan option labels carry ranAt staleness ({title} · {ranAt})', async () => {
    service.listLatestRuns.mockResolvedValue([
      scanRun(SCANNER_RECIPES[0].id, ['A'], { ranAt: '2026-10-27T17:30:00.000Z' }),
    ]);
    await store.loadLatestRuns();
    const label = store.scanOptions()[0].label;
    expect(label).toContain('·');
    // The formatted ranAt — not the raw ISO string — is the staleness cue.
    expect(label).not.toContain('2026-10-27T17:30');
    expect(label).toMatch(/Oct/);
  });

  it('a shape-valid doc with an unparseable ranAt is skipped, not fatal', async () => {
    service.listLatestRuns.mockResolvedValue([
      { ...scanRun(SCANNER_RECIPES[0].id, ['A']), ranAt: 'not-a-date' },
      scanRun(SCANNER_RECIPES[1].id, ['B']),
    ]);
    await store.loadLatestRuns();
    // It stays in the map, but an option it can't label never renders.
    expect(store.latestRuns().has(SCANNER_RECIPES[0].id)).toBe(true);
    expect(store.scanOptions().map((o) => o.value)).toEqual([
      `scan:${SCANNER_RECIPES[1].id}`,
    ]);
  });

  it('a truncated run shows the {rows}/{totalItems} cap in its label', async () => {
    service.listLatestRuns.mockResolvedValue([
      scanRun(SCANNER_RECIPES[0].id, ['A', 'B'], { totalItems: 5, truncated: true }),
    ]);
    await store.loadLatestRuns();
    expect(store.scanOptions()[0].label).toContain('2/5');
    // An untruncated run carries no cap marker.
    service.listLatestRuns.mockResolvedValue([scanRun(SCANNER_RECIPES[0].id, ['A', 'B'])]);
    await store.loadLatestRuns();
    expect(store.scanOptions()[0].label).not.toContain('2/');
  });

  it('cold cache — no docs — yields no options without a crash', async () => {
    service.listLatestRuns.mockResolvedValue([]);
    await store.loadLatestRuns();
    expect(store.scanOptions()).toEqual([]);
    expect(store.rowsFor(SCANNER_RECIPES[0].id)).toEqual([]);
  });

  it('rowsFor returns the cached rows for a recipe, [] for unknown ids', async () => {
    service.listLatestRuns.mockResolvedValue([
      scanRun('quality-large', ['XYZ', 'ABC']),
    ]);
    await store.loadLatestRuns();
    expect(store.rowsFor('quality-large').map((r) => r.ticker)).toEqual(['XYZ', 'ABC']);
    expect(store.rowsFor('nope')).toEqual([]);
  });
});
