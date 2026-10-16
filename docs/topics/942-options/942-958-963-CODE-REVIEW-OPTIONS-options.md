**Topic:** Options Trading Support  
**Topic Slug:** options-trading-support  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #963  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# Code Review — #963 OptionOrderTicketComponent (resolution + lazy staging + submit)

## Scope reviewed

- `components/option-order-ticket/` (new: ts/html/scss/spec) — contract selects + OCC paste resolution, lazy staging with guard, fatfinger, bucket picker, submit via confirm dialog
- `services/order-ticket.types.ts` — new `OrderTicketPatch` (distributive-omit union; the old `Partial<Omit<OrderTicket,'instrumentType'>>` collapsed to common keys and silently dropped option-only fields `legs`/`price`)
- `services/order-ticket.service.ts` + `stores/order-ticket.store.ts` — `updateTicket`/`updateTicketAndWait`/`mergeTicketPartial` signature widening only
- `stores/order-ticket.store.spec.ts` — stale comment + now-redundant variant casts removed in remediation

## Verdict: PASS (after in-review remediation)

Three remediation rounds. Round 1: one MAJOR (confirm-dialog re-leg race) plus minors. Round 2: one MAJOR in the round-1 remediation (ghost contract) plus minors. Round 3 (re-review at user request): one MEDIUM in the round-2 remediation (seq-blind staging continuation) plus minors — see round-3 table.

## Round 3 findings & resolutions

Round 3 re-ran Standards + Thermo on the round-2 remediations (Spec was verified clean twice). All round-2 fixes verified; findings were residual edges of the seq-guard work:

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MEDIUM | Both | **Seq-blind staging continuation:** `ensureStagedTicket`/`doEnsureStagedTicket` took no seq — a frame parked on `stagingLock` (or a `stageTicketAndWait` in flight) when the user deselected still landed the re-leg write / `ticketId` bind / `staged` emit for a contract nobody had selected | `seq` threaded through both methods: re-checked after the lock wait (stale → return null), at `doEnsureStagedTicket` entry, and post-`stageTicketAndWait` (a committed stage can't be un-rung — the ticket stays unbound and a later resolution adopts it via the card guard). Retry effect passes the current `resolveSeq`. Spec: strike→change→deselect while stage held → no re-leg, no bind, no emit |
| minor | Both | **Adopt emit lied about `created`:** A's emit suppressed by staleness → B adopts A's session-created orphan → emits `created:false` → host's discard-on-close would orphan a ticket this dialog created | `sessionStagedIds` set records every staged id; adopt emits `created: sessionStagedIds.has(id)` — true for session orphans, false for genuinely pre-existing tickets |
| minor | Standards + Thermo | `stageError` survived triplet-clear → stale inline "live option order already exists" rendered with no contract context, dormant retry state | `stageError.set(null)` in the incomplete branch; spec asserts DOM removal |
| medium-low | Standards | `loadCash`/`loadChains` unguarded landing — A→B→A account (or symbol) switch lets the stale fetch's `set` land last (fatfinger priced on the wrong account's cash; stale expirations on symbol swap) | `cashSeq`/`chainsSeq` tokens guard every landing write — same pattern as `resolveSeq`/`instrumentsSeq`. Spec: held acct-a snapshot resolves after acct-b landed → stale value dropped |
| minor | Thermo | Hydrated `bucketId` absent from `bucketOptions` (inactive bucket or still-loading store) rendered "Unassigned" while the signal retained the id — display/state divergence on a money form | Template renders a disabled "Saved bucket (inactive)" option when the selected id isn't in the list — honest display, value round-trips |
| — | Thermo | `ticketsBySymbol` keyed by raw `ticket.symbol` vs `symbol().toUpperCase()` lookup — a foreign lowercase-symbol ticket would evade the card guard | Latent edge, documented — self-staged tickets are uppercase; normalization belongs upstream of the store grouping |
| — | Thermo | NaN config still fails the fatfinger check closed while `maxPremiumPct` displays 25 | Accepted — fail-closed is deliberate; only the message number is cosmetic in that edge |
| — | Both | Cross-session second-live-ticket concurrent-clients edge | Awareness note only — unreachable in a single session |

Also caught by the specs, not the axes: the store mock's `ticketsBySymbol` wasn't maintained (the real store derives it), which initially masked the adopt-vs-bound path change — mock now mirrors the derivation.

## Round 2 findings & resolutions

Round 2 re-ran all three axes on the remediated code. Every round-1 remediation verified correct (seq guards, stagingLock, post-confirm check, signal discipline). New findings — all in or adjacent to the remediations:

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MAJOR | All three | **Ghost contract resurrection:** the triplet-incomplete clear (round-1 fix) didn't invalidate an in-flight resolution — `resolveSeq` was never bumped, so a late completion re-set `resolvedContract` and staged/re-legged a contract the selects no longer described; `canSubmit` could go true against the ghost | `++resolveSeq` + `resolving.set(false)` in the incomplete branch (the stale frame's `finally` won't clear `resolving` on seq mismatch, so both are needed). Spec: held-promise completion after strike clear → no `resolvedContract`, no stage |
| minor | Thermo + Standards | **Retry dead-end:** `stageError`/`resolveError` causes resolving externally (un-reject, live→terminal, account configured, identical re-paste) never retriggered anything — every block message invited an action that couldn't work without a select wiggle | New effect retries the staging guard when `stageError && resolvedContract` while `tickets()`/`decisions()`/`accountNumber()` change (guard-only, no MCP refetch; gated on blocked so idle store churn costs nothing). Snackbars deduped by message so retries don't re-toast. Identical OCC re-paste calls `resolveAndStage` directly when the parsed triplet equals current selects. Spec: un-reject → auto-stages + `stageError` clears |
| minor | Thermo + Standards | **Bucket-account mismatch + hydration gap:** `ensureAccount` warmed the config account while `bucketOptions` reads the ticket's; and `selectedBucketId` never hydrated from `ticket().bucketId` — an adopted ticket's bucket would be stripped at submit (empty select → `undefined` → key deleted) | Warm effect uses the same `ticket()?.accountNumber ?? accountNumber()` expression the picker reads; adopt path hydrates `selectedBucketId` from `adoptable.bucketId`. Spec: adopt → pick shows the ticket's bucket |
| minor | Standards | Same seq-guard hole in `loadInstruments` — clearing expiration didn't bump `instrumentsSeq`; a late broad fetch could repopulate strikes/errors with none selected | `++instrumentsSeq` + `instrumentsLoading.set(false)` in the empty branch |
| nit | Standards | `maxPremiumPct` renders `NaN%` on a NaN config value (Firestore can persist NaN; `??` doesn't catch it) | `Number.isFinite` guard |
| nit | Standards | `availableCash` not reset on account switch — prior account's cash leaked into the cap (and suppressed the cash-unavailable warning) until the new snapshot landed | `loadCash` clears `availableCash` before fetching |
| — | Thermo | Post-confirm check validates legs+status only — qty/price could theoretically drift under the dialog | Accepted: no current surface writes mid-dialog; `submitOptionOrder` fails closed on invalid fields (worst case a non-retryable ticket error, not a wrong order) |
| — | Thermo | Cash-null conflates "snapshot loading" with "snapshot failed" — transient spurious warning possible | Accepted wart — warning-only, fail-closed direction |
| — | Thermo | Bound path skips the live-status guard — a bound ticket submitted externally leaves later resolutions silently returning it (badge shows true status, `canSubmit` false) | Accepted — honest UI, no correctness hole |
| — | Standards | `updatedAt` ties could destabilize the adopt pick | Nit — identical-ms timestamps only |

## Test results (final)

- Component spec: **43/43** (round 2 added ghost-contract/un-reject-retry/bucket-hydration; round 3 added stale-lock-waiter, stageError-clear-on-deselect, stale-cash-landing; serialization spec re-pinned to the adopt path with `created:true`)
- Adjacent suites: **167/167** — `order-ticket.store.spec` (47), `order-ticket.component` + `order-confirm-dialog` + `order-execution.service` + `gallery-ticket-dialog` (120)
- Full suite: **3726 pass / 43 fail** — identical to the documented pre-existing baseline; same two unrelated suites red at HEAD
- `tsc -p tsconfig.app.json --noEmit`: clean

## Axis summaries

- **Spec:** COMPLETE — all 6 acceptance criteria MET with spec'd evidence; all functional IMPL requirements MET. Deviations: `staged` emits `{ticketId, created}` (superset needed by #964's discard-on-close, not the doc's bare `string`); native selects/pills instead of the doc's `mat-select`/`mat-button-toggle` (matches the equity ticket's actual widgets — doc named the intent). IMPL doc should be updated at ship time to record the `staged` payload shape.
- **Standards:** one major (file size — waived below), minors all remediated except the SCSS duplication item (documented). MCP/util/portfolio contracts verified line-by-line: `getOptionInstruments` broad vs narrow arg shapes, `getOptionQuotes` Map keyed by `instrumentId` reading `lastTradePrice ?? previousClose`, `getSnapshot(account, defaultDollarAmount)`, `buildOccContractId` arg order, all five util signatures. No `updateTicket` caller breakage across the codebase.
- **Thermo-nuclear:** one MAJOR (remediated, below); verified clean: seq guards, `stagingLock` serialization, signal discipline (no computed mutation, all async writes `untracked`), honest union narrowing, deleteField-vs-undefined alignment between store merge and service write, submit-persist ordering.

## Findings & resolutions (round 1)

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MAJOR | Thermo | **Confirm-dialog re-leg race:** `canSubmit` didn't gate on `resolving()`, so a resolution completing between submit-click and confirm could re-leg the stored STAGED ticket under the open dialog — user confirms contract A, `submitTicket` ships contract B | `canSubmit` now requires `!resolving()`; post-confirm `onSubmit` re-reads the ticket and verifies status STAGED + `legs[0].optionId` matches the confirmed snapshot before `submitTicket`, snackbar "re-confirm" otherwise. Two new specs: in-flight resolution disables submit; legs-changed-under-dialog blocks submit |
| MAJOR | Standards | 716-line component vs 400-line "strong smell" guideline | **Waived** — sibling equity ticket is 996 lines (precedent); pure logic already extracted to `option-contract.util`/`option-ticket-staging.util`; the ~240-line resolution+staging block is the obvious future extraction (`OptionTicketStager` injectable) if the file grows. Flagged to user at ship |
| minor | Standards | ~200 lines of near-verbatim SCSS duplicated from the equity ticket (`.cf-input`, `.stepper`, `.pill`, `.form-*`, `.error-section`, etc.) | Documented, not fixed — extracting a shared ticket-form partial is a two-component refactor better done when #964 lands both tabs and the equity ticket's surface is being touched anyway. Tracked as nit debt |
| minor | Standards + Thermo | `?? 25` fatfinger default inlined in component + template while `DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT` exists | `maxPremiumPct` computed wraps the constant; template + snackbar use it |
| minor | Standards + Thermo + Spec | Dead `severity:'block'` warning branch in `onSubmit` — unreachable since `canSubmit` already gates `fatfingerExceeded` | Removed; replaced with a real warning: `availableCash()===null && estimatedPremium()!==null` → "Cash snapshot unavailable — fatfinger cap not evaluated" (fixes the comment/behavior gap the old comment claimed but never did) |
| minor | Standards | Bucket picker scoped to live config account; equity ticket deliberately prefers `ticket().accountNumber` so a config change can't show buckets the fill can't land in | `bucketOptions` uses `ticket()?.accountNumber ?? accountNumber()` |
| minor | Standards + Thermo | `LIVE_TICKET_STATUSES` included PAPER (unreachable — paper tickets are equity-only) | Removed; comment updated to note FILLED stays (a fill means the position is on) |
| minor | Thermo | All-rejected and no-account stage blocks were snackbar-only — the reason a resolved contract can't submit vanished in 4s, same failure class as the live-ticket block | Both now set persistent `stageError` inline alongside the snackbar; spec added |
| minor | Thermo | `cardOptionTickets` `.find(STAGED)` picked arbitrarily among multiple matches | Results sorted `updatedAt` desc — deterministic newest-first adopt |
| minor | Thermo | Adopt path wrote unconditionally — re-resolving the same contract fired a no-op Firestore write | Guarded: skips the `updateTicket` when legs already match and there's no stale error |
| minor | Thermo | Stale `resolvedContract` rendered when the select triplet went incomplete (summary stayed, ticket still submittable-looking) | Resolution effect clears `resolvedContract`/`resolveError` on incomplete triplet; spec added |
| minor | Thermo | `instruments[0]` picks arbitrarily when multiple instruments match the triplet (adjusted contracts post-split) | Documented in code — the MCP payload carries no field to prefer one over another; v1 accepts first |
| minor | Thermo | `qtyDown()` at 0 wrote `'0'` into the quantity input | Writes `''` instead |
| minor | Thermo | Weak spec assertion: `objectContaining({error: undefined})` passes whether the key is present or absent | Asserts `'error' in patch` — proves the adopt patch actually clears the stale error |
| minor | Thermo | `updateTicket` mock spread left `undefined` keys present; real `mergeTicketPartial` deletes them | Mock mirrors `mergeTicketPartial` delete-on-undefined semantics |
| nit | Thermo + Standards | `filters: any` in spec; mock `Partial<OrderTicket>` vs `OrderTicketPatch`; unused `bucketDetail` mock | `OptionInstrumentFilters` throughout; mock signature `OrderTicketPatch`; `bucketDetail` removed |
| nit | Standards | Stale comment + 6 redundant variant casts in `order-ticket.store.spec.ts` (pre-distributive-`OrderTicketPatch` workaround) | Comment corrected; casts removed |
| nit | Standards | `instruments.set([])` written outside `untracked` in the expiration effect | Accepted — the write is synchronous in the effect body like its sibling reads; `untracked` is for the async continuation. Cosmetic |
| nit | Thermo | `OptionTimeInForce` local alias duplicates `EquityTimeInForce`; `OrderTicketPatch` can't stop cross-variant patches; store `mergeTicketPartial` `as unknown` double-casts | Kept — the local alias is deliberately narrower (`'gfd'|'gtc'`, no `'day'`); per-variant patch overloads aren't worth the machinery; store casts are pre-existing |
| — | Both | No host references the component | By design — #964 wires the dialog tab; `staged`'s `{ticketId, created}` payload exists for that consumer |

## Test results

- Component spec: **37/37** (was 31 at review start; +4 new coverage specs, +2 fixes — the mock-fidelity and error-assertion corrections)
- Adjacent suites: **167/167** — `order-ticket.store.spec` (47), `order-ticket.component` + `order-confirm-dialog` + `order-execution.service` + `gallery-ticket-dialog` (120)
- Full suite: **3726 pass / 43 fail** — identical count to the pre-existing baseline documented in the #962 review; same two unrelated failing suites (`shared/screenshot-capture-contracts.spec.ts` stale vs #844 enum additions; `order.component.spec.ts` missing `Functions` provider via `ScreenshotService`). Both fail identically at HEAD
- `tsc -p tsconfig.app.json --noEmit`: clean

## Deferred / notes for downstream tasks

- **#964:** consumes `staged` ({ticketId, created}) for dialog ticket binding + discard-on-close; `findCardTickets` still excludes OPTION for card statusing (the component's `cardOptionTickets` duplicates that matcher minus the side check plus the instrumentType inversion — extracting the shared predicate is #964's call).
- **IMPL doc drift to record at ship:** `staged` payload shape, pill/native controls vs named Mat widgets, live-status set (IMPL listed SUBMITTING/SUBMITTED/PAPER; impl uses SUBMITTING/SUBMITTED/QUEUED/RESTING/FILLED).
- **Store hazard (context, not this diff):** `updateTicket`'s error path restores a wholesale `prev[id]` snapshot — a form-persist write failing after `submitTicket` transitions could clobber SUBMITTED. Worth a store-owner note; the option component inherits the exposure, it doesn't add it.
- **File-size:** waived this round (sibling precedent, utils already extracted). If #964-era growth continues, extract the resolution+staging block into an `OptionTicketStager` injectable.
- **Spec gaps acknowledged, not added:** fractional-strike (`'150.0000'`) filtering belongs to the MCP-parser layer (#960/#961 scope); `instruments[0]` first-match documented; `submitTicket` while `!canSubmit` is unreachable by construction.
