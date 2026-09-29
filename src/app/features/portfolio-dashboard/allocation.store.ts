/**
 * AllocationStore — NgRx SignalStore for the Allocation Manager page
 * (Blueprint #582 / task #587).
 *
 * Follows the PortfolioDashboardStore pattern: per-account slices keyed by
 * accountNumber so tab switches don't re-fetch; computed selectors join
 * bucket config + computeBucketStats rollups, derive the Cash and
 * Unassigned pseudo-rows, and build the account-header completeness check.
 *
 * Attribution writes invalidate dependent selectors automatically — the
 * store subscribes to watchAttributions$ per selected account, so a
 * post-hoc move re-derives every selector without a reload (PRD hard req).
 */
import { computed, DestroyRef, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, Subscription } from 'rxjs';

import type { AccountInfo } from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { AllocationBucket, BucketStats, PositionAttribution } from '@portfolio-allocation/contracts';
import {
  attributePositions,
  buildEquityCurve,
  cashCheck,
  computeBucketStats,
  isWellFormedPosition,
  matchRealizedPnl,
  type AllocationFillInput,
  type AllocationPositionInput,
  type RealizedMatch,
} from '@portfolio-allocation/utils';
import { AllocationDataService } from './allocation-data.service';
import { AllocationBucketService } from './allocation-bucket.service';
import { PositionAttributionService } from './position-attribution.service';
import type {
  AccountAllocation,
  AccountHeader,
  BucketDetail,
  BucketRow,
  PositionRow,
} from './allocation.types';

interface AllocationState {
  accounts: AccountInfo[];
  selectedAccountIndex: number;
  byAccount: Record<string, AccountAllocation>;
  loadError: string | null;
}

function emptyAllocation(): AccountAllocation {
  return {
    snapshot: null, positions: [], fills: [],
    buckets: [], attributions: [],
    asOf: null, loading: false, error: null,
  };
}

const initialState: AllocationState = {
  accounts: [],
  selectedAccountIndex: 0,
  byAccount: {},
  loadError: null,
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stats for the Unassigned pseudo-row: every position/fill instrument
 *  with no attribution doc — OR an attribution pointing at a bucket that
 *  doesn't exist in the loaded set (dangling = effectively unassigned;
 *  the UI still renders those rows as 'Unknown bucket' so the data issue
 *  is visible, but the numbers must not vanish). Flat-but-traded
 *  unassigned instruments keep their realized P&L AND count as closed —
 *  same "flat + has fill history" semantics computeBucketStats uses. */
function unassignedStats(
  positions: AllocationPositionInput[],
  fills: AllocationFillInput[],
  attributions: PositionAttribution[],
  accountNumber: string,
  liveBucketIds: Set<string>,
  asOf: string,
): BucketStats {
  const attributed = new Set(
    attributions
      .filter((a) => a.accountNumber === accountNumber && liveBucketIds.has(a.bucketId))
      .map((a) => a.instrumentId),
  );
  const ownPositions = positions.filter((p) => !attributed.has(p.instrumentId) && isWellFormedPosition(p));
  const ownFills = fills.filter((f) => !attributed.has(f.instrumentId));
  const realized = matchRealizedPnl(ownFills);

  let realizedPnl = 0;
  const matches: RealizedMatch[] = [];
  for (const r of realized.values()) {
    realizedPnl += r.realizedPnl;
    matches.push(...r.matches);
  }
  const unrealizedPnl = ownPositions.reduce((s, p) => s + (p.marketValue - p.costBasis), 0);
  // Unassigned instruments that were traded but are currently flat.
  const openIds = new Set(ownPositions.map((p) => p.instrumentId));
  const flatIds = new Set(ownFills.map((f) => f.instrumentId).filter((id) => !openIds.has(id)));

  return {
    bucketId: '__unassigned__',
    exposure: ownPositions.reduce((s, p) => s + Math.abs(p.marketValue), 0),
    netValue: ownPositions.reduce((s, p) => s + p.marketValue, 0),
    targetDollars: 0,
    drift: 0,
    realizedPnl,
    unrealizedPnl,
    openCount: ownPositions.length,
    closedCount: flatIds.size,
    asOf,
    equityCurve: buildEquityCurve(matches, unrealizedPnl, ownPositions.length > 0 || ownFills.length > 0, asOf),
  };
}

export const AllocationStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    selectedAccount: computed((): AccountInfo | null =>
      state.accounts()[state.selectedAccountIndex()] ?? null),

    /** The selected account's allocation slice (empty while unloaded). */
    selectedAllocation: computed((): AccountAllocation => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      return acct ? (state.byAccount()[acct.accountNumber] ?? emptyAllocation()) : emptyAllocation();
    }),

    bucketRows: computed((): BucketRow[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const alloc = state.byAccount()[acct.accountNumber] ?? emptyAllocation();
      const acctAttributions = alloc.attributions.filter((a) => a.accountNumber === acct.accountNumber);
      const liveBucketIds = new Set(alloc.buckets.map((b) => b.id));
      // '' when unloaded — buildEquityCurve's Date.parse guard degrades
      // gracefully; never stamp a fabricated "now" inside a computed.
      const asOf = alloc.asOf ?? '';
      // Allocation basis = RH-reported cash (you allocate FROM the cash
      // pool); fall back to totalValue when the snapshot omits cash.
      const basis = alloc.snapshot?.cash ?? alloc.snapshot?.totalValue ?? 0;

      const rows: BucketRow[] = alloc.buckets.map((bucket) => ({
        kind: 'bucket',
        bucket,
        stats: computeBucketStats(bucket, basis, alloc.positions, alloc.fills, acctAttributions, asOf),
        cash: null,
      }));

      rows.push({
        kind: 'unassigned',
        bucket: null,
        stats: unassignedStats(alloc.positions, alloc.fills, acctAttributions, acct.accountNumber, liveBucketIds, asOf),
        cash: null,
      });

      rows.push({
        kind: 'cash',
        bucket: null,
        stats: null,
        cash: cashCheck(
          alloc.snapshot?.cash ?? 0,
          alloc.snapshot?.totalValue ?? 0,
          alloc.positions,
        ),
      });
      return rows;
    }),

    positionsRows: computed((): PositionRow[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const alloc = state.byAccount()[acct.accountNumber] ?? emptyAllocation();
      const acctAttributions = alloc.attributions.filter((a) => a.accountNumber === acct.accountNumber);
      const bucketNames = new Map(alloc.buckets.map((b) => [b.id, b.name]));
      const attrByInstrument = new Map(acctAttributions.map((a) => [a.instrumentId, a]));

      // Only well-formed (real) positions list — RH returns qty-0
      // 'empty' placeholder rows for instruments with resting orders
      // (verified against the live get_equity_positions payload). Those
      // aren't positions, can't be valued, and must never appear or be
      // assignable — a resting stop rides with the position it protects.
      return attributePositions(
        alloc.positions.filter(isWellFormedPosition),
        acctAttributions, acct.accountNumber,
      ).map((r) => ({
        position: r.position,
        bucketId: r.bucketId,
        bucketName: r.bucketId === null
          ? 'Unassigned'
          : (bucketNames.get(r.bucketId) ?? 'Unknown bucket'),
        // Dangling attribution = numerically unassigned (same fold-in the
        // header and pseudo-row apply) — flag it so the Positions tab's
        // Unassigned filter/count can't disagree with the header total.
        unresolved: r.bucketId !== null && !bucketNames.has(r.bucketId) ? true : undefined,
        linkKey: r.bucketId === null ? undefined : attrByInstrument.get(r.position.instrumentId)?.linkKey,
      }));
    }),

    accountHeader: computed((): AccountHeader | null => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return null;
      const alloc = state.byAccount()[acct.accountNumber] ?? emptyAllocation();
      const positions = alloc.positions.filter(isWellFormedPosition);
      const liveBucketIds = new Set(alloc.buckets.map((b) => b.id));
      const attributed = new Set(
        alloc.attributions
          .filter((a) => a.accountNumber === acct.accountNumber && liveBucketIds.has(a.bucketId))
          .map((a) => a.instrumentId),
      );
      const check = alloc.snapshot
        ? cashCheck(alloc.snapshot.cash ?? 0, alloc.snapshot.totalValue ?? 0, positions)
        : null;
      return {
        accountValue: alloc.snapshot?.totalValue ?? null,
        allocated: positions.reduce((s, p) => s + Math.abs(p.marketValue), 0),
        cash: alloc.snapshot?.cash ?? null,
        derivedCash: check?.derived ?? null,
        cashDiverged: check?.diverged ?? false,
        unassignedExposure: positions
          .filter((p) => !attributed.has(p.instrumentId))
          .reduce((s, p) => s + Math.abs(p.marketValue), 0),
        asOf: alloc.asOf,
      };
    }),
  })),

  withMethods((store) => {
    const data = inject(AllocationDataService);
    const bucketService = inject(AllocationBucketService);
    const attrService = inject(PositionAttributionService);
    const destroyRef = inject(DestroyRef);
    const subscriptions = new Map<string, { buckets?: Subscription; attrs?: Subscription }>();

    function slice(acct: string): AccountAllocation {
      return store.byAccount()[acct] ?? emptyAllocation();
    }

    function patchAccount(acct: string, partial: Partial<AccountAllocation>): void {
      patchState(store, {
        byAccount: { ...store.byAccount(), [acct]: { ...slice(acct), ...partial } },
      });
    }

    /** Attach the two watch streams once per account. */
    function attachStreams(accountNumber: string): void {
      const subs = subscriptions.get(accountNumber) ?? {};
      if (subs.buckets && subs.attrs) return;
      subs.buckets ??= bucketService.watchBuckets$(accountNumber)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (buckets) => patchAccount(accountNumber, { buckets }),
          error: (err: unknown) => {
            patchAccount(accountNumber, { error: errMessage(err) });
            // Clear the dead sub — the next attachStreams (selectAccount/
            // refresh) re-subscribes instead of leaving the stream dead.
            subs.buckets = undefined;
          },
        });
      subs.attrs ??= attrService.watchAttributions$(accountNumber)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (attributions) => patchAccount(accountNumber, { attributions }),
          error: (err: unknown) => {
            patchAccount(accountNumber, { error: errMessage(err) });
            subs.attrs = undefined;
          },
        });
      subscriptions.set(accountNumber, subs);
    }

    let refreshing = false;
    let accountsLoading = false;

    async function loadAccount(accountNumber: string): Promise<void> {
      const prev = slice(accountNumber);
      if (prev.loading || (prev.asOf !== null && prev.snapshot !== null)) return;
      patchAccount(accountNumber, { loading: true, error: null });
      try {
        const [snapshot, positions, fills] = await Promise.all([
          data.getSnapshot(accountNumber),
          data.getPositions(accountNumber),
          data.getFills(accountNumber),
        ]);
        patchAccount(accountNumber, {
          snapshot, positions, fills, asOf: new Date().toISOString(), loading: false,
        });
      } catch (err) {
        patchAccount(accountNumber, { loading: false, error: errMessage(err) });
      }
    }

    return {
      /** Load all accounts and select the first — streams + data attach. */
      async loadAccounts(): Promise<void> {
        if (accountsLoading) return;
        accountsLoading = true;
        patchState(store, { loadError: null });
        try {
          const accounts = await data.listAccounts();
          // Preserve the previously selected account across page revisits —
          // resolve by accountNumber, not index, since RH order can shift.
          const prevSelected = store.accounts()[store.selectedAccountIndex()]?.accountNumber;
          const idx = prevSelected ? accounts.findIndex((a) => a.accountNumber === prevSelected) : -1;
          const selectedAccountIndex = idx >= 0 ? idx : 0;
          patchState(store, { accounts, selectedAccountIndex });
          const sel = accounts[selectedAccountIndex];
          if (sel) {
            attachStreams(sel.accountNumber);
            await loadAccount(sel.accountNumber);
          }
        } catch (err) {
          patchState(store, { loadError: errMessage(err) });
        } finally {
          accountsLoading = false;
        }
      },

      /** Switch the active account tab — attaches streams, lazy-loads. */
      async selectAccount(index: number): Promise<void> {
        const acct = store.accounts()[index];
        if (!acct) return;
        patchState(store, { selectedAccountIndex: index });
        attachStreams(acct.accountNumber);
        await loadAccount(acct.accountNumber);
      },

      /** Force-refresh the selected account's MCP data; also re-attaches
       *  any stream that died on error. Re-entrant-safe. */
      async refresh(): Promise<void> {
        if (refreshing) return;
        const acct = store.accounts()[store.selectedAccountIndex()];
        if (!acct) return;
        refreshing = true;
        try {
          attachStreams(acct.accountNumber);
          patchAccount(acct.accountNumber, { asOf: null }); // allow reload
          await loadAccount(acct.accountNumber);
        } finally {
          refreshing = false;
        }
      },

      // -- attribution writes — services write; watch streams re-derive --
      async assignPosition(accountNumber: string, instrumentId: string, bucketId: string, linkKey?: string): Promise<void> {
        await firstValueFrom(attrService.attribute$(accountNumber, instrumentId, bucketId, linkKey));
      },

      async unassignPosition(accountNumber: string, instrumentId: string): Promise<void> {
        await firstValueFrom(attrService.unassign$(accountNumber, instrumentId));
      },

      /** Bulk assign — ONE read + ONE txn for the whole selection
       *  (attributeMany$ unions every item's linkKey group). A partial
       *  failure can't strand the batch: all-or-nothing per txn. */
      async assignPositions(
        accountNumber: string,
        items: { instrumentId: string; linkKey?: string }[],
        bucketId: string,
      ): Promise<void> {
        await firstValueFrom(attrService.attributeMany$(accountNumber, items, bucketId));
      },

      async unassignPositions(accountNumber: string, instrumentIds: string[]): Promise<void> {
        await firstValueFrom(attrService.unassignMany$(accountNumber, instrumentIds));
      },

      // -- bucket mutations --
      async createBucket(accountNumber: string, name: string, targetPct: number): Promise<void> {
        await firstValueFrom(bucketService.createBucket$(accountNumber, name, targetPct));
      },
      async renameBucket(accountNumber: string, bucketId: string, newName: string): Promise<void> {
        const bucket = store.byAccount()[accountNumber]?.buckets.find((b) => b.id === bucketId);
        if (!bucket) throw new Error(`Bucket '${bucketId}' is not loaded for ${accountNumber}`);
        await firstValueFrom(bucketService.renameBucket$(bucket, newName));
      },
      async updateTargetPct(_accountNumber: string, bucketId: string, targetPct: number): Promise<void> {
        await firstValueFrom(bucketService.updateTargetPct$(bucketId, targetPct));
      },
      async retireBucket(_accountNumber: string, bucketId: string): Promise<void> {
        await firstValueFrom(bucketService.retireBucket$(bucketId));
      },

      /** Hard-delete — cascades the bucket's attributions back to
       *  Unassigned atomically (see AllocationBucketService.deleteBucket$). */
      async deleteBucket(_accountNumber: string, bucketId: string): Promise<void> {
        await firstValueFrom(bucketService.deleteBucket$(bucketId));
      },

      /** Bucket + stats + owned positions for the detail dialog. */
      bucketDetail(bucketId: string): BucketDetail | null {
        const acct = store.accounts()[store.selectedAccountIndex()];
        if (!acct) return null;
        const alloc = store.byAccount()[acct.accountNumber] ?? emptyAllocation();
        const bucket = alloc.buckets.find((b) => b.id === bucketId);
        if (!bucket) return null;
        const stats = store.bucketRows().find((r) => r.bucket?.id === bucketId)?.stats;
        if (!stats) return null;
        const positions = store.positionsRows().filter((p) => p.bucketId === bucketId);
        return { bucket, stats, positions };
      },
    };
  }),
);
