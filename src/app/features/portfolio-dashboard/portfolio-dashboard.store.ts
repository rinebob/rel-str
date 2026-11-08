/**
 * PortfolioDashboardStore — NgRx SignalStore managing all portfolio dashboard state.
 *
 * State: per-account sections (portfolio, positions, quotes, orders) with
 * independent loading/error. Computed selectors join positions with quotes
 * for PnL, filter orders by state, and compute stop-loss protection.
 *
 * Loading (#1408): one prioritized path — accounts → selected account's
 * visible sections (globalLoading releases at first paint) → serial
 * prefetch waterfall of every remaining section. selectAccount joins an
 * in-flight wave or fetches on demand; reconcileOrders refetches orders
 * silently with in-flight + trailing dedupe.
 *
 * Error policy: loadAccounts rethrows (caller decides how to surface a total
 * account-load failure). Section fetches swallow per-section errors into
 * SectionData.error so partial dashboard data remains visible. refresh()/
 * initialLoad() catch top-level failures, set loadError, and clear
 * globalLoading.
 */

import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';

import { RobinhoodMcpClient } from '../../core/robinhood-mcp/robinhood-mcp-client.service';
import {
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  EquityQuote,
  OptionQuote,
  BrokerOrder,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import { computePnL, computeProtectedSymbols, computeEntryDates, updatableStopsBySymbol, protectiveStopsBySymbol } from './utils/portfolio-pnl.util';
import { PositionPeakService } from './services/position-peak.service';
import {
  LIVE_ORDER_STATES,
  TERMINAL_ORDER_STATES,
} from './utils/order-states.util';
import {
  AccountState,
  AggregateSummary,
  DashboardState,
  EquityPositionWithPnL,
  OptionPositionWithPnL,
  SectionData,
  SectionName,
} from './portfolio-dashboard.types';
import {
  collectEquitySymbols,
  collectOptionInstrumentIds,
  computeAccountPnL,
  createAccountState,
  sortAccountsPrimaryFirst,
  updateAccount,
} from './portfolio-dashboard.helpers';

const initialState: DashboardState = {
  accounts: [],
  selectedAccountIndex: 0,
  showOrderHistory: false,
  globalLoading: false,
  loadError: null,
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadingSection<T>(prev: SectionData<T>): SectionData<T> {
  return { data: prev.data, loading: true, error: null };
}

function dataSection<T>(data: T): SectionData<T> {
  return { data, loading: false, error: null };
}

function errorSection<T>(prev: SectionData<T>, msg: string): SectionData<T> {
  return { data: prev.data, loading: false, error: msg };
}

export const PortfolioDashboardStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    selectedAccount: computed(() => {
      const accounts = state.accounts();
      const idx = state.selectedAccountIndex();
      return accounts[idx] ?? null;
    }),

    aggregateSummary: computed((): AggregateSummary => {
      const accounts = state.accounts();
      let totalValue = 0;
      let totalExposure = 0;
      let totalCash = 0;
      let totalBuyingPower = 0;
      let totalPnL = 0;
      let hasValue = false;
      let hasExposure = false;
      let hasCash = false;
      let hasBuyingPower = false;
      let hasPnL = false;

      for (const acct of accounts) {
        const p = acct.portfolio.data;
        if (p?.totalValue !== null && p?.totalValue !== undefined) {
          totalValue += p.totalValue;
          hasValue = true;
        }
        if (p?.equityValue !== null && p?.equityValue !== undefined) {
          totalExposure += p.equityValue;
          hasExposure = true;
        }
        if (p?.cash !== null && p?.cash !== undefined) {
          totalCash += p.cash;
          hasCash = true;
        }
        if (p?.buyingPower !== null && p?.buyingPower !== undefined) {
          totalBuyingPower += p.buyingPower;
          hasBuyingPower = true;
        }
        const acctPnL = computeAccountPnL(acct);
        if (acctPnL !== 0 || acct.equityQuotes.data || acct.optionQuotes.data) {
          totalPnL += acctPnL;
          hasPnL = true;
        }
      }

      return {
        totalValue: hasValue ? totalValue : null,
        totalExposure: hasExposure ? totalExposure : null,
        totalCash: hasCash ? totalCash : null,
        totalBuyingPower: hasBuyingPower ? totalBuyingPower : null,
        totalPnL: hasPnL ? totalPnL : null,
      };
    }),

    equityPositionsWithPnL: computed((): EquityPositionWithPnL[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const positions = acct.equityPositions.data;
      if (!positions) return [];
      const quotes = acct.equityQuotes.data;
      const entryDates = computeEntryDates(acct.equityOrders.data ?? []);

      return positions.map((p) => {
        const currentPrice = quotes?.get(p.symbol)?.lastTradePrice ?? null;
        const qty = p.quantity;
        const closed = qty === null || qty === 0;
        const side = qty !== null && qty < 0 ? 'sell' : 'buy';
        const entryDate = entryDates.get(`${side}:${p.symbol}`) ?? null;
        if (closed || currentPrice === null) {
          return { ...p, currentPrice, pnl: null, pnlPercent: null, closed, entryDate };
        }
        const isShort = qty < 0;
        const result = computePnL(p.averageBuyPrice, currentPrice, Math.abs(qty), isShort);
        return { ...p, currentPrice, pnl: result.pnl, pnlPercent: result.pnlPercent, closed, entryDate };
      });
    }),

    optionPositionsWithPnL: computed((): OptionPositionWithPnL[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const positions = acct.optionPositions.data;
      if (!positions) return [];
      const quotes = acct.optionQuotes.data;

      return positions.map((p) => {
        const currentPrice = quotes?.get(p.instrumentId)?.lastTradePrice ?? null;
        const qty = p.quantity;
        const closed = qty === null || qty === 0;
        if (closed || currentPrice === null) {
          return { ...p, currentPrice, pnl: null, pnlPercent: null, closed };
        }
        const isShort = qty < 0;
        const result = computePnL(p.averageCost, currentPrice, Math.abs(qty), isShort);
        return { ...p, currentPrice, pnl: result.pnl, pnlPercent: result.pnlPercent, closed };
      });
    }),

    openOrders: computed((): BrokerOrder[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const equity = acct.equityOrders.data ?? [];
      const option = acct.optionOrders.data ?? [];
      return [...equity, ...option].filter((o) => LIVE_ORDER_STATES.has(o.state));
    }),

    orderHistory: computed((): BrokerOrder[] => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return [];
      const equity = acct.equityOrders.data ?? [];
      const option = acct.optionOrders.data ?? [];
      return [...equity, ...option].filter((o) => TERMINAL_ORDER_STATES.has(o.state));
    }),

    stopLossProtectedSymbols: computed((): Set<string> => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return new Set();
      const orders = acct.equityOrders.data ?? [];
      const positions = acct.equityPositions.data ?? [];
      return computeProtectedSymbols(orders, positions);
    }),

    /** The display stop order per symbol (#1414) — every live protective
     *  stop on a held long, stop-limit included. What the positions-table
     *  Stop column quotes; reconciles with Open Orders (same live order). */
    protectiveStops: computed((): Map<string, BrokerOrder> => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return new Map();
      return protectiveStopsBySymbol(
        acct.equityOrders.data ?? [],
        acct.equityPositions.data ?? [],
      );
    }),

    /** Live equity stops eligible for Update Stop, grouped by symbol (#888).
     *  Sibling of stopLossProtectedSymbols — drives the positions-table
     *  action; also built to serve the Open Orders Update action (#889)
     *  and the batch ratchet (#890). */
    updatableStops: computed((): Map<string, BrokerOrder[]> => {
      const acct = state.accounts()[state.selectedAccountIndex()];
      if (!acct) return new Map();
      return updatableStopsBySymbol(
        acct.equityOrders.data ?? [],
        acct.equityPositions.data ?? [],
      );
    }),
  })),

  withMethods((store) => {
    const client = inject(RobinhoodMcpClient);
    const peakService = inject(PositionPeakService);
    let loadInFlight = false;
    // Bumped by loadAccounts — a fetch that started before the bump must not
    // mark its group loaded, or a refresh leaves pre-refresh data marked fresh.
    let loadEpoch = 0;

    /**
     * Re-resolves the account index at patch time — a refresh can rebuild the
     * accounts array while an async fetch is in flight; matching on
     * accountNumber keeps results on the right account (and no-ops when the
     * account was removed).
     */
    function patchAccount(accountNumber: string, updater: (a: AccountState) => AccountState): void {
      const accounts = store.accounts();
      const index = accounts.findIndex((a) => a.accountNumber === accountNumber);
      if (index === -1) return;
      patchState(store, { accounts: updateAccount(accounts, index, updater) });
    }

    /** Equity + option orders for one account in a single /batch request;
     *  a transport failure rejects both slots. */
    async function runOrdersBatch(accountNumber: string): Promise<[
      PromiseSettledResult<BrokerOrder[]>,
      PromiseSettledResult<BrokerOrder[]>,
    ]> {
      try {
        return await client.executeBatch([
          client.equityOrdersSpec(accountNumber),
          client.optionOrdersSpec(accountNumber),
        ]);
      } catch (err) {
        const failed: PromiseSettledResult<never> = { status: 'rejected', reason: err };
        return [failed, failed];
      }
    }

    function applyOrdersResults(
      accountNumber: string,
      [equityR, optionR]: [
        PromiseSettledResult<BrokerOrder[]>,
        PromiseSettledResult<BrokerOrder[]>,
      ],
    ): void {
      patchAccount(accountNumber, (a) => ({
        ...a,
        equityOrders: equityR.status === 'fulfilled'
          ? dataSection(equityR.value)
          : errorSection(a.equityOrders, errMessage(equityR.reason)),
        optionOrders: optionR.status === 'fulfilled'
          ? dataSection(optionR.value)
          : errorSection(a.optionOrders, errMessage(optionR.reason)),
      }));
    }

    async function loadAccounts(): Promise<void> {
      loadEpoch++;
      loadedGroups.clear();
      const accounts = await client.getAccounts();
      // Sort the primary agentic account to the first tab — shared with
      // the allocation page so both pickers show the same order (#1441).
      const sorted = sortAccountsPrimaryFirst(accounts);
      // Default to the first agentic account — the primary-agentic sort puts
      // it at index 0 when present, but a list without it shouldn't land on
      // a non-agentic account (#778 QA).
      const agenticIdx = sorted.findIndex((a) => a.agenticAllowed);
      patchState(store, {
        accounts: sorted.map(createAccountState),
        selectedAccountIndex: agenticIdx >= 0 ? agenticIdx : 0,
      });
    }

    // ── Waterfall load (#1408) ─────────────────────────────────────────────
    // Per-account load groups: 'core' = portfolio + positions + quotes (the
    // default tab's visible sections), 'orders' = equity + option orders.
    // loadedGroups tracks what's already fetched so ensure* calls are cheap
    // no-ops on revisit; loadAccounts rebuilds account state and clears it.
    // A group is marked loaded only when its fetch ran to completion — a
    // transport failure leaves it unmarked so the next ensure retries, and
    // the epoch guard keeps a pre-refresh in-flight fetch from marking a
    // group loaded on post-refresh state.

    const loadedGroups = new Set<string>();
    const coreInFlight = new Map<string, Promise<void>>();

    /** portfolio + both position sections for one account (one /batch), then
     *  that account's quotes — quotes need the positions that just landed.
     *  Returns false when the batch transport itself failed (sections get
     *  their errors; the group stays unmarked so a later ensure retries). */
    async function fetchCore(accountNumber: string): Promise<boolean> {
      patchAccount(accountNumber, (a) => ({
        ...a,
        portfolio: loadingSection(a.portfolio),
        equityPositions: loadingSection(a.equityPositions),
        optionPositions: loadingSection(a.optionPositions),
      }));

      let results: [
        PromiseSettledResult<PortfolioSnapshot>,
        PromiseSettledResult<EquityPosition[]>,
        PromiseSettledResult<OptionPosition[]>,
      ];
      try {
        results = await client.executeBatch([
          client.portfolioSpec(accountNumber),
          client.equityPositionsSpec(accountNumber),
          client.optionPositionsSpec(accountNumber, false),
        ]);
      } catch (err) {
        patchAccount(accountNumber, (a) => ({
          ...a,
          portfolio: errorSection(a.portfolio, errMessage(err)),
          equityPositions: errorSection(a.equityPositions, errMessage(err)),
          optionPositions: errorSection(a.optionPositions, errMessage(err)),
        }));
        return false;
      }
      const [portfolioR, equityR, optionR] = results;
      patchAccount(accountNumber, (a) => ({
        ...a,
        portfolio: portfolioR.status === 'fulfilled'
          ? dataSection(portfolioR.value)
          : errorSection(a.portfolio, errMessage(portfolioR.reason)),
        equityPositions: equityR.status === 'fulfilled'
          ? dataSection(equityR.value)
          : errorSection(a.equityPositions, errMessage(equityR.reason)),
        optionPositions: optionR.status === 'fulfilled'
          ? dataSection(optionR.value)
          : errorSection(a.optionPositions, errMessage(optionR.reason)),
      }));

      const acct = store.accounts().find((a) => a.accountNumber === accountNumber);
      if (!acct) return false;

      // Peak Since Entry derivation (#1413) rides the positions that just
      // landed — kicked, never awaited, so the core group isn't gated on
      // the fills walk + historicals.
      if (equityR.status === 'fulfilled') void ensurePeaks(accountNumber);

      patchAccount(accountNumber, (a) => ({
        ...a,
        equityQuotes: loadingSection(a.equityQuotes),
        optionQuotes: loadingSection(a.optionQuotes),
      }));
      const [equityQ, optionQ] = await Promise.allSettled([
        client.getEquityQuotes(collectEquitySymbols(acct)),
        client.getOptionQuotes(collectOptionInstrumentIds(acct)),
      ]);
      patchAccount(accountNumber, (a) => ({
        ...a,
        equityQuotes: equityQ.status === 'fulfilled'
          ? dataSection(equityQ.value)
          : errorSection(a.equityQuotes, errMessage(equityQ.reason)),
        optionQuotes: optionQ.status === 'fulfilled'
          ? dataSection(optionQ.value)
          : errorSection(a.optionQuotes, errMessage(optionQ.reason)),
      }));
      return true;
    }

    /** Load an account's core sections if not already loaded/in-flight —
     *  callers share the in-flight promise instead of double-fetching. */
    function ensureCore(accountNumber: string): Promise<void> {
      if (loadedGroups.has(`${accountNumber}:core`)) return Promise.resolve();
      const existing = coreInFlight.get(accountNumber);
      if (existing) return existing;
      const epoch = loadEpoch;
      const p = fetchCore(accountNumber)
        .then((ok) => {
          if (ok && loadEpoch === epoch) loadedGroups.add(`${accountNumber}:core`);
        })
        .finally(() => coreInFlight.delete(accountNumber));
      coreInFlight.set(accountNumber, p);
      return p;
    }

    // Peaks bookkeeping — one in-flight derivation per account. Re-derives
    // on every core refetch: a positions reload is exactly when fills may
    // have changed, and the walk early-exits on the first zero-crossing.
    // Joiners flag peaksAgain — a kick that lands mid-derive (e.g. a
    // refresh's fetchCore while the previous derive still runs) queues a
    // trailing pass with the fresh positions, same pattern as ordersAgain.
    const peaksInFlight = new Map<string, Promise<void>>();
    const peaksAgain = new Set<string>();

    /** Derive + patch positionPeaks for one account — joiners share the
     *  in-flight run AND queue a rerun (the joined run may hold stale
     *  positions). Loading flag marks the section without gating the
     *  group; errors land on the section, never reject upward. */
    function ensurePeaks(accountNumber: string): Promise<void> {
      const existing = peaksInFlight.get(accountNumber);
      if (existing) {
        peaksAgain.add(accountNumber);
        return existing;
      }
      const p = (async () => {
        try {
          do {
            peaksAgain.delete(accountNumber);
            const epoch = loadEpoch;
            const positions =
              store.accounts().find((a) => a.accountNumber === accountNumber)
                ?.equityPositions.data ?? [];
            patchAccount(accountNumber, (a) => ({
              ...a,
              positionPeaks: loadingSection(a.positionPeaks),
            }));
            try {
              const peaks = await peakService.derivePeaks(accountNumber, positions);
              if (loadEpoch === epoch) {
                patchAccount(accountNumber, (a) => ({
                  ...a,
                  positionPeaks: dataSection(peaks),
                }));
              }
            } catch (err) {
              if (loadEpoch === epoch) {
                patchAccount(accountNumber, (a) => ({
                  ...a,
                  positionPeaks: errorSection(a.positionPeaks, errMessage(err)),
                }));
              }
            }
          } while (peaksAgain.has(accountNumber));
        } finally {
          peaksInFlight.delete(accountNumber);
          peaksAgain.delete(accountNumber);
        }
      })();
      peaksInFlight.set(accountNumber, p);
      return p;
    }

    // Orders bookkeeping — one in-flight orders fetch per account. Joiners
    // share the leader's promise (never a concurrent duplicate); a caller
    // that needs a post-mutation snapshot flags ordersAgain so the leader
    // runs one trailing pass. Shared by prefetch (markLoading → section
    // spinners) and reconcile (silent) (#1397 + #1408).
    const ordersInFlight = new Map<string, Promise<void>>();
    const ordersAgain = new Set<string>();
    // A queued rerun runs with the requester's spinner intent — a silent
    // reconcile's trailing pass stays silent even behind a spinner-marked
    // leader.
    const rerunMarkLoading = new Map<string, boolean>();

    /** Returns false on a full batch transport failure — the group then
     *  stays unmarked so a later ensure retries. */
    async function fetchOrders(accountNumber: string, markLoading: boolean): Promise<boolean> {
      if (markLoading) {
        patchAccount(accountNumber, (a) => ({
          ...a,
          equityOrders: loadingSection(a.equityOrders),
          optionOrders: loadingSection(a.optionOrders),
        }));
      }
      const results = await runOrdersBatch(accountNumber);
      applyOrdersResults(accountNumber, results);
      return results.some((r) => r.status === 'fulfilled');
    }

    function requestOrders(accountNumber: string, markLoading: boolean): Promise<void> {
      const existing = ordersInFlight.get(accountNumber);
      if (existing) {
        ordersAgain.add(accountNumber);
        rerunMarkLoading.set(accountNumber, markLoading);
        return existing;
      }
      const epoch = loadEpoch;
      const p = (async () => {
        try {
          do {
            ordersAgain.delete(accountNumber);
            const loading = rerunMarkLoading.get(accountNumber) ?? markLoading;
            rerunMarkLoading.delete(accountNumber);
            if (!(await fetchOrders(accountNumber, loading))) break;
          } while (ordersAgain.has(accountNumber));
          if (loadEpoch === epoch) loadedGroups.add(`${accountNumber}:orders`);
        } finally {
          ordersInFlight.delete(accountNumber);
          ordersAgain.delete(accountNumber);
          rerunMarkLoading.delete(accountNumber);
        }
      })();
      ordersInFlight.set(accountNumber, p);
      return p;
    }

    /** Orders for an account — no-ops when loaded, joins the in-flight fetch
     *  (a tab select during prefetch must not double-fetch), kicks a fresh
     *  one with section spinners otherwise. */
    function ensureOrders(accountNumber: string): Promise<void> {
      if (loadedGroups.has(`${accountNumber}:orders`)) return Promise.resolve();
      return ordersInFlight.get(accountNumber) ?? requestOrders(accountNumber, true);
    }

    /** Serial prefetch: the selected account first (its orders — core
     *  already landed in the gated first wave), then each remaining
     *  account's core + orders. Runs under no global flag — every step is
     *  an ensure*, so a tab select mid-wave just joins. */
    async function prefetchWaterfall(): Promise<void> {
      const accts = store.accounts();
      const sel = accts[store.selectedAccountIndex()]?.accountNumber;
      const ordered = sel
        ? [sel, ...accts.map((a) => a.accountNumber).filter((n) => n !== sel)]
        : accts.map((a) => a.accountNumber);
      for (const accountNumber of ordered) {
        await Promise.all([ensureCore(accountNumber), ensureOrders(accountNumber)]);
      }
    }

    /** The one load path: accounts → selected account's visible sections
     *  (globalLoading releases at first paint) → silent waterfall for the
     *  rest. Shared by initialLoad and refresh — loadAccounts clears
     *  loadedGroups, so refresh() re-fetches everything through the same
     *  prioritized path. */
    async function runDashboardLoad(): Promise<void> {
      if (loadInFlight) return;
      loadInFlight = true;
      patchState(store, { loadError: null, globalLoading: true });
      try {
        await loadAccounts();
        const sel = store.accounts()[store.selectedAccountIndex()];
        if (sel) await ensureCore(sel.accountNumber);
        patchState(store, { globalLoading: false });
        await prefetchWaterfall();
      } catch (err) {
        patchState(store, { loadError: errMessage(err) });
      } finally {
        patchState(store, { globalLoading: false });
        loadInFlight = false;
      }
    }

    async function refresh(): Promise<void> {
      await runDashboardLoad();
    }

    async function initialLoad(): Promise<void> {
      await runDashboardLoad();
    }

    async function retrySection(accountIndex: number, section: SectionName): Promise<void> {
      const acct = store.accounts()[accountIndex];
      if (!acct) return;

      // 'orders' is a combined retry for both equityOrders and optionOrders —
      // routed through the shared registry so it dedupes against an
      // in-flight prefetch and marks the group loaded on success.
      if (section === 'orders') {
        await requestOrders(acct.accountNumber, true);
        return;
      }

      patchAccount(acct.accountNumber, (a) => ({
        ...a,
        [section]: loadingSection(a[section] as SectionData<unknown>),
      }));

      try {
        let data: PortfolioSnapshot | EquityPosition[] | OptionPosition[] | Map<string, EquityQuote> | Map<string, OptionQuote> | BrokerOrder[];
        switch (section) {
          case 'portfolio':
            data = await client.getPortfolio(acct.accountNumber);
            break;
          case 'equityPositions':
            data = await client.getEquityPositions(acct.accountNumber);
            break;
          case 'optionPositions':
            data = await client.getOptionPositions(acct.accountNumber, false);
            break;
          case 'equityQuotes':
            data = await client.getEquityQuotes(collectEquitySymbols(acct));
            break;
          case 'optionQuotes':
            data = await client.getOptionQuotes(collectOptionInstrumentIds(acct));
            break;
          case 'equityOrders':
            data = await client.getEquityOrders(acct.accountNumber);
            break;
          case 'optionOrders':
            data = await client.getOptionOrders(acct.accountNumber);
            break;
          default: {
            const _exhaustive: never = section;
            throw new Error(`Unknown section: ${_exhaustive}`);
          }
        }
        patchAccount(acct.accountNumber, (a) => ({
          ...a,
          [section]: dataSection(data),
        }));
      } catch (err) {
        patchAccount(acct.accountNumber, (a) => ({
          ...a,
          [section]: errorSection(a[section] as SectionData<unknown>, errMessage(err)),
        }));
      }
    }

    /** Refetch equity+option orders WITHOUT touching section loading flags.
     *  Used after a dialog-driven mutation where the dashboard must stay
     *  fully interactive while the (slow) broker call resolves — data/error
     *  patch in silently on settle. Shares the orders in-flight registry
     *  with prefetch: overlapping calls collapse into the in-flight run
     *  plus at most one trailing refetch, so rapid sequential mutations
     *  can't stack a queue of slow RH round-trips (#1397, #1408). */
    async function reconcileOrders(accountIndex: number): Promise<void> {
      const acct = store.accounts()[accountIndex];
      if (!acct) return;
      await requestOrders(acct.accountNumber, false);
    }

    return {
      loadAccounts,
      refresh,
      initialLoad,
      retrySection,
      reconcileOrders,
      /** Ensure an account's orders sections are loaded — joins the
       *  in-flight fetch or kicks one with section spinners. Called when
       *  the Orders/History tab activates before the prefetch wave
       *  reaches it (#1408). */
      ensureAccountOrders(accountIndex: number): Promise<void> {
        const acct = store.accounts()[accountIndex];
        return acct ? ensureOrders(acct.accountNumber) : Promise.resolve();
      },
      /** Switch accounts — ensures the target's sections are loaded (joins
       *  an in-flight prefetch or starts the fetch on demand). Errors land
       *  on the sections, so this never rejects. */
      async selectAccount(index: number): Promise<void> {
        patchState(store, { selectedAccountIndex: index });
        const acct = store.accounts()[index];
        if (!acct) return;
        await Promise.all([
          ensureCore(acct.accountNumber),
          ensureOrders(acct.accountNumber),
        ]);
      },
      toggleOrderHistory(): void {
        patchState(store, { showOrderHistory: !store.showOrderHistory() });
      },
    };
  }),
);
