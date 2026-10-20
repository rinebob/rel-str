**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1150  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1011  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1011 NEW-list additive backfill

## Scope

IMPL Phase 7.2 + task ACs:

- [ ] Zero-membership tracked symbols are added to `{uid}_NEW`.
- [ ] Existing list memberships are never removed.
- [ ] Existing list memberships are never modified.
- [ ] TEST gate: "NEW backfill: additive-only — existing memberships
      untouched."

Change set: `functions/src/common/st-new-list-sweep.ts` (testable core —
census, key resolution, target resolution, additive payload),
`functions/scripts/sweep-unlisted-to-new.ts` (one-shot, dry-run default,
`--apply`/`--uid`), `functions/scripts/verify/data-pipeline-new-list-1011.ts`
(read-only prod audit, verify #38),
`tests/functions/new-list-sweep-1011.test.ts` (25 specs), registrations.

**Design note for the tester:** the sweep is strictly additive — the only
write shape is `set(merge:true)` with `symbols: arrayUnion(...)`. It
reads BOTH roots (legacy `savant-trader/data/*` + canonical `st-*`) for
the universe and for list membership. Per-leg doc state decides whether
meta/`createdAt` mint — a leg whose doc already exists is never
meta-overwritten, except a half-migrated leg (missing stamped `key` or
`role`) which gets the full NEW meta restored (a `key`-without-`role`
doc would un-triage its members in the FE). Target resolution refuses to
guess: multiple NEW docs or ambiguous ownership → error, pass `--uid`.

## Prerequisites

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
# ADC with prod Firestore access (same as other verify scripts):
#   gcloud auth application-default login
cd functions
```

## Scenarios

### S1 — Test suite + typecheck

- `npm run test:new-list-sweep` → **25/25** pass (7 suites).
- `npx tsc --noEmit` (in `functions/`) → clean.
- `npx tsc --noEmit -p tests/tsconfig.json` (repo root) → 0 errors in
  `new-list-sweep-1011.test.ts` (pre-existing suite errors elsewhere are
  unrelated — see review doc).

### S2 — Sweep dry-run (read-only)

- `npx tsx scripts/sweep-unlisted-to-new.ts` (no `--apply`) → prints
  `DRY-RUN` banner, universe/list-docs/unlisted census, then
  `Dry-run only — rerun with --apply to write.` Writes nothing.
- Expected on prod today: `Universe: 926`, `List docs: 14`,
  `Unlisted → NEW: 0`.

### S3 — Flag validation (negative)

- `npx tsx scripts/sweep-unlisted-to-new.ts --uid` (no value) →
  usage error, exit 1.
- `npx tsx scripts/sweep-unlisted-to-new.ts --uid --apply` → same —
  a flag isn't a uid value.
- `npx tsx scripts/sweep-unlisted-to-new.ts --uid "" --apply` → same —
  empty/whitespace uids rejected (would stamp an invisible `userId`).

### S4 — `--apply` with nothing unlisted (no-op path)

- `npx tsx scripts/sweep-unlisted-to-new.ts --apply` on the current
  clean prod state → `Unlisted → NEW: 0` then `Nothing to write.` —
  returns before any batch is built. Verifies the empty-apply path is
  inert. (If unlisted > 0 this would write — do NOT run `--apply` when
  the dry-run shows a nonzero count unless a backfill is intended.)

### S5 — Prod audit (read-only)

- `npx tsx scripts/verify/data-pipeline-new-list-1011.ts` →
  `0 FAIL / 0 WARN`. Confirms: core carries the additive contract, the
  script consumes it, every tracked symbol filed, no symbol in two
  exclusive docs, the NEW doc present in BOTH legs with matching
  membership (472 each today), list roots at doc-id parity.
- The audit exits 1 on any FAIL; WARNs are informational drift (e.g.
  unlisted>0 would print the actionable `--apply` command).

### S6 — Additive-only contract (spec-level)

- The 25-spec suite pins: `arrayUnion` is the only member write; on a
  fully-stamped existing doc no meta/`createdAt` is emitted; meta is
  all-or-nothing (key+role together); `userId` omitted rather than
  written `undefined`. There is no `arrayRemove`/delete path in the
  module — verified by inspection.

### S7 — Regression smoke

- `npm run test:config-lists` → 20/20 (adjacent #1008 list surfaces
  untouched — the sweep module is new; the script's rewiring is the only
  shared-surface change).

## Traceability

| AC | Scenario |
|---|---|
| Zero-membership tracked symbols → `{uid}_NEW` | S1, S2, S5 (prod already at 0 — mechanism pinned by specs: `computeUnlisted`, `resolveNewListTarget`, dual-leg batch) |
| Memberships never removed | S1, S6 — `arrayUnion`-only write shape |
| Memberships never modified | S1, S6 — existing-doc payload is union+`updatedAt` only |
| TEST: additive-only | S1, S6 |

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 | PASS | `test:new-list-sweep` 25/25; `tsc --noEmit` clean; 0 errors for the spec file under `typecheck:tests` |
| S2 | PASS | `Universe: 926` · `List docs: 14` · `Unlisted → NEW: 0` · dry-run notice; nothing written |
| S3 | PASS | `--uid` bare / `--uid --apply` / `--uid ""` → `usage: --uid <uid> requires a non-empty uid value`, exit 1 each |
| S4 | PASS | `--apply` → `Unlisted → NEW: 0`, `Nothing to write.`, exit 0 — returns before the batch is built |
| S5 | PASS | `0 FAIL / 0 WARN` — 926/926 filed, no dual exclusive membership, NEW doc present in both legs (472 members each), doc-id parity |
| S6 | PASS | Specs pin union-only writes; module has no `arrayRemove`/delete path |
| S7 | PASS | `test:config-lists` 20/20 |

Refinement pass: **Not applicable — no user-facing surface** (backend
one-shot script + shared module + read-only audit).
