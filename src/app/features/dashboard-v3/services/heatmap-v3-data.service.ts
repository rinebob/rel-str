import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Timeframe } from '../../shared/types/rs.interfaces';
import { getCurrentShardDocId, getAllShardDocIds } from '../../../core/utils/heatmap-shard.utils';
import { HeatmapCacheService } from './heatmap-cache.service';

export interface HeatmapV3ViewportMatrix {
  pairs: string[];
  dates: string[];
  values: number[][];
}

/**
 * @deprecated Use HeatmapSnapshotV2 instead. Viewport docs are no longer generated.
 */
interface HeatmapSnapshotViewportV1 {
  baseline: string;
  timeframe: string;
  updatedAt: unknown;
  pairs: string[];
  dates: string[];
  rows: Array<{
    pair: string;
    values: number[];
  }>;
  version: 1;
}

interface HeatmapSnapshotV2 {
  baseline: string;
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  updatedAt: unknown;
  dateRange: {
    from: string;
    to: string;
  };
  version: 2;
  shardType: 'historical' | 'current';
  shardId: string;
  pairs: string[];
  dates: string[];
  rows: Array<{
    pair: string;
    values: number[];
  }>;
}

@Injectable({ providedIn: 'root' })
export class HeatmapV3DataService {
  private readonly firestore = inject(Firestore);
  private readonly cacheService = inject(HeatmapCacheService);

  /**
   * Load current shard for a baseline and timeframe.
   * This provides fast first paint with the most recent data.
   */
  async getCurrentShardOnce(baselineId: string, timeframe: Timeframe): Promise<HeatmapV3ViewportMatrix | null> {
    const baseline = String(baselineId || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim().toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY';
    if (!baseline || !tf) {
      return null;
    }

    const startTime = performance.now();
    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] getCurrentShardOnce', { baseline, timeframe: tf });

    const docId = getCurrentShardDocId(baseline, tf);
    const ref = doc(this.firestore, `heatmap-snapshots/${docId}`);
    
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error('[HeatmapV3DataService] getCurrentShardOnce getDoc error', {
        docPath: `heatmap-snapshots/${docId}`,
        error: e,
      });
      return null;
    }
    
    if (!snap.exists()) {
      // eslint-disable-next-line no-console
      console.warn('[HeatmapV3DataService] current shard doc missing', {
        docPath: `heatmap-snapshots/${docId}`,
      });
      return null;
    }

    const data = snap.data() as HeatmapSnapshotV2 | undefined;
    if (!data || !Array.isArray(data.pairs) || !Array.isArray(data.dates) || !Array.isArray(data.rows)) {
      return null;
    }

    const matrix = this.convertShardToMatrix(data);
    const duration = performance.now() - startTime;
    
    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] current shard loaded', {
      docId,
      pairs: matrix.pairs.length,
      dates: matrix.dates.length,
      durationMs: Math.round(duration),
    });

    return matrix;
  }

  /**
   * Clear all cached heatmap data.
   */
  clearCache(): void {
    this.cacheService.clear();
  }

  /**
   * Invalidate cache for a specific baseline/timeframe.
   */
  invalidateCache(baselineId: string, timeframe: Timeframe): void {
    const baseline = String(baselineId || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim().toUpperCase();
    this.cacheService.invalidate(baseline, tf);
  }

  /**
   * Get cache statistics for debugging.
   */
  getCacheStats(): { size: number; keys: string[] } {
    return this.cacheService.getCacheStats();
  }

  /**
   * @deprecated Use getCurrentShardOnce instead. Viewport docs are no longer generated.
   */
  async getViewportSnapshotOnce(baselineId: string, timeframe: Timeframe): Promise<HeatmapV3ViewportMatrix | null> {
    const baseline = String(baselineId || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim().toUpperCase();
    if (!baseline || !tf) {
      return null;
    }

    // eslint-disable-next-line no-console
    console.warn('[HeatmapV3DataService] getViewportSnapshotOnce is deprecated, use getCurrentShardOnce');

    const docId = `${baseline}-${tf}-viewport`;
    const ref = doc(this.firestore, `heatmap-snapshots/${docId}`);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error('[HeatmapV3DataService] getViewportSnapshotOnce getDoc error', {
        docPath: `heatmap-snapshots/${docId}`,
        error: e,
      });
      return null;
    }
    if (!snap.exists()) {
      // eslint-disable-next-line no-console
      console.warn('[HeatmapV3DataService] snapshot doc missing', {
        docPath: `heatmap-snapshots/${docId}`,
      });
      return null;
    }

    const data = snap.data() as HeatmapSnapshotViewportV1 | undefined;
    if (!data || !Array.isArray(data.pairs) || !Array.isArray(data.dates) || !Array.isArray(data.rows)) {
      return null;
    }

    const pairs = [...data.pairs];
    const dates = [...data.dates];

    const rowsByPair = new Map<string, number[]>();
    for (const row of data.rows) {
      const id = String(row?.pair || '').trim();
      if (!id) continue;
      const values = Array.isArray(row.values) ? row.values.slice() : [];
      rowsByPair.set(id, values);
    }

    const values: number[][] = pairs.map(pairId => {
      const row = rowsByPair.get(pairId) ?? [];
      if (row.length === dates.length) {
        return row;
      }
      const padded: number[] = [];
      for (let i = 0; i < dates.length; i++) {
        padded.push(Number.isFinite(row[i] as number) ? (row[i] as number) : 0);
      }
      return padded;
    });

    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] snapshot mapped to viewport matrix', {
      pairs: pairs.length,
      dates: dates.length,
    });

    return {
      pairs,
      dates,
      values,
    };
  }

  /**
   * Load all shards (current + historical) for a baseline and timeframe.
   * Loads all shards in parallel, merges them, and returns the complete timeline.
   */
  async getAllShardsOnce(baselineId: string, timeframe: Timeframe): Promise<HeatmapV3ViewportMatrix | null> {
    const baseline = String(baselineId || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim().toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY';
    if (!baseline || !tf) {
      return null;
    }

    // Check cache first
    const cached = this.cacheService.get(baseline, tf);
    if (cached) {
      // eslint-disable-next-line no-console
      console.log('[HeatmapV3DataService] cache hit (instant)', { 
        baseline, 
        timeframe: tf,
        pairs: cached.pairs.length,
        dates: cached.dates.length,
      });
      return cached;
    }

    const startTime = performance.now();
    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] cache miss, loading all shards', { baseline, timeframe: tf });

    // Get all shard doc IDs
    const shardIds = getAllShardDocIds(baseline, tf);
    const allDocIds = [shardIds.current, ...shardIds.historical];

    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] loading shards in parallel', { 
      total: allDocIds.length,
      current: shardIds.current,
      historicalCount: shardIds.historical.length 
    });

    // Load all shards in parallel
    const shardPromises = allDocIds.map(docId => this.loadShard(docId));
    const shards = (await Promise.all(shardPromises)).filter((s): s is HeatmapSnapshotV2 => s !== null);

    if (shards.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[HeatmapV3DataService] no shards loaded');
      return null;
    }

    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] shards loaded', { 
      loaded: shards.length, 
      total: allDocIds.length 
    });

    // Merge all shards chronologically
    const merged = this.mergeShards(shards);
    const duration = performance.now() - startTime;

    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] all shards merged', {
      baseline,
      timeframe: tf,
      pairs: merged.pairs.length,
      dates: merged.dates.length,
      shardsLoaded: shards.length,
      durationMs: Math.round(duration),
    });

    // Cache the merged result
    this.cacheService.set(baseline, timeframe, merged);

    return merged;
  }

  /**
   * Load a single shard by document ID.
   */
  private async loadShard(docId: string): Promise<HeatmapSnapshotV2 | null> {
    try {
      const ref = doc(this.firestore, `heatmap-snapshots/${docId}`);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        // eslint-disable-next-line no-console
        console.warn('[HeatmapV3DataService] shard missing', { docId });
        return null;
      }
      const data = snap.data() as HeatmapSnapshotV2 | undefined;
      if (!data || !Array.isArray(data.pairs) || !Array.isArray(data.dates) || !Array.isArray(data.rows)) {
        return null;
      }
      return data;
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error('[HeatmapV3DataService] shard load error', { docId, error: e });
      return null;
    }
  }

  /**
   * Merge multiple shards chronologically into a single matrix.
   */
  private mergeShards(shards: HeatmapSnapshotV2[]): HeatmapV3ViewportMatrix {
    // Sort shards by date range (oldest first)
    const sorted = shards.sort((a, b) => a.dateRange.from.localeCompare(b.dateRange.from));

    // Collect all unique pairs
    const allPairs = new Set<string>();
    sorted.forEach(shard => shard.pairs.forEach(p => allPairs.add(p)));
    const pairs = Array.from(allPairs).sort();

    // Merge dates chronologically
    const dates: string[] = [];
    sorted.forEach(shard => dates.push(...shard.dates));

    // Build merged rows - align values for each pair across all shards
    const values: number[][] = pairs.map(pairId => {
      const mergedValues: number[] = [];
      sorted.forEach(shard => {
        const row = shard.rows.find(r => r.pair === pairId);
        if (row) {
          mergedValues.push(...row.values);
        } else {
          // Fill with zeros if pair doesn't exist in this shard
          mergedValues.push(...new Array(shard.dates.length).fill(0));
        }
      });
      return mergedValues;
    });

    return {
      pairs,
      dates,
      values,
    };
  }

  /**
   * Convert a v2 shard to the internal matrix format.
   */
  private convertShardToMatrix(shard: HeatmapSnapshotV2): HeatmapV3ViewportMatrix {
    const pairs = [...shard.pairs];
    const dates = [...shard.dates];

    const rowsByPair = new Map<string, number[]>();
    for (const row of shard.rows) {
      const id = String(row?.pair || '').trim();
      if (!id) continue;
      const values = Array.isArray(row.values) ? row.values.slice() : [];
      rowsByPair.set(id, values);
    }

    const values: number[][] = pairs.map(pairId => {
      const row = rowsByPair.get(pairId) ?? [];
      if (row.length === dates.length) {
        return row;
      }
      const padded: number[] = [];
      for (let i = 0; i < dates.length; i++) {
        padded.push(Number.isFinite(row[i] as number) ? (row[i] as number) : 0);
      }
      return padded;
    });

    return {
      pairs,
      dates,
      values,
    };
  }
}
