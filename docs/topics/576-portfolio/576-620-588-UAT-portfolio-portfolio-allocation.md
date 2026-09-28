# UAT — #588 FE Allocation page shell

**Status:** Complete  
**Task:** #588  
**QA issue:** #620  
**Topic:** Portfolio Allocation (#576)  
**Thread:** #577  
**Blueprint:** #582 (FE)  
**Files:** `allocation-page.component.ts`, `allocation-page.component.spec.ts`, `allocation.store.ts`, `core-routes.ts`, `interfaces.ts`, `constants.ts`

## How to get there

`npm start` → log in → left nav → **Portfolio Allocation** (directly under
"Portfolio Dashboard") → URL is `/portfolio-allocation`.

## What to confirm

### 1. Page loads + nav

- Nav entry exists beside Portfolio Dashboard; the page loads (lazy route,
  auth-gated like the dashboard).

### 2. Account tabs

- One tab per Robinhood account — **all** accounts, including any
  non-agentic ones.
- The non-agentic account's tab label carries a `non-agentic` pill;
  hover/focus it → tooltip says order placement isn't enabled there.

### 3. Account header

Inside the selected account's tab, the header row shows:

- **Account value** / **Allocated** / **Cash** / **Unassigned** dollar
  figures, plus an `as of …` timestamp on the right.
- If broker-reported cash disagrees with the derived remainder, an ⚠
  appears next to Cash (hover → explains both numbers). Most likely you
  won't see it unless positions are stale.

### 4. Buckets subtab

- A row per configured allocation bucket (name, exposure, P&L columns),
  then an **Unassigned** row, then a **Cash** row pinned last (italic).
- With no buckets configured yet, you should at least see Unassigned +
  Cash.

### 5. Positions subtab

- One row per open position: instrument id, market value, and bucket name
  — `Unassigned` for anything not yet attributed (expected for all
  positions until #590's assign UI lands).

### 6. Tab switching

- Switch to the other account tab → header + both subtabs show that
  account's data (not the first account's).
- Switch back → your original account restored.

### 7. Refresh + error paths

- **Refresh** button (top-right) re-fetches the selected account; it's
  disabled and reads `Loading…` while working.
- The reload preserves your selected account rather than snapping back
  to tab 0.

### 8. Look & feel (refinement)

- Spacing/alignment sane; non-agentic pill and ⚠ are visible but not
  loud; placeholder tables are intentionally minimal — real tables and
  dialogs land in #589–#591, so judge bones not polish.
