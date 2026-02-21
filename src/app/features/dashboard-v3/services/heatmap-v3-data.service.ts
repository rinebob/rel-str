import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Timeframe } from '../../shared/types/rs.interfaces';

export interface HeatmapV3ViewportMatrix {
  pairs: string[];
  dates: string[];
  values: number[][];
}

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

@Injectable({ providedIn: 'root' })
export class HeatmapV3DataService {
  private readonly firestore = inject(Firestore);

  async getViewportSnapshotOnce(baselineId: string, timeframe: Timeframe): Promise<HeatmapV3ViewportMatrix | null> {
    const baseline = String(baselineId || '').trim().toUpperCase();
    const tf = String(timeframe || '').trim().toUpperCase();
    if (!baseline || !tf) {
      return null;
    }

    // DEBUG: log incoming request
    // eslint-disable-next-line no-console
    console.log('[HeatmapV3DataService] getViewportSnapshotOnce', { baseline, timeframe: tf });

    const docId = `${baseline}-${tf}-viewport`;
    const ref = doc(this.firestore, `heatmap-snapshots/${docId}`);
    let snap;
    try {
      snap = await getDoc(ref);
      console.log('hV3DSvc gVSO snapshot: ', snap)
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
}
