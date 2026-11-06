# Code Review — Task #1433: BUG: Allocation watch streams latch permission-denied; dead stream never re-attaches

**Topic:** #576 Portfolio Allocation  
**Task:** #1433 — BUG: Allocation watch streams latch permission-denied; dead stream never re-attaches  
**Reviewer:** Devin + three-axis review (Standards / Spec / Thermo-nuclear sub-agents)  
**Date:** 2026-10-07  
**Verdict:** PASS — one major masking defect found on all three axes and remediated during review; verified green afterward.

## Scope reviewed

- `allocation.store.ts` — watch-stream error recovery (rewritten during
  review: manual timers/counters → `retry({count, delay, resetOnSuccess})` +
  parameterized `wireStream`; shared `streamError` flag → per-stream slice
  error slots; new `selectedError` computed)
- `allocation.types.ts` — `bucketsError` / `attributionsError` fields on
  `AccountAllocation`
- `allocation-page.component.ts` — banner reads `selectedError()`
- `allocation.store.spec.ts` — `defer`-based stream mocks + subscribe-count
  maps; 7 recovery tests (5 original + 2 added for the ordering/sibling holes)
- Spec fixtures updated for the two new slice fields:
  `allocation-page.component.spec.ts`, `allocation-positions-table.component.spec.ts`,
  `allocation-bucket-detail-dialog.component.spec.ts`,
  `order-ticket.component.spec.ts`, `option-order-ticket.component.spec.ts`

## Standards axis

- **No hard violations.** No `any`/assertion abuse (the two
  `as Partial<AccountAllocation>` casts exist only because TS can't verify
  computed keys; the key set is literal-derived), fake-timer usage matches
  AGENTS.md conventions (`advanceTimersByTime`, no setTimeout-flush),
  `afterEach` restores real timers, mock contract faithful — `defer` yields
  a fresh Subject per subscribe like a real per-subscribe Firestore listener.
- **[major → remediated] `streamError` boolean = wrong model.** One shared
  flag guarded a field with three writers (buckets error, attrs error,
  `loadAccount` catch). Two holes: (a) stream-latched flag survives an MCP
  error overwrite — a later emission clears the *MCP* error; (b) a healthy
  stream's emission clears its dead sibling's latched error. Replaced with
  per-stream slice fields (`bucketsError`/`attributionsError`) — single
  writer per field, masking impossible by construction.
- **[minor → remediated] Duplicated subscribe blocks.** The buckets/attrs
  subscribe bodies were near-identical (~12 duplicated lines) plus three
  `kind === 'buckets'` ternaries in `scheduleReattach`. Parameterized into
  one `wireStream` helper.
- **[minor → remediated] Ghost-timer bug.** `scheduleReattach` overwrote
  `subs[timerKey]` without `clearTimeout` — a manual attach between error
  and fire left an unbudgeted timer. Gone with the `retry` rewrite.
- **[accepted] File size.** Store is ~500 lines vs the ~400 guideline —
  post-remediation the diff nets *fewer* lines than the pre-review
  implementation; `unassignedStats` extraction is a separate concern.

## Spec axis — issue requirements

| Requirement (issue #1433) | Result |
|---|---|
| `next` handlers clear the latched error on recovery | PASS — per-stream slots; each emission clears only its own |
| Dead stream auto re-attaches after bounded backoff | PASS — `retry({count: 3, delay: timer(5s/15s/45s)})` resubscribes the cold `collectionSnapshots` source = fresh listener |
| Recovery needs no manual action | PASS — tested via fake timers + subscribe counts |
| Bounded — permanently failing stream stops | PASS — terminal error propagates, sub marked dead, error stays latched until select/refresh re-attaches |
| Both tabs consistent (shared `selectedAllocation().error`) | PASS — now `selectedError()` = `error ?? bucketsError ?? attributionsError`; MCP error takes display precedence |
| Spec's literal "clear error in next" refinement | Faithful — scoped to stream-owned errors; strictly better than literal clearing (an MCP load failure can't be masked) |

**Behavioral nuance noted for QA:** during retry backoff the sub is *alive*
(retry owns it), so `selectAccount`/`refresh` no longer force an instant
re-attach — the scheduled retry (≤5s for the first) handles it. Instant
manual re-attach still applies once the stream is terminally dead.

## Thermo-nuclear axis

- **[major → remediated]** the `streamError` masking holes above — thermo
  recommended two single-writer fields; implemented per-stream.
- **[major → remediated] code-judo applied.** `retry({count, delay,
  resetOnSuccess})` (rxjs 7.8.2, `resetOnSuccess` verified in installed
  typings) deleted `bucketRetries`/`attrRetries`, both timer fields,
  `scheduleReattach`, and the `onDestroy` cleanup loop — ~40 lines of manual
  machinery → 10 lines of operator config. `resetOnSuccess` reproduces the
  tested "healthy emission resets budget" semantics exactly.
- **[minor → remediated]** duplicated subscribe blocks (parameterized) and
  the stale-timer overwrite (deleted with the apparatus).
- **[accepted]** `??=` + synchronous-error trap (a sync terminal error would
  assign a closed sub and block re-attach): unreachable with `retry` — a
  terminal error requires async timer completions by construction.

## Test results

- **Store spec:** 29/29 green — 7 recovery tests covering auto re-attach,
  error-clear on recovery, bounded retries, budget reset, MCP-error
  preservation (both orderings), and per-stream masking.
- **Touched areas:** `portfolio-dashboard` + `order-ticket` +
  `option-order-ticket` specs — 35 suites, 708/708 pass.
- **tsc:** clean on all task files. Pre-existing errors on HEAD in
  unrelated files (`scripts/bulk-swing-sweep.ts`,
  `portfolio-dashboard.store.spec.ts`) — not this task's scope.
- **Full suite:** `npx jest` — 301/301 suites, 5254/5254 tests green.

## Findings for QA

- [ ] Visit `/portfolio/allocation` (nav: Portfolio → allocation page);
  confirm normal render on both tabs
- [ ] If/when the intermittent permission blip recurs: banner should clear
  itself within ~5s (first retry) — no refresh needed
- [ ] Behavioral nuance: during backoff a manual refresh waits for the
  scheduled retry (≤5s) rather than instantly re-attaching — confirm
  acceptable
- [ ] Full suite green before ship

## Verdict

**PASS.** The issue's requirements are met; the major masking defect all
three axes flagged was remediated during review (per-stream error slots +
`retry` operator) and is locked in by two new regression tests. Advance
to `7_QA`.

## Pass 2 — delta re-review (2026-10-07)

Re-ran all three axes against the post-remediation diff (user: "until no
new findings, don't go crazy"):

- **Standards:** all round-1 remediations verified clean; `retry` usage
  confirmed against installed rxjs source (`count` excludes source → 4
  subscribe attempts; `delay` counter is 1-based → `DELAYS[i-1]` correct;
  `resetOnSuccess` resets per `next`). One low finding: pre-existing
  file-size smell (~490 lines vs 400 guideline) — accepted, the diff nets
  fewer lines than the pre-review version.
- **Spec:** MET — all spec requirements verified; manual re-attach after
  terminal death confirmed; no missed-error consumer paths (only
  `selectedError` reads the error slots; other slice consumers read
  `.buckets` only).
- **Thermo-nuclear:** meets the approval bar — `wireStream<K>` is the
  right judo, per-stream slots cleaner than any flag alternative, no
  structural regression.

**Minor polish applied during pass 2:**

- `patchStreamError` rewritten as a ternary on `kind` — the
  `${kind}Error` interpolated-key cast gone (compiler now checks the real
  field names).
- `delay: (err, i)` → `(err, retryCount)` — self-documents the 1-based index.
- The two `defer` mock factories deduped into a generic `streamMock`.
- `attachStreams` comment notes the pending-retry posture during backoff.

**Accepted, not fixed (scope discipline):**

- `subscriptions` map never cleared on destroy — it dies with the store
  closure; a `clear()` would be dead code.
- `portfolio-gallery.facade.ts` subscribes the same streams with no retry
  — same death mode but no banner requirement; flagged for the future
  (extract `withStreamRecovery` if a third consumer appears).
- `selectedError` in its own `withComputed` block — required to reference
  the sibling `selectedAllocation` computed; folding is not possible.

29/29 store specs green post-pass-2. **No further pass warranted** —
remaining findings are nits/pre-existing smells.
