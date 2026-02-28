import { Injectable } from '@angular/core';
import type { HeatmapV3ViewportMatrix } from './heatmap-v3-data.service';

interface CacheEntry {
  matrix: HeatmapV3ViewportMatrix;
  timestamp: number;
}

@Injectable({
  providedIn: 'root',
})
export class HeatmapCacheService {
  private cache = new Map<string, CacheEntry>();
  private readonly MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

  getCacheKey(baseline: string, timeframe: string): string {
    return `${baseline}-${timeframe}`;
  }

  get(baseline: string, timeframe: string): HeatmapV3ViewportMatrix | null {
    const key = this.getCacheKey(baseline, timeframe);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.MAX_AGE_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.matrix;
  }

  set(baseline: string, timeframe: string, matrix: HeatmapV3ViewportMatrix): void {
    const key = this.getCacheKey(baseline, timeframe);
    this.cache.set(key, {
      matrix,
      timestamp: Date.now(),
    });

    // eslint-disable-next-line no-console
    console.log('[HeatmapCacheService] cached', {
      key,
      pairs: matrix.pairs.length,
      dates: matrix.dates.length,
      cacheSize: this.cache.size,
    });
  }

  clear(): void {
    this.cache.clear();
    // eslint-disable-next-line no-console
    console.log('[HeatmapCacheService] cache cleared');
  }

  invalidate(baseline: string, timeframe: string): void {
    const key = this.getCacheKey(baseline, timeframe);
    this.cache.delete(key);
    // eslint-disable-next-line no-console
    console.log('[HeatmapCacheService] invalidated', { key });
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
