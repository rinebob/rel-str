**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Allocation Manager Page  
**Thread Slug:** `alloc-manager-page`  
**Issue:** #579  
**Thread Parent:** #577  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# FE Implementation Plan — Portfolio Allocation Manager

A dedicated tabbed page in the `portfolio-dashboard` feature area. All live data via the existing `RobinhoodMcpClient`; all persistence via the client Firestore SDK. Follows the `PortfolioDashboardStore` SignalStore pattern.

## 1. Route + shell

- New route (e.g. `/portfolio/allocation`) in the portfolio-dashboard area; nav entry alongside the dashboard.
- Page shell **reuses the dashboard's account-tab pattern**: `mat-tab-group` with one tab per RH account (all accounts from `get_accounts`, non-agentic flagged — bypasses the existing agentic-only filter). Inside each account tab: **account header** (value / allocated / cash remainder) → **subtabs** (Buckets | Positions).

## 2. Services

- `allocation-bucket.service.ts` — CRUD on `portfolio/buckets/items` (scoped `userId` + `accountNumber`); `watchBuckets$`/`listBuckets$`/`createBucket$`/`updateTargetPct$`/`renameBucket$`/`retireBucket$`. Create + rename check the `{acct}_{slug}` doc id inside a transaction — occupied ids are never freed, so existence = conflict.
- `position-attribution.service.ts` — `portfolio/attributions/items`; `attribute$` covers assign (new doc, `fromBucketId: null`) and move (append from→to); `unassign$` deletes the doc (absence = Unassigned); `seedFromTicket$` takes the ticket's `bucketId` verbatim — txn re-verifies the bucket exists, is ACTIVE, and belongs to the account (else no-op → Unassigned) — and stamps `linkKey` = orderId. All mutators fan out atomically across `linkKey` siblings. *(Amended 2026-09-30: the ticket stores the bucket id directly; the earlier name→bucket slug resolution was dropped as unnecessary indirection.)*
- `allocation-data.service.ts` — MCP wrappers: `listAccounts` (all accounts, `agenticAllowed` surfaced not filtered), `getSnapshot` (broker cash = allocation basis), `getPositions` / `getFills` assembling domain inputs.
- `allocation-mappers.ts` — pure MCP→domain mapping: equity keyed by symbol, options by instrumentId (×100), orders expand legs×executions into fills, equity sell→close inferred from `sharesHeldForSells`.
- `RobinhoodMcpClient` — `BrokerOrder` gains optional `legs[]` (per-contract `optionId` + `positionEffect`) and `executions[]` (per-fill price/qty/timestamp); `normalizeOrder` parses both, tolerating `option_id` or `option` URL forms.

## 3. Store — `allocation.store.ts` (NgRx SignalStore)

State: `selectedAccount` (driven by the active account tab), `accounts[]`, `buckets[]`, `attributions[]`, `positions[]`, `orderHistory[]`, `loading/error`.

Selectors (all per selected account):
- `bucketRows` — merge bucket config + `computeBucketStats` output; Cash row computed last (account value − Σ exposures); Unassigned as a pseudo-row.
- `positionsRows` — positions + resolved bucket name per row (Unassigned filter).
- `accountHeader` — value / allocated / remainder completeness check.
- `bucketDetail(id)` — positions + stats for the detail dialog.
- Attribution writes invalidate dependent selectors — dialog and tabs must reflect moves without reload (PRD hard requirement).

## 4. Components

- `allocation-page` — shell, selector, header, tab bar.
- `buckets-table` — unified config+analytics rows; pinned computed Cash row; row actions (edit %, rename, retire w/ confirm); create affordance.
- `bucket-edit-dialog` — create/edit target %, rename (MatDialog).
- `positions-table` — position rows w/ bucket column + **assign** action (opens bucket picker); Unassigned filtered view.
- `assign-bucket-dialog` — bucket picker for post-hoc assignment/move (shared by positions tab rows).
- `bucket-detail-dialog` — large dialog: header = bucket metadata + **view-switcher dropdown** (view only); detail = **position carousel** — click through all positions without closing; per-position stats + **'trade chart' stub** (TBD dependency — render placeholder, spec deferred).
- Ticket integration (savant-trader order ticket): optional bucket selector — **never required for submission**; `wouldExceedTarget` warning on submit (extends `order-guardrails.util` — warn, not block).

## 5. Boundaries

- Reads: `RobinhoodMcpClient` (existing) — no new MCP surface.
- Writes: `portfolio/buckets/items`, `portfolio/attributions/items` via client SDK — no callables.
- Shared: all math via `shared/portfolio-allocation-utils.ts`.
- Order ticket: `bucketId` field added to `OrderTicket`/ticket types; the user selects a bucket on the ticket — no auto-stamp, no name resolution (amended 2026-09-30).

## 6. Risks

- **Store/MCP latency**: order history fetch per account switch — cache per account, label as-of timestamps.
- **Carousel + dialog state sync**: attribution writes while dialog open must re-derive `bucketDetail` — use store selectors as single source of truth, never dialog-local copies.
- **Non-agentic accounts**: positions load read-only but assignment writes are local — UI must not imply order placement is possible there.
