**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1420  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1420  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

## Verdict

**PASS — two rounds.** R1: three axes on the 744-line scoped diff; zero
majors, all converged minors remediated in-gate. R2 (post-remediation
re-review): all axes APPROVE, every R1 fix verified in place, residue
was one minor + nits — remediated or accepted-with-reason below.
Focused suites green; full suite 301/5,261.

## Scope

Uncommitted working-tree diff for #1420 — store `toggleChunkAt`,
`removeChunkFromSelection`, `canAddChunk`/`canRemoveChunk`, empty-default
selection; picker timeline shading (`selected`/`chunkSelected`), mint
cursor band, Add/Remove buttons, aria semantics; specs; IMPL/TEST doc
updates. `option-chart-list.spec.ts` carries unrelated #1430 hunks —
flagged for commit-splitting at ship, excluded from review.

## Findings — all remediated in-gate

| Sev | Axis | Finding | Fix |
|---|---|---|---|
| minor | TN + Spec + Std | `.timeline-tick:hover { background: var(--ds-accent) }` contradicted the diff's own invariant ("accent ONLY = selected") — a hovered unselected tick read as selected, and the click is chunk-granular | hover now `filter: brightness(1.4)` — affordance without the selected signal, theme-agnostic |
| minor | Std + TN | Orphaned docblock: the "empty selection" JSDoc lost its subject (`FIRST_PICKS_DEFAULT` deleted) and attached itself to `ListChunkInfo` | moved to a `//` comment at `applyList`'s `selection:` init |
| minor | Std + TN | Stale comments — scss "outlined band" (band is solid fill); picker header "a click toggles its day" (it's the chunk); store docblock wording | all rewritten to the real contract |
| minor | Spec | Hint "click anywhere to select/clear that chunk" — only the 8px ticks are clickable (band is `pointer-events:none`) | "click a tick to select/clear its chunk" |
| minor | TN | `onTickClick` = `toggleChunk` + `setChunk` = two patchState + two persists — a transient saved blob (new selection, stale cursor) could survive a crash mid-pair | merged into store `toggleChunkAt` — ONE patchState + persist; cursor jump is store-side now, spec-pinned |
| minor | TN + Std | `canAddChunk`/`canRemoveChunk` re-derived `chunks()[clamp(cursor)]` twice — `currentChunk` already exists in block 2 | third `withComputed` block reads `currentChunk` + `selection` directly |
| minor | Spec | AC "Rows checks + readout update to match" — store-level only; no DOM spec asserted the mirror | new picker spec: tick click → Rows tab → 10 checked + "10 rows selected" readout |
| nit | TN | `border: none` on a div — dead CSS | removed |

## Round 2 — residue and disposition

R2 verified every R1 fix landed; new residue across axes:

| Sev | Axis | Finding | Disposition |
|---|---|---|---|
| minor | Std | `setChunk(i)` dead in production — only spec call-sites (was the pre-#1420 tick-jump primitive) | **Accepted-with-reason**: symmetric nav primitive with `step`, 9 spec setups exercise it; deleting forces spec-rewrite churn for zero product value. Revisit if still dead after #1402 |
| minor | TN | IMPL Methods bullet phantom `sendChunk()` (removed in #1419) + missing new API | **Fixed** — bullet now lists `toggleChunkAt`/`removeChunkFromSelection`/`sendAll`, corrects return type to `string[]` |
| nit | Spec | Dead `selection` destructure in second `withComputed` | **Fixed** |
| nit | TN | `toggleChunkAt` missing `Number.isFinite` (unreachable — NaN→undefined→early return) | **Fixed** for guard-style consistency |
| nit | Std | Spec-header docblock omitted #1420 | **Fixed** |
| nit | Std | Chunk-fill predicate (`every`/`some sel.has`) at 4 sites | Accepted — one-liner; a per-chunk computed array is more machinery than warranted |
| nit | Std | `aria-pressed` + alternating Select/Deselect `aria-label` double-announces state | Accepted — label conveys chunk identity+action; pressed conveys state; screen-reader verbosity, not ambiguity |

R2 note: `option-chart-list.spec.ts` contains a legitimate #1420 hunk
(`listStore.selectAll()` — empty-default fallout repair) interleaved
with foreign #1430 hunks — the commit-split must keep that hunk with
#1420.

## Accepted, not fixed (documented)

- **Hardcoded `#00ff9d` band** — all three axes flagged the literal vs
  `ds-accents.ts:10`. Resolution: keep the literal, comment pins the
  canonical source; a `--ds-mint` token for one consumer is speculative
  generality. Mint-under-mint-accent collision documented in IMPL.
- **`.in-chunk` class has no style rule** — survives as the semantic
  chunk-membership marker the specs select on; flagged, kept.
- **Store file ~490 lines** vs the 400-line guideline — pre-existing
  smell, worsened ~35 lines; splitting is a bigger refactor, out of scope.
- **`aria-pressed` reports chunk-full, not day state** — deliberate: the
  click toggles the chunk, so pressed describes the toggle's target.
- **Spec coverage for timeline-toggle persistence** — `setSelection`'s
  persist is already covered by the symbol-swap restore suite.
- **#1430 hunks inside `option-chart-list.spec.ts`** — benign stale-spec
  repair from a concurrent session; must be excluded at commit-split.

## UAT decisions folded into this implementation (spec deltas)

The issue left granularity open ("the containing day/chunk"). UAT
decided: **chunk-granular** toggle, empty-default selection, mint band,
and a Remove-chunk button — all user-directed mid-session. Spec axis
classified these as sanctioned deltas, not creep.

**Next:** `/proj qa 1243 1420` — QA issue #1438.
