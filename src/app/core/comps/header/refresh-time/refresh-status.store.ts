import { inject, computed, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { signalStore, withState, withMethods, withComputed, patchState } from '@ngrx/signals';
import { Subscription, interval } from 'rxjs';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';
import { Collection, Subcollection } from '../../../common/constants';

export type RefreshStatusState = {
  inProgress: boolean;
  lastCompletedAt: Date | null;
  nextRefreshAt: Date | null;
  now: Date;
  lastAbs: string;
  lastAgo: string;
  nextAbs: string;
  nextIn: string;
};

const initialState: RefreshStatusState = {
  inProgress: false,
  lastCompletedAt: null,
  nextRefreshAt: null,
  now: new Date(),
  lastAbs: '—',
  lastAgo: '—',
  nextAbs: '—',
  nextIn: '—',
};

// Subscriptions bag (singleton widget in app header)
let _subs: Subscription[] = [];
let _tickerSub: Subscription | undefined;
let _tickerIntervalMs: number | undefined;

export const RefreshStatusStore = signalStore(
  { providedIn: 'root' },
  withState<RefreshStatusState>(initialState),
  withMethods((store) => {
    const envInj: EnvironmentInjector = inject(EnvironmentInjector);
    return ({
      recalc(): void {
        const now = new Date();
        patchState(store, { now });
        const last = store.lastCompletedAt();
        const updates: Partial<RefreshStatusState> = {};
        const inProg = store.inProgress();
        if (inProg) {
          updates.lastAbs = 'Update in progress';
          updates.lastAgo = '—';
        } else if (last instanceof Date) {
          updates.lastAbs = formatAbsET(last);
          updates.lastAgo = formatHm(now.getTime() - last.getTime());
        }
        const next = store.nextRefreshAt();
        if (inProg) {
          updates.nextAbs = '—';
          updates.nextIn = '—';
        } else if (next instanceof Date) {
          const ms = next.getTime() - now.getTime();
          if (ms > 0) {
            updates.nextAbs = formatAbsET(next);
            updates.nextIn = formatNextCountdown(ms);
          } else {
            // Past or equal: suppress stale absolute time
            updates.nextAbs = '—';
            updates.nextIn = '00h 00m';
          }
        } else {
          // Unknown next
          updates.nextAbs = '—';
          updates.nextIn = '—';
        }
        patchState(store, updates as RefreshStatusState);
        const dbg = {
          inProgress: store.inProgress(),
          lastCompletedAtISO: store.lastCompletedAt() instanceof Date ? (store.lastCompletedAt() as Date).toISOString() : null,
          nextRefreshAtISO: store.nextRefreshAt() instanceof Date ? (store.nextRefreshAt() as Date).toISOString() : null,
          lastAbs: store.lastAbs(),
          lastAgo: store.lastAgo(),
          nextAbs: store.nextAbs(),
          nextIn: store.nextIn(),
        };
        // eslint-disable-next-line no-console
        // console.debug('[RefreshStatus] recalc', dbg);
        (this as any).startTickerIfNeeded();
      },
      start(): void {
        console.debug('[RefreshStatus] start() called');
        try {
          runInInjectionContext(envInj, () => {
            const fs = inject(Firestore);
            const ref = doc(fs, Collection.APP, Subcollection.REFRESH_STATUS);
            const sub = (docSnapshots(ref) as any).subscribe({
              next: (snap: any) => {
                const data = typeof snap?.data === 'function' ? snap.data() : snap;
                if (!data) return;
                const status = (data?.runStatus) as string | undefined;
                const last = extractDate(data?.endTimeUTC);
                const next = extractDate(data?.nextRefreshAtUTC);
                patchState(store, {
                  inProgress: status === 'processing',
                  lastCompletedAt: last || null,
                  nextRefreshAt: next || null,
                });
                this.startTickerIfNeeded();
                (this as any).recalc();
              },
              error: (err: any) => {
                console.error('[RefreshStatus] status doc subscribe error', { code: err?.code, message: err?.message, details: err });
              }
            });
            _subs.push(sub as Subscription);
          });
        } catch (e) {
          console.error('[RefreshStatus] start() failed before subscriptions', e);
        }
      },
      startTickerIfNeeded(): void {
        const inProg = store.inProgress();
        const next = store.nextRefreshAt();
        const shouldTick = !!next || !!inProg;

        if (!shouldTick) {
          _tickerSub?.unsubscribe();
          _tickerSub = undefined;
          _tickerIntervalMs = undefined;
          return;
        }

        let desired = 60000; // 1 minute

        if (_tickerSub && _tickerIntervalMs === desired) return;

        _tickerSub?.unsubscribe();
        _tickerIntervalMs = desired;
        _tickerSub = interval(desired).subscribe(() => (this as any).recalc());
      },
      stop(): void {
        _tickerSub?.unsubscribe();
        _subs.forEach((s: Subscription) => s.unsubscribe());
        _subs = [];
      },
    });
  } ),
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

function formatHm(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}h ${pad(mm)}m`;
}

function formatHmsVerbose(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}h ${pad(mm)}m ${pad(ss)}s`;
}

function formatNextCountdown(ms: number): string {
  if (ms >= 60000) return formatHm(ms);
  return formatHmsVerbose(ms);
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