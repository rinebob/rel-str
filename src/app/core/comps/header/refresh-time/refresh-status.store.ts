import { inject, computed } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { Firestore, collection, collectionData, query, where, orderBy, limit } from '@angular/fire/firestore';
import { Subscription, interval, map } from 'rxjs';

export type RefreshStatusState = {
  inProgress: boolean;
  lastCompletedAt: Date | null;
  nextFetchAt: Date | null;
  now: Date;
  lastAbs: string;
  lastAgo: string;
  nextAbs: string;
  nextIn: string;
};

const initialState: RefreshStatusState = {
  inProgress: false,
  lastCompletedAt: null,
  nextFetchAt: null,
  now: new Date(),
  lastAbs: '—',
  lastAgo: '—',
  nextAbs: '—',
  nextIn: '—',
};

// Subscriptions bag (singleton widget in app header)
let _subs: Subscription[] = [];
let _tickerSub: Subscription | undefined;

export const RefreshStatusStore = signalStore(
  { providedIn: 'root' },
  withState<RefreshStatusState>(initialState),
  withMethods((store, firestore = inject(Firestore)) => ({
    recalc(): void {
      const now = new Date();
      patchState(store, { now });
      const last = store.lastCompletedAt();
      const updates: Partial<RefreshStatusState> = {};
      if (last instanceof Date) {
        updates.lastAbs = formatAbsET(last);
        updates.lastAgo = formatHms(now.getTime() - last.getTime());
      }
      const inProg = store.inProgress();
      const next = store.nextFetchAt();
      if (!inProg && next instanceof Date) {
        updates.nextAbs = formatAbsET(next);
        const ms = next.getTime() - now.getTime();
        updates.nextIn = ms > 0 ? formatHms(ms) : '00:00:00';
      } else if (inProg) {
        updates.nextAbs = '—';
        updates.nextIn = '—';
      }
      patchState(store, updates as RefreshStatusState);
    },
    start(): void {
      const completedQ = query(
        collection(firestore, 'partner-events'),
        where('status', 'in', ['completed', 'completed_with_errors']),
        orderBy('endTime', 'desc'),
        limit(1)
      );
      _subs.push(
        collectionData(completedQ, { idField: 'id' }).pipe(map((rows: any[]) => rows?.[0]))
          .subscribe((doc: any) => {
            if (!doc) return;
            const endTime = extractDate(doc?.endTime) || extractDate(doc?.publishTime) || undefined;
            const nextFetchRaw = typeof doc?.nextFetchAt === 'string' ? doc.nextFetchAt : undefined;
            patchState(store, {
              lastCompletedAt: endTime || null,
              nextFetchAt: nextFetchRaw ? parseEtLocalDateString(nextFetchRaw) : null,
            });
            this.recalc();
          })
      );
      const processingQ = query(
        collection(firestore, 'partner-events'),
        where('status', '==', 'processing'),
        orderBy('startTime', 'desc'),
        limit(1)
      );
      _subs.push(
        collectionData(processingQ, { idField: 'id' }).pipe(map((rows: any[]) => rows?.[0]))
          .subscribe((doc: any) => { patchState(store, { inProgress: !!doc }); this.recalc(); })
      );
      _tickerSub = interval(1000).subscribe(() => this.recalc());
    },
    startMock(): void {
      const now = new Date();
      const last = new Date(now.getTime() - 2 * 60_000);
      const next = new Date(now.getTime() + 13 * 60_000);
      patchState(store, {
        inProgress: false,
        lastCompletedAt: last,
        nextFetchAt: next,
      });
      this.recalc();
      _tickerSub = interval(1000).subscribe(() => this.recalc());
    },
    stop(): void {
      _tickerSub?.unsubscribe();
      _subs.forEach((s: Subscription) => s.unsubscribe());
      _subs = [];
    },
  })),
  withComputed(({ inProgress, lastAbs, lastAgo, nextAbs, nextIn }) => ({
    vm: computed(() => ({ inProgress: inProgress(), lastAbs: lastAbs(), lastAgo: lastAgo(), nextAbs: nextAbs(), nextIn: nextIn() }))
  }))
);


// ---- Helper functions (moved outside the store) ----
function extractDate(v: any): Date | undefined {
  if (!v) return undefined;
  if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof v === 'number') {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return undefined;
}

function formatAbsET(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'short', day: '2-digit',
      hour: 'numeric', minute: '2-digit'
    } as any).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function getTzOffsetMinutesAt(utcDate: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  } as any);
  const parts = fmt.formatToParts(utcDate);
  const val = (t: string) => Number(parts.find(p => p.type === t)?.value || '0');
  const y = val('year');
  const m = val('month');
  const d = val('day');
  const hh = val('hour');
  const mm = val('minute');
  const ss = val('second');
  const localAsUTC = Date.UTC(y, (m - 1), d, hh, mm, ss);
  const diffMs = localAsUTC - utcDate.getTime();
  return Math.round(diffMs / 60000);
}

function parseEtLocalDateString(s: string): Date | undefined {
  try {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})\s*ET$/i);
    if (!m) return undefined;
    const y = Number(m[1]);
    const mon = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const utcGuess = new Date(Date.UTC(y, mon - 1, d, hh, mm, 0));
    const etOffsetMin = getTzOffsetMinutesAt(utcGuess, 'America/New_York');
    return new Date(utcGuess.getTime() + etOffsetMin * 60_000);
  } catch { return undefined; }
}