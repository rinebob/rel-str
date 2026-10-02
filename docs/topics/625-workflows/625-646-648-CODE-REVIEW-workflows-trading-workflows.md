**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #646  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #648  
**Domain:** WORKFLOWS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Code Review — #648 Daily Session run-sheet

**Verdict: PASS** (round 2 — all round-1 findings fixed and re-verified)

Scope: `625-646-648-RUNSHEET-workflows-daily-session.md` (single new doc). Three review axes in parallel sub-agents; full jest suite green (155 suites / 2112 tests).

## Standards axis

Header block, filename convention, doc-as-script framing, inventory completeness, forward-reference honesty — all verified clean. Round-1 finding fixed:

- **Minor:** Feeds-graph wording — line 28 claimed signal review feeds position selection + order placement while the triggered table chained SR→PS→OP. Resolved per the corrected chain (below).

## Spec axis

All five task ACs met with evidence; all IMPL §2 contents present; PRD US5/US9 verified. Round-1 finding:

- **Major:** handoff-chain ambiguity between the run-sheet (SR→PS→OP) and PRD mermaid (SR→OP). Resolved by user: the chain IS the target flow but the position-builder surface doesn't exist yet — today signal review feeds order placement directly, and position selection is the planned middle hop once the position-builder lands. Run-sheet now documents both.

## Thermo-nuclear axis

- **Critical→fixed:** the SR→PS→OP vs SR→OP contradiction — resolved with the user's domain ruling; run-sheet now documents today's direct chain and position selection as the planned middle hop.
- **Major→fixed:** "portfolio management" step had no destination — now names `/portfolio-dashboard` as the interim surface.
- **Major→fixed:** invented timeboxes presented as data — all now marked `(est.)`; guidance notes they're pre-doc estimates.
- **Minor→fixed:** "drop from the bottom" deprioritized live order candidates — added the live-candidate override rule.
- **Minor→fixed:** forward filename reference to #649 marked in-flight + inventory convention now requires fixing the link if the doc lands under a different name.
- **Nit→fixed:** trailing two-space break on the Feeds line; placeholder braces removed from parking lot; conventions doc referenced by filename.
- **Nit—accepted:** `Feeds: none` on a launcher doc is a defensible adaptation (field is explicit, not omitted).

## Test results

- `npx jest --coverage=false` — **155 suites / 2112 tests, all pass.**
- Structural spot-checks: header fields, sequence order, triggered triggers, weekly section, 6-row inventory, timebox guidance, parking lot — all confirmed.

## Advisory notes

- Task #649 must declare `Feeds:` = order placement (per the user's ruling — today's direct chain; position selection is the future middle hop once the position-builder surface exists).

## Round 3 (extra pass, user-requested)

All three axes re-ran against the post-fix doc. Result: **clean — PASS stands**, no blocking findings. Four nits fixed in place:

- "yesterday's signals" → "re-running routine triage" (was internally inconsistent — signal review processes today's output).
- Signal-review step gained its interim surface (`/signal-review` route) matching the PM step's precedent.
- Position-selection trigger cell restructured — trigger is a trigger; the future-chain note moved to the Doc column.
- Inventory convention now covers the chain references in the daily sequence (when position-builder lands, signal review's Feeds flips to position selection).

INFO-level leftovers (accepted): heading "live order" leads a Planned step; `/portfolio-dashboard` phrasing slightly over-promises "needs action today"; "Last updated" column `—` for all rows.
