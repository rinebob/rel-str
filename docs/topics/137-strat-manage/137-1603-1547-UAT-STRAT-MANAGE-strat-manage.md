**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1603  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1547  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-18  

# UAT — #1547 FE: Create New Instance dialog (variant × symbols × mode/trigger/stop)

## Scope

The Create New Instance dialog and its write path, per #1547 acceptance
criteria:

1. Named-variant picker merges catalog + ad hoc session variants;
   multi-symbol picker creates one instance per symbol
2. Mode select (paper default; real disabled v1); real requires exactly
   one non-ALL stop type
3. Trigger select daily|signal; ALL-CAPS ID preview via
   `manage-instance-id`; duplicate IDs skip at preview + write seam (filter-submit, #1605)
4. Writes `ManageInstance` docs with `runState: 'UNSTARTED'` via the
   Firestore SDK (one `runTransaction` — atomic across the symbol set)

## Prerequisites

- App already running on `http://localhost:4200` (dev server confirmed
  up during QA setup).
- Signed in with your Google account — the route is behind `authGuard`
  and every write stamps `userId` = your uid.
- **These scenarios write REAL docs** to prod `st-strategy-instances`.
  Every doc is created `UNSTARTED`, so nothing fires until a Start
  click; cleanup is a one-line console delete per doc (S7).

## Getting to the feature

- **Route:** `http://localhost:4200/options/strategy/manage`
- **Entry point:** nav sidebar → **Strategy Manage** (wrench icon), or
  the Strategy Manage link on the Options Strategy dashboard
- **Surface:** the Paper | Real tab bar over the instance table; the
  **Create New Instance** button sits in the page header at the right.
  Clicking it opens the dialog.

## Automated evidence

- `manage-create-instance.component.spec.ts` — 16 specs: picker merge,
  ALL-CAPS preview, dup mark + block, invalid-symbol error, real
  disabled, stop-type options, per-symbol fan-out, adhoc `variantRef`,
  CUSTOM-segment id, stopType reset on mode flip, 50-symbol cap, dedup,
  pending/no-submit guards, `disableClose` lock, failure stays open.
- `strategy-manage.service.spec.ts` — `createInstances` 11 specs:
  txn reads-then-writes, payload (`UNSTARTED`, `userId`, paper-only
  `paperAccountId`), doc path, exists block, soft-deleted message,
  mixed-existence abort, intra-set dup, invariant, empty set, txn
  failure propagation, auth gate.
- `strategy-manage.store.spec.ts` — variants merge + catalog-collision
  drop, same-id replace, `createInstances` error-return channel,
  real-mode refusal.
- Result at review time: 86/86 touched specs; full savant-trader suite
  172/172 — 3456 tests.

## Scenarios

### S1 — Create two paper instances end-to-end (the E2E journey)

- **Confirms:** AC1, AC3 (preview), AC4
- **Start:** on `/options/strategy/manage`, Paper tab active, dialog closed
- **Steps:**
  1. Click **Create New Instance** (header, right side)
  2. Variant select: pick **call debit spread 50-40 30** (first option,
     already selected by default)
  3. Mode: leave **Paper**. Trigger: leave **Daily**. Stop type shows
     **ALL** greyed out — do not touch it
  4. In **Symbols**, type exactly: `QQQ, SPY`
  5. Read the preview list — it must show two rows:
     `QQQ → QQQ-CDS-30-50-40-ALL` and `SPY → SPY-CDS-30-50-40-ALL`
     (ALL-CAPS, no "already exists" mark — if a dup mark appears, S2
     already proved out; note it and use different symbols, e.g.
     `IWM, DIA`)
  6. Click **Create 2 instances**
- **Expected:** dialog closes; the Paper tab table shows two new rows —
  `QQQ-CDS-30-50-40-ALL` and `SPY-CDS-30-50-40-ALL`, both **Run State:
  UNSTARTED**, Stop Type `ALL`, Trigger `daily`, Open Position
  `Waiting`/`No`
- **Firestore check (optional):** console → `st-strategy-instances` →
  `QQQ-CDS-30-50-40-ALL` — fields `runState: "UNSTARTED"`,
  `variantRef: "cds-30-50-40"`, `mode: "paper"`, `stopType: "ALL"`,
  `trigger: "daily"`, `userId` = your uid, `paperAccountId` set
- **Result/evidence:** **PASS — 2026-11-18 (live, user-run).** Two rows
  observed on the Paper tab: `QQQ-CDS-30-50-40-ALL` and
  `SPY-CDS-30-50-40-ALL`, Symbol QQQ/SPY, Variant `call debit spread
  50-40 30`, Stop `ALL`, Trigger `daily`, Run State `UNSTARTED`,
  Position `No`, Created `2026-11-18`, Action `Start`. Dialog preview
  showed both ALL-CAPS ids before create.
  *Pre-run note:* the first attempt failed `Missing or insufficient
  permissions` — an orphan seed doc at `QQQ-CDS-30-50-40-ALL` (no
  `userId`) denied the transaction's existence-check read. Doc deleted
  (along with the collection — the five `260819-*` ACTIVE engine
  instances were removed too and will be re-created via the
  strategy-builder UI); rerun passed. Finding F-1 logged below.

### S2 — Filter-submit: duplicates are left behind, clean rows create

- **Confirms:** AC3 (duplicate handling) — **semantics revised in-cycle
  per user feedback (#1605):** submit is the filter — clean rows write,
  flagged rows stay in the field
- **Start:** after S1 (both docs exist)
- **Steps:**
  1. Open **Create New Instance** again
  2. Same variant (**call debit spread 50-40 30**), mode Paper, Daily
  3. Symbols: `QQQ, IWM` — preview shows `QQQ → … — already exists`
     (dup-marked) and `IWM` clean; the button reads **Create 1
     instance** (counts clean rows only) and is **enabled**
  4. Click **Create 1 instance**
  5. Re-open the dialog, Symbols: `QQQ` alone (every row flagged)
- **Expected:** (4) the dialog stays open with notice `Created 1 — 1
  left below`; the Symbols field now contains only `QQQ` (the created
  symbol was consumed); the Paper tab shows the new
  `IWM-CDS-30-50-40-ALL` UNSTARTED row. (5) Create is **disabled** —
  nothing clean to submit. Cancel closes.
- **Result/evidence:** **PASS — 2026-11-18 (live, user-run).**

### S3 — Mode and stop-type invariants

- **Confirms:** AC2
- **Start:** dialog open
- **Steps:**
  1. Open the Mode select — confirm **Real (disabled in v1)** is
     greyed out and unselectable
  2. With Mode = Paper, open the Stop type select — it is a disabled
     fixed `ALL`
- **Expected:** real cannot be selected; paper's stop type is always
  `ALL` (the composite stop for paper). (The `ALL`-never-offered-for-
  real branch is unreachable UI in v1 — spec-covered at
  `stopTypeOptions` + the service's `isValidModeStopType` guard.)
- **Result/evidence:** **PASS — 2026-11-18 (live, user-run).**

### S4 — Signal trigger + second catalog variant

- **Confirms:** AC3 (trigger select), AC1 (catalog breadth)
- **Start:** dialog open
- **Steps:**
  1. Variant: **call debit spread 40-30 45**
  2. Trigger: **Signal**
  3. Symbols: `IWM`
- **Expected:** preview `IWM → IWM-CDS-45-40-30-ALL`; Create → row
  appears with Trigger `signal`, Variant column showing the 40-30 45
  name
- **Result/evidence:** **PASS — 2026-11-18 (live, user-run).**

### S5 — Invalid symbols + over-cap guard

- **Confirms:** symbol validation; the 50-symbol transaction cap
- **Start:** dialog open
- **Steps:**
  1. Symbols: `QQQ, BAD-SYM` → preview shows `BAD-SYM` with `'BAD-SYM'
     is not a valid symbol`; `QQQ` marks 'already exists' — with every
     row flagged, Create is disabled (add `IWM` and it enables — the
     submit filter again)
  2. Replace the field with this 51-symbol paste (one line):
     `S00 S01 S02 S03 S04 S05 S06 S07 S08 S09 S10 S11 S12 S13 S14 S15
      S16 S17 S18 S19 S20 S21 S22 S23 S24 S25 S26 S27 S28 S29 S30 S31
      S32 S33 S34 S35 S36 S37 S38 S39 S40 S41 S42 S43 S44 S45 S46 S47
      S48 S49 S50`
  3. Symbols: `QQQ QQQ, qqq` → exactly one `QQQ` preview row (dedup)
- **Expected:** the paste shows a `Too many symbols — 51 parsed, max 50
  per create` error under the field and Create is disabled; the dedup
  input produces a single preview row
- **Result/evidence:** **PASS — 2026-11-18 (live, user-run).**
  Scroll defect found + fixed in-cycle: At ~49 rows the preview list grew past the viewport with
  no scroll (dialog pushed off-screen). Fixed during QA:
  `.id-preview { max-height: 240px; overflow-y: auto }` — the list
  scrolls internally instead of the pane. Re-check on refresh. The
  `QQQ QQQ, qqq` paste produces ONE `QQQ` row — note it will show
  'already exists' + disabled Create since S1 minted that doc (that IS
  the dedup working — the parse collapses to one row, and the id
  collides). **Confirmed live:** `QQQ QQQ, qqq` rendered one `QQQ`
  row marked 'already exists'; switching variant minted
  `QQQ-CDS-45-40-30-ALL` clean + enabled — id-grammar correct.

### S6 — Failure keeps the dialog open; dismiss locked mid-write

- **Confirms:** dialog-scoped error channel; `disableClose` during write
- **Start:** dialog open
- **Steps:**
  1. Type `QQQ QQQ, qqq` in Symbols (one valid row), click **Create**,
     and *immediately* press **Escape** or click the backdrop while the
     spinner shows
  2. After the write completes, create a collision the preview can't
     see: in Firestore console, soft-delete `SPY-CDS-30-50-40-ALL`
     (add field `deletedAt: "2026-11-18T00:00:00Z"`), then in a
     second browser tab open the dialog (fresh page load is fine) and
     enter `SPY` — the preview stream may still show it as free if the
     deleted doc is filtered; either way submit
- **Expected:** (1) Escape/backdrop does nothing while the spinner is
  up — the dialog stays; (2) under filter-submit the soft-deleted doc
  is a **skip**, not an error — the create returns `Created 0 — 1 left
  below`, `SPY` stays in the field, and nothing is written (verify in
  the console that the tombstone doc still carries `deletedAt` —
  skipped, never overwritten). The page banner behind the dialog
  stays clean. If step 2's preview flags the doc as already-exists,
  record that instead — the row never enters the submit set at all.
- **Result/evidence:** **PASS — 2026-11-18 (live, user-run).**

### S7 — Cleanup

- In the table, confirm each created row is **UNSTARTED** (nothing
  fires until Start). To remove the QA docs: Firestore console →
  `st-strategy-instances` → delete `QQQ-CDS-30-50-40-ALL`,
  `SPY-CDS-30-50-40-ALL`, `IWM-CDS-45-40-30-ALL` (and `IWM-CDS-30-50-40-ALL`
  / `DIA-…` if used). If you'd rather keep them for the #1598 table
  UAT, leave them — they're the realistic data that pass needs.
- **Result/evidence:** **PASS — 2026-11-18.** Rows left in place
  for the #1598 table UAT.

## Manual UI/UX refinement pass

- [ ] Dialog chrome matches the allocation dialogs (title, `dse-field`
      spacing, `ds-btn outline|fill` actions)
- [ ] Preview rows readable — dup rows and error rows visually distinct
      from minted ids
- [ ] Hint copy legible; Symbols field takes focus on open (or at
      least flows Variant → Mode → Trigger → Stop → Symbols)
- [ ] Cancel disabled while the spinner shows; no banner error leaks
      behind the overlay on failure
- [ ] New rows land correctly in the F2 table (sort/filter/start-stop
      still work — doubles as the #1598 smoke check)

## QA result

**PASS — 2026-11-18.** All scenarios run live by the user on
localhost:4200 against prod Firestore: S1 (two `…-ALL` UNSTARTED
rows), S2 (filter-submit — dup left in field, clean row created,
`Created 1 — 1 left` notice), S3 (Real greyed + ALL fixed), S4
(`IWM-CDS-45-40-30-ALL` signal-trigger row), S5 (51-paste cap +
scroll-capped preview), S6 (disableClose + soft-delete skip), S7
(cleanup note — rows kept for #1598). Automated: 90 specs across the
four touched files; full suite 172/172 at review.

## Findings

- **F-2 (#1605 — design change, user-proposed, IMPLEMENTED in-cycle):**
  all-or-nothing create blocked a 20-symbol paste over 3–4 dups.
  Filter-submit semantics adopted during this QA: Create enabled with
  ≥1 clean row, writes the clean subset in one transaction (existing
  ids → `skipped`, never overwrite), created symbols are consumed from
  the field, leftovers stay with a `Created N — M left` notice, dialog
  closes only when nothing remains. Supersedes the 'duplicate ID
  blocked' AC — S2/S5/S6 rewritten to match. #1605 closes when #1547
  ships.
- **F-3 (fixed in-cycle):** `.id-preview` unbounded — a ~49-symbol list
  overflowed the viewport, dialog pushed off-screen, no scroll.
  `max-height: 240px; overflow-y: auto` applied to the component scss.
- **F-1 (CHORE #1604, observed live S1):** a same-id doc outside the user's
  scope (no `userId`, or owned by another uid) is invisible to the
  preview's dup check, and the transaction's `txn.get` on it is denied
  by rules — the create then fails `Missing or insufficient
  permissions` instead of the actionable "already exists". Two layers
  to the fix question: translate the denial at the write seam, and/or
  decide per-user ID namespacing at the SHARED contract level (the
  code-review doc already flagged the global namespace).

## Traceability

| Criterion | Scenario |
|---|---|
| AC1 — variant merge + one instance per symbol | S1, S4 (session/adhoc merge is spec-covered until F4 pushes variants) |
| AC2 — paper default, real disabled, real-non-ALL | S3 (+ specs) |
| AC3 — daily\|signal, ALL-CAPS preview, dup blocked | S1, S2, S4, S5, S6 |
| AC4 — `UNSTARTED` docs via Firestore SDK | S1 (rows + console check), S6 |
| TEST plan E2E line — two `…-ALL` rows on Paper tab | S1 |
| TEST plan edge — duplicate attempt blocked | S2, S6 |

## Regression / smoke

- [ ] Paper/Real tabs still partition rows; F2 sort/filter/start-stop
      unaffected on the new rows
- [ ] No console errors on dialog open/close or during create
- [ ] Page banner still reserved for load/toggle errors (create errors
      stay dialog-scoped)

## Verdict

**Pending — awaiting the live pass.**

## Results log

- 2026-11-17 — UAT doc created. Dev server confirmed up on :4200.
  Automated seam evidence recorded above (86 specs). Live scenarios
  S1–S7 pending user execution (login + clicks).
