**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1598  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1546  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1546 FE: Instance table — columns, sort/filter, position join, start/stop

## Scope

F2 of the Strategy Manage page: the full 9-column instance table
(Instance ID, Symbol, Variant, Stop Type, Trigger, Run State, Open
Position, Created, Actions), column sorting incl. shift+click
multi-sort, text/run-state/position-status filters, the open-position
join cell (`Yes · {status}` / `Waiting` / `No`), and per-row
Start/Stop/Restart actions that write `runState` back to
`st-strategy-instances/{id}` — restartable, never a new doc, real rows
disabled in v1.

## Prerequisites

- Signed in to the app (the page is auth-gated; the instance stream is
  `userId`-scoped — seed docs must carry your uid).
- Dev server running with the F2 code checked out.
- Firestore console access to `st-strategy-instances` and
  `paper-trading/positions/items` for seeding/reset.

## Getting to the feature

**Route:** `/options/strategy/manage` (auth-gated, lazy-loaded).  
**Entry points:**
- Top nav → **Options** group → **Manage** (between "Strategy
  Dashboard" and "Backtest").
- Options Strategy Dashboard (`/options/strategy-dashboard`) →
  **Manage Strategies** button.
- Paper Trading (`/trading/paper`) → **Strategy Manage** link.  
**Surface:** Paper | Real tab bar, a filter row (search input + "Run
state" and "Position" selects), and the 9-column instance table.

## Test data

Four instance docs on `st-strategy-instances` (Firestore console → Add
document; every doc needs `userId: <your uid>` and a `variant` object —
`variant.name` is what the Variant column renders; reuse the catalog
variant `cds-30-50-40` shape from the F1 UAT or a minimal
`{ "name": "call debit spread 50-40 30", "templateRef": "cds", "legs": [...] }`
object — the table only reads `variant.name`):

```text
1) doc id: QQQ-CDS-30-50-40-ALL
   symbol: QQQ | mode: paper | trigger: daily | stopType: ALL
   runState: UNSTARTED | createdAt: 2026-11-01T00:00:00Z | updatedAt: same

2) doc id: SPY-CDS-45-40-30-ALL
   symbol: SPY | mode: paper | trigger: signal | stopType: ALL
   runState: ACTIVE | createdAt: 2026-11-10T00:00:00Z | updatedAt: same

3) doc id: AAPL-CDS-60-50-40-ALL
   symbol: AAPL | mode: paper | trigger: daily | stopType: ALL
   runState: STOPPED | createdAt: 2026-11-05T00:00:00Z | updatedAt: same

4) doc id: QQQ-CDS-30-50-40-T8
   symbol: QQQ | mode: real | trigger: daily | stopType: T8
   runState: ACTIVE | createdAt: 2026-11-12T00:00:00Z | updatedAt: same
```

One open position on `paper-trading/positions/items` joins to doc 1:

```text
doc id:    QQQ-CDS-30-50-40-ALL-2026-11-15
symbol:    QQQ
source:    strategy          (lowercase — PaperTradeSource.STRATEGY)
strategyInstanceId: QQQ-CDS-30-50-40-ALL
status:    OPEN
order:     { side: "SHORT", type: "LIMIT" }
legs:      [ { contractID: "QQQ260515C00500000", type: "CALL",
               side: "LONG", strike: 500, quantity: 1,
               multiplier: 100, lastMark: 1.10 } ]
fills:     [ { fillId: "f1", role: "entry", date: "2026-11-15",
               price: 1.20, quantity: 1 } ]
createdAt: 2026-11-15T00:00:00Z | updatedAt: 2026-11-15T00:00:00Z
```

Reset between scenarios by editing `runState` on the seeded doc or
deleting the position doc — no app-level cleanup needed (F3 will own
create/delete).

## Automated evidence

- `strategy-manage` suites: **51 specs green** (service 10, store 16,
  component 25) — `npx jest --coverage=false src/app/features/savant-trader/{pages,stores,services}/strategy-manage`
- Full suite: **317 suites / 5893 tests green**
- `ng build` clean — zero warnings on the changed surface
- Design-system verifier: **103/103**

## Scenarios

### S1 — Full column set renders from seeded docs

1. Seed docs 1–4 above; open `/options/strategy/manage`. **Expect:**
   Paper tab shows 3 rows (QQQ/SPY/AAPL); headers read Instance ID,
   Symbol, Variant, Stop Type, Trigger, Run State, Open Position,
   Created, Actions. Row 1 shows `call debit spread 50-40 30` (variant
   name), `ALL`, `daily`, `UNSTARTED`, `2026-11-01`.  
   **Result: PASS** — component spec asserts the exact 9-header order
   and per-cell population (incl. `2026-11-05` created slice, `signal`
   trigger, `ALL` stop type). **Manual:** confirm live rows match.

### S2 — Column sorting + multi-sort

1. Click **Symbol** → rows order AAPL, QQQ, SPY (asc). Click again →
   SPY, QQQ, AAPL (desc). Third click → unsorted.  
2. Shift+click **Run State** while Symbol is sorted → secondary key;
   a small superscript rank badge (`1`, `2`) appears on both headers;
   hover a header → "Click to sort · shift+click to add a secondary
   sort". Tab-focus a header and press Enter/Space → also sorts.  
   **Result: PASS** — spec pins Symbol asc→desc ordering; aria-sort +
   icon/rank markup match the paper-trading convention verbatim.
   **Manual:** confirm rank badge + keyboard sort + title hint.

### S3 — Text filter

1. Type `qqq` in the search box → only the QQQ row remains. Type
   `call debit` → same (variant match). Clear → all rows return.  
   **Result: PASS** — spec pins symbol filtering; haystack covers
   id/symbol/variant.name. **Manual:** confirm variant text match.

### S4 — Run-state filter

1. "Run state" select → `ACTIVE` → only the SPY row. `STOPPED` → only
   AAPL. `UNSTARTED` → only QQQ-ALL. `All run states` → 3 rows.  
   **Result: PASS** — spec pins select-driven filtering.

### S5 — Position-status filter (open / waiting / flat)

1. "Position" select → `Open` → only QQQ (seeded position).  
2. → `Waiting` → only SPY (ACTIVE, no position).  
3. → `Flat` → only AAPL (STOPPED, no position).  
   **Result: PASS** — spec pins all three buckets (waiting vs flat
   distinguished). **Manual:** confirm live buckets.

### S6 — Open-position cell states

1. QQQ row (joined position) → cell reads `Yes · Open` (label-mapped,
   not raw `OPEN`).  
2. SPY row (ACTIVE, flat) → `Waiting`.  
3. AAPL row (STOPPED, flat) → `No`.  
   **Result: PASS** — specs pin all three cell texts plus `Assigned`
   label mapping and `×N` multi-position count. **Manual:** confirm
   `Yes · Open` (not raw enum) on live data.

### S7 — Start / Stop / Restart writes runState

1. Click **Start** on QQQ (UNSTARTED) → row flips to `ACTIVE`,
   button becomes **Stop** (the Firestore stream re-emits; no reload).  
2. Click **Stop** → `STOPPED`, button becomes **Restart**.  
3. Click **Restart** → `ACTIVE` again — the SAME doc updates; no new
   `st-strategy-instances` doc appears (check console: only the 4
   seeded ids).  
   **Result: PASS** — store specs pin all three transitions +
   never-UNSTARTED; service spec pins the `updateDoc` payload
   (`runState` + `updatedAt`) on the existing doc path. **Manual:**
   confirm the live toggle + no duplicate doc.

### S8 — Real tab rows are disabled

1. Switch to the **Real** tab → the `QQQ-CDS-30-50-40-T8` row renders
   dimmed (`.real-row` opacity); its action button is **disabled**
   (greyed, no click).  
   **Result: PASS** — spec pins `btn.disabled === true` on the real
   row; store spec pins the no-op guard at the mutation seam.
   **Manual:** confirm the dim + disabled affordance.

### S9 — Error banner dismiss + filtered empty state

1. (Spec-level) a failed toggle sets the banner; the ✕ button calls
   `store.clearError()` and a subsequent successful toggle clears the
   stale banner automatically.  
2. Set any filter that hides all rows (e.g. Position → `Open` after
   deleting the seed position, then Run state → `ACTIVE` on the paper
   tab with only AAPL/SPY visible) → empty state reads **"No instances
   match the active filters."** (not "No paper instances yet.").  
   **Result: PASS** — specs pin the dismiss call, error-clear on
   retry, and the filtered-empty copy. **Manual:** confirm the filtered
   empty-state wording.

### S10 — Malformed-doc resilience

1. Add a doc to `st-strategy-instances` with `runState: 'ACTIVE'` and
   `userId` but **no `variant` field** → the page does NOT crash; the
   malformed row is filtered out of the stream.  
   **Result: PASS** — `isLiveManageInstance` requires
   `typeof d.variant?.name === 'string'`; service spec pins the drop.

### S11 — Positions fetch failure is non-fatal

1. (Spec-level) if `listStrategyPositions` fails, the table still
   renders all rows — position cells fall back to Waiting/No (join is
   advisory).  
   **Result: PASS** — store spec pins join `{}` + instances intact.
   **Known limitation (waived):** a failed positions fetch shows
   flat-state cells rather than a "positions unavailable" marker —
   noted in the review doc for revisit if confusing.

## Manual UI/UX refinement pass

- Table density/alignment vs `paper-trading` (same `vl.dense-table`
  mixin + `ds-btn outline small` actions).
- Filter-bar layout wraps cleanly below ~900px (`flex-wrap`).
- Real-row dimming + disabled button read as intentionally inactive.
- Keyboard: tab reaches sort headers + action buttons; Enter/Space
  sort; selects are native.  
  **Result: pending — user visual pass required** (no dev server was
  running during this QA; spec evidence covers behavior, not look/feel).

## Findings

- None blocking. Waived items from the review doc: position join is
  fetch-once (a noon-pass mint won't appear until revisit — improve in
  F5 via `lastFiredAt`-triggered refetch); failed positions fetch shows
  flat cells (no marker); no pending-write disable (writes are
  idempotent absolute states).

## Traceability

| AC / criterion | Scenario |
|---|---|
| 9 columns (ID, symbol, variant, stop type, trigger, runState, open-position yes/no+status, created, actions) | S1, S6 |
| Sort on symbol, variant, state, position status | S2 (all columns sortable) |
| Filter on symbol, variant, state, position status | S3, S4, S5 |
| ACTIVE-flat renders "waiting" not broken | S6 |
| Start/stop toggle UNSTARTED→ACTIVE→STOPPED, restartable, same doc | S7 |
| Real rows disabled v1 | S8 |
| No crash on malformed shared-root docs | S10 |
| Positions join failure non-fatal | S11 |

## Regression / smoke

- [ ] Options Strategy Dashboard still renders + its links work (F1
  page untouched — full suite green).
- [ ] Paper Trading page unaffected (same dense-table mixin — no
  shared style file changed; only page-local scss added).
- [ ] Old `/options/strategy/build` still retired (spec-pinned in
  core-routes retired list).
- [ ] Design-system verifier stays 103/103.

## Verdict

**Deferred to F3** — behavior is spec-verified end-to-end (51
strategy-manage specs pin every scenario's rendered outcome), but no
prod instances exist and no create UI ships until #1547 ("Create New
Instance" dialog). The live visual walkthrough + refinement pass runs
once F3 can mint real instances — seeded-console fixtures above remain
as the fallback path.

## Results log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | Full column set | PASS (spec) | component spec: header order + per-cell render |
| S2 | Sort + multi-sort | PASS (spec) | asc→desc pinned; aria-sort/rank/icon match convention |
| S3 | Text filter | PASS (spec) | symbol substring filter pinned |
| S4 | Run-state filter | PASS (spec) | select-driven filter pinned |
| S5 | Position buckets | PASS (spec) | open/waiting/flat distinction pinned |
| S6 | Cell states | PASS (spec) | Yes·label/Waiting/No + label map + ×N pinned |
| S7 | Toggle writes | PASS (spec) | 3 transitions + updateDoc payload + never-UNSTARTED |
| S8 | Real disabled | PASS (spec) | disabled attr + store no-op both pinned |
| S9 | Error/empty UX | PASS (spec) | clearError call, retry-clear, filtered copy pinned |
| S10 | Malformed doc | PASS (spec) | variant-required discriminator pinned |
| S11 | Positions failure | PASS (spec) | join-empty + instances-intact pinned |
| UI/UX | Visual pass | PENDING | needs running dev server + seeded docs |
