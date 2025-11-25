import { Injectable, EnvironmentInjector, runInInjectionContext, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BucketDocId, CallableName, Collection, Subcollection } from '../../core/common/constants';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { PositionDoc, PositionDirection } from '../../core/models/fe-position.types';

export interface DecisionBoardItem {
  positionId: string;
  /** Canonical pair id, e.g., SPY-AAPL. Empty string if mirror omitted it. */
  pair: string;
  /** Backend signal id for this daily signal, when present. */
  signalId?: string;
  /** Optional direction; populated when available on the backend payload. */
  direction?: PositionDirection;
  /** Optional daily signal type (open/close/hold) as emitted by backend. */
  type?: string;
  // Optional fields (typically present on newCloses when enriched from positions)
  change?: number;
  pctChange?: number;
}

export interface DecisionBoardDay {
  day: string; // YYYY-MM-DD (UTC)
  items: {
    newOpens: DecisionBoardItem[];
    holds: DecisionBoardItem[];
    newCloses: DecisionBoardItem[];
  };
}

export interface DailySignalDto {
  signalId: string;
  positionId: string;
  pair?: string;
  type: string;
  direction?: PositionDirection;
}

export interface SignalsDailyDocDto {
  date: string;
  newOpens: DailySignalDto[];
  holds: DailySignalDto[];
  newCloses: DailySignalDto[];
}

export interface GetDailySignalsRequest {
  day?: string;
  fromDay?: string;
  toDay?: string;
  limitDays?: number;
  all?: boolean;
}

export interface GetDailySignalsResponse {
  days: SignalsDailyDocDto[];
}

export interface LatestRsDoc {
  latest?: any; // structure can vary; we try common fields
}

// UI consumes positions/{id} docs directly, typed as PositionDoc (mirrors backend positions schema).

@Injectable({ providedIn: 'root' })
export class DecisionBoardService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);
  private readonly envInjector = inject(EnvironmentInjector);

  private yearClosedOf(day: string | undefined | null): string | undefined {
    const d = String(day || '').trim();
    if (!/\d{4}-\d{2}-\d{2}/.test(d)) return undefined;
    const y = d.slice(0, 4);
    return `${y}-closed`;
  }

  private withTimeout<T>(p: Promise<T>, ms = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error('[DecisionBoard] getDailySignals timeout', { ms });
        reject(new Error(`getDailySignals timeout after ${ms}ms`));
      }, ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  async getDailySignals(params: GetDailySignalsRequest): Promise<DecisionBoardDay[]> {
    try {
      const call = httpsCallable<GetDailySignalsRequest, GetDailySignalsResponse>(this.functions, CallableName.GET_DAILY_SIGNALS);
      const res = await this.withTimeout(call(params ?? {}));
      const payload = res?.data as GetDailySignalsResponse | undefined;
      const days = Array.isArray(payload?.days) ? payload!.days : [];

      const mapSignal = (s: DailySignalDto): DecisionBoardItem => ({
        positionId: String(s.positionId || ''),
        pair: s.pair ? String(s.pair) : '',
        signalId: s.signalId ? String(s.signalId) : undefined,
        direction: s.direction,
        type: s.type,
      });

      const result: DecisionBoardDay[] = days.map((d) => ({
        day: d.date,
        items: {
          newOpens: Array.isArray(d.newOpens) ? d.newOpens.map(mapSignal) : [],
          holds: Array.isArray(d.holds) ? d.holds.map(mapSignal) : [],
          newCloses: Array.isArray(d.newCloses) ? d.newCloses.map(mapSignal) : [],
        },
      }));

      return result;
    } catch (e: any) {
      const msg = e?.message || 'getDailySignals failed';
      // eslint-disable-next-line no-console
      console.error('[DecisionBoard] getDailySignals error', { message: msg });
      return [];
    }
  }

  async fetchPositions(positionIds: string[], latestDay?: string): Promise<Record<string, PositionDoc>> {
    try {
      const proj = (this.firestore as any)?.app?.options?.projectId;
      // eslint-disable-next-line no-console
      console.log('[DecisionBoard] Firestore project', { projectId: proj, emulators: (window as any)?.__EMULATORS__ });
    } catch {}

    return await runInInjectionContext(this.envInjector, async () => {
      const ids = Array.from(new Set(positionIds.filter(Boolean)));
      const out: Record<string, PositionDoc> = {};
      if (ids.length === 0) return out;
      try {
        const tasks = ids.map(async (id) => {
          try {
            // Prefer OPEN shard; falls back to year-closed shard derived from latestDay when not found.
            const openRef = doc(this.firestore, `${Collection.POSITIONS}/${BucketDocId.OPEN}/${Subcollection.ITEMS}/${id}`);
            let snap = await getDoc(openRef);
            if (!snap.exists()) {
              const yrClosed = this.yearClosedOf(latestDay);
              if (yrClosed) {
                const closedRef = doc(this.firestore, `${Collection.POSITIONS}/${yrClosed}/${Subcollection.ITEMS}/${id}`);
                snap = await getDoc(closedRef);
              }
            }
            if (snap.exists()) {
              out[id] = { positionId: id, ...(snap.data() as any) } as PositionDoc;
            } else {
              // eslint-disable-next-line no-console
              console.warn('[DecisionBoard] positions doc not found in open/closed shards', { id, latestDay });
            }
          } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[DecisionBoard] positions read error', { id, message: e?.message, code: e?.code });
          }
        });
        await Promise.all(tasks);


        // Debug
        // eslint-disable-next-line no-console
        console.log('[DecisionBoard] fetchPositions', { requested: ids.length, found: Object.keys(out).length, idsRequested: ids, idsFound: Object.keys(out) });
      } catch {}
      return out;
    });
  }

  // Fetch latest RS per pair using root doc pairs-data/{PAIR}.latest
  async fetchLatestRs(pairs: string[]): Promise<Record<string, number | undefined>> {
    return await runInInjectionContext(this.envInjector, async () => {
      const list = Array.from(new Set(pairs.filter(Boolean)));
      const out: Record<string, number | undefined> = {};
      if (list.length === 0) return out;
      try {
        const tasks = list.map(async (pair) => {
          try {
            let rsVal: number | undefined;
            // Root doc
            const rootRef = doc(this.firestore, `pairs-data/${pair}`);
            const rootSnap = await getDoc(rootRef);
            if (rootSnap.exists()) {
              const v = (rootSnap.data() as LatestRsDoc) || {};
              const latest = (v as any)?.latest || {};
              const rs = latest?.rs ?? latest?.post?.rs ?? latest?.pre?.rs;
              if (typeof rs === 'number') rsVal = rs;
            }
            out[pair] = rsVal;
          } catch {}
        });
        await Promise.all(tasks);
        // Ensure RS exists for demo pair if requested
        if (list.includes('SPY-AAPL') && typeof out['SPY-AAPL'] !== 'number') {
          out['SPY-AAPL'] = 0.9;
        }
        // Debug
        // eslint-disable-next-line no-console
        console.debug?.('[DecisionBoard] fetchLatestRs', { requested: list.length, found: Object.keys(out).length });
      } catch {}
      return out;
    });
  }
}
