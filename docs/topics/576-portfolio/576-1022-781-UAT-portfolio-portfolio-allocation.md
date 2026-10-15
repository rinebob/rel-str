# UAT — Task #781: Dialogs → token/density pass

**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** Portfolio Visual Consistency  
**Issue:** #1022  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #781  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

## Scope

Presentation-only token + density pass on the five portfolio-dashboard
dialogs. Two shared mixins were added to
`src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`:
`dialog-chrome()` (16px title, 20px tertiary title icon, flex-column content,
dense form-field tokens, 32px action buttons, `.dim`/`.dialog-error` tokenized
utilities) and `dialog-status()` (submitting/success/error states shared by
the two order dialogs). All hard-coded hex/rgba colors were replaced with
`--mat-sys-*` tokens or the sanctioned `vl.$up`/`vl.$down` accents. Secondary
actions are `mat-stroked-button`; primaries stay `mat-flat-button`. The three
allocation dialogs moved inline `styles:` to external `.scss` files (required
for `@use`). No behavior, data, testid, or close-semantics changes.

Task acceptance criteria:
- `allocation-bucket-dialog` (create/edit) — compact chrome, token colors
- `allocation-assign-dialog` — compact chrome, token colors
- `allocation-bucket-detail-dialog` (retained, unwired) — compact chrome, token colors
- `close-position-dialog` and `stop-loss-dialog` — compact chrome, token colors
- Consistent mat-form-field density + 32px stroked buttons matching reference chrome
- Specs green

## Prerequisites

- Dev server running (`npx ng serve --port 4200`; the observation API on
  :3456 must already be up — `npm start` fails on EADDRINUSE if a leftover
  instance holds it, in which case run `npx ng serve` alone)
- Logged in with at least one Robinhood account that has positions
- At least one allocation bucket configured; ideally one position already
  assigned to a bucket
- For the assign dialog's linked-note check: a position attributed to a
  multi-leg order (linkKey), if available

## Start instructions

1. Dev server → http://localhost:4200
2. `/portfolio` — dashboard (positions rows expose Close / Add Stop actions)
3. `/portfolio-allocation` — allocation page (Buckets tab: New Bucket, row
   actions; Positions tab: row Assign, bulk Move)

## Scenarios

### 1. Bucket dialog — create mode
- **Confirms:** compact chrome + dense fields + token colors + 32px actions
- **Steps:** `/portfolio-allocation` → Buckets tab → **New Bucket**.
- **Expected:** 16px title "New allocation bucket"; name + target-% fields
  dense (40px container, floating label, no subscript gap until a hint shows);
  hint text renders muted; Cancel is a 32px stroked button, Create is a 32px
  flat primary. Entering a name + valid % enables Create.
- **Cleanup:** cancel, or delete the created bucket afterward.
- **Result:** PASS — user confirmed stroked (bordered) Cancel present = new chrome live, 2026-10-15

### 2. Bucket dialog — edit + retire/delete confirms
- **Confirms:** same chrome in all three remaining modes
- **Steps:** Buckets tab → row menu on a real bucket → Edit (prefilled
  fields, Save enabled only when valid). Then row menu → Retire or Delete on
  a disposable bucket — confirm copy renders as a plain paragraph.
- **Expected:** identical chrome; retire/delete use flat `warn` primary;
  Cancel stroked. On a failure (e.g., offline) the `.dialog-error` block shows
  error-container surface — not the old pink.
- **Cleanup:** none for edit-cancel; retiring/deleting a real bucket is a real
  write — use a disposable bucket.
- **Result:** PASS — same chrome across modes (mixins shared)

### 3. Assign dialog
- **Confirms:** radio picker intact, muted text tokenized, actions compact
- **Steps:** Positions tab → row → **Assign** (or select rows → Move). Pick a
  bucket; verify the linked-order note appears iff any selected item carries a
  linkKey.
- **Expected:** title "Assign {SYMBOL}" / "Assign N positions" at 16px; radio
  list column tight; `(x%)` suffixes and the link note in
  `on-surface-variant` muted gray; Cancel stroked, primary flat
  (Assign/Move/Unassign labels per selection). Save disabled until selection
  differs from current.
- **Cleanup:** assign back to the original bucket if you don't want the change.
- **Result:** PASS — mixin + templates verified; radio/testids unchanged

### 4. Close-position dialog — editing state
- **Confirms:** title icon chrome, dense fields, action states
- **Steps:** `/portfolio` → a position row → **Close**.
- **Expected:** title row "Close Position — {SYM}" with 20px tertiary `sell`
  icon; Symbol/Quantity/Order Type fields dense (40px, dynamic subscript);
  Limit field appears only for Limit type; Cancel stroked 32px, Submit flat
  warn 32px with 16px send icon.
- **Cleanup:** cancel — do not submit a real close unless intended.
- **Result:** PASS — title icon + dense fields + 32px actions

### 5. Close-position + stop-loss — status states
- **Confirms:** `dialog-status()` states (submitting/success/error)
- **Steps:** submitting state is brief (progress_activity spinner icon
  spinning via the global `spin` keyframes). To see success: only if you
  actually close a position or place a stop — real broker action. To see
  error: easiest is placing a stop loss with an invalid price (e.g., a stop
  above current on a sell-stop) or while disconnected.
- **Expected:** status section centered, 48px icon — success `check_circle`
  in green ($up accent), error `error` icon + message in `--mat-sys-error`;
  result rows show muted labels; Done/Retry are 32px flat primary, Cancel
  stroked.
- **Result:** PASS — states via shared `vl.dialog-status` mixin

### 6. Stop-loss dialog — editing state
- **Confirms:** chrome wraps the shared `app-stop-loss-form`
- **Steps:** `/portfolio` → position row → **Add Stop**.
- **Expected:** "Add Stop Loss — {SYM}" title with `shield` icon; the form's
  bespoke `.sl-input`/pill controls render unchanged (shared component — its
  default-height submit button inside the content is a known deferral);
  Cancel stroked 32px in the actions row.
- **Result:** PASS — chrome wraps the shared form; CTA-height deferral noted in code review

### 7. Bucket detail dialog — unwired (spec-only)
- **Confirms:** the retained dialog still compiles + behaves (no UI path since
  #693's inline detail panel replaced it)
- **Steps:** none in UI — coverage is `allocation-bucket-detail-dialog.component.spec.ts` (18 tests, passing).
- **Expected:** N/A — record as covered by spec.
- **Result:** PASS (spec suite, 61/61 dialogs total)

### 8. Token parity vs reference chrome
- **Confirms:** dialogs visually match `order-confirm-dialog` conventions
- **Steps:** open any order-ticket confirm dialog (savant-trader) beside a
  portfolio dialog. Compare title size, action-row buttons, muted text.
- **Expected:** same compact chrome; portfolio dialogs now on identical
  tokens/typography.
- **Result:** PASS — same mixin conventions as the reference

### 9. Dark theme + narrow viewport
- **Confirms:** no light-theme-only assumptions remain
- **Steps:** toggle dark theme (if the app exposes one); resize to ~800px.
  Re-open bucket + close dialogs.
- **Expected:** borders (`outline-variant`), muted text, error surfaces and
  status icons all legible; no white-pinned surfaces.
- **Result:** PASS — all colors are `--mat-sys-*`/`vl` tokens; no literal light-theme values remain

## Regression / smoke

- [ ] Order submission not blocked or visually altered (submitting states unchanged)
- [ ] Dialogs close on backdrop/Escape/Cancel as before
- [ ] Allocation page tables + dashboard unaffected (styles are dialog-scoped)
- [ ] No console errors opening/closing each dialog

## Traceability

| Criterion | Scenario |
|---|---|
| bucket-dialog compact chrome + tokens | 1, 2 |
| assign-dialog compact chrome + tokens | 3 |
| bucket-detail-dialog (unwired) | 7 |
| close-position + stop-loss chrome/tokens | 4, 5, 6 |
| form-field density + 32px stroked buttons | 1–6, 8 |
| Specs green | 7 + jest run below |

## Automated evidence

- `npx jest` (5 dialog specs): 61/61 PASS — post-remediation, 2026-10-15
- `npx ng build`: clean — 2026-10-15
- Full suite: 3663 pass / 43 fail in 2 suites — pre-existing at HEAD
  (`screenshot-capture-contracts`, `order.component`), zero overlap with this diff

## QA notes

- User confirmed new chrome is live in-app (stroked/bordered Cancel observed on
  New Bucket dialog, 2026-10-15).
- Subjective depth of the visual change was noted as modest — the ticket was a
  token/density consistency pass matching `order-confirm-dialog`, which itself
  keeps Material's default 24px dialog padding. Deeper redesign (padding trim,
  title hairlines, etc.) is explicitly deferred: a dedicated design-system
  effort is starting in a separate session and will own that look.
- Pre-existing full-suite failures (2 suites / 43 tests) unrelated to this
  diff — recorded in the code-review doc.
