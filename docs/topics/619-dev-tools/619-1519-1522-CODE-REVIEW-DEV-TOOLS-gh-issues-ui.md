**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1519  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1522  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# Code Review — SHARED: Lifecycle contract v2 / flat response + group assignment (#1522)

## Round 2 (final-state re-review)

All three axes re-ran against the remediated state: **0 critical ·
0 major · 1 minor · ~5 nit** — **converged**. Every round-1 fix verified
correct in place (dedupe ordering semantics, warning-path interactions,
verify gating, spec assertions all independently re-checked).

| Finding | Disposition |
|---|---|
| Dedupe spec never exercised the `!includes` append guard — every fixture topic was claimed, so deleting the guard stayed green | Fixed — added a genuinely unlisted root (`t(5)`); the spec now fails without the guard |
| Zero-match warning used stamped-name equality — a doc section literally named `Ungrouped` covering all topics would false-warn "stale" | Fixed — precise `groups.some(g => g.topicNumbers.includes(t.number))` listed-check |
| PRD:283 claimed "absent/degraded doc → `groupingWarning`" — contradicted shipped 404-silent semantics | Fixed — rewritten to match code (absent → flat, no warning; degraded → warning) |
| TEST-BE:27 "`groupingWarning` paths unchanged" — stale after the new drift path | Fixed — "extended — stale-doc case" |
| Contract comment didn't enumerate the stale-doc case | Fixed — comment widened |
| Store-spec fixture string implied a 404-triggered warning (never emitted) | Fixed — realistic `grouping unavailable: GitHub 500` |

**Deliberately not changed** (per scope discipline — contrived inputs only):
case-variant sentinel (`ungrouped` ≠ `Ungrouped` — distinct names, no
collision), verify scripts not asserting `groupOrder` uniqueness (covered
by the tree spec + Angular dev-throw), doc-authored `### Ungrouped`
rendering at doc position rather than last.

## Verdict: PASS

## Round 1

Three-axis review (standards / spec / thermo-nuclear) against the working
tree: flat `LifecycleTreeResponse` v2, `assignGroups` replacing
`orderTopics`, `isTopicRoot`, plus the required consumer migration
(callable emit, topic-viewer store, 6 specs, 3 verify scripts).

Result: **0 critical · 1 major · 5 minor · ~8 nit** — all consequential
findings remediated in place and re-verified (81/81 focused tests, tsc
clean on app + spec + functions).

## Major

| Finding | Disposition |
|---|---|
| Duplicate group names in `groupOrder` → two identically-named sections → duplicate `@for track sec.name` keys (Angular dev-throw / prod mis-render). Reachable via two same-named `### ` headings, or a doc section literally named `Ungrouped` while ungrouped roots exist | Fixed — `assignGroups` dedupes doc names (`new Set`) and guards the `UNGROUPED_SECTION` append; spec added (`lifecycle-tree.spec.ts`) |

## Minor

| Finding | Disposition |
|---|---|
| `640` verify: "every stamped group appears in groupOrder" false-FAILed on the designed degrade path (doc 404 → all Ungrouped + empty `groupOrder`) — checked *before* the script's own "doc 404 is legitimate" info line | Fixed — gated on `groupOrder.length > 0`; same latent cascade fixed in `637` |
| Doc parses but lists none of the fetched roots → silent all-Ungrouped with **no** `groupingWarning` — the drift signal the field exists for was lost in the worst drift case | Fixed — callable detects zero-match after `assignGroups` and warns (`doc may be stale`); test added |
| `let groups = null` — evolving-any; explicit contract typing is house style | Fixed — `LifecycleInventoryGroup[] \| null` |
| Store spec left two new behaviors untested: `updatedAt`-desc intra-group sort (all fixtures shared one timestamp) and the empty-`groupOrder` fallback branch | Fixed — two specs added (`topic-viewer.store.spec.ts`) |
| IMPL §2 / TEST doc said "`groupOrder` in doc order" with no mention of the appended Ungrouped sentinel or dedupe | Fixed — docs ratify both |

## Nits

| Finding | Disposition |
|---|---|
| Page-spec `node()` factory stamped `group` on children (contract: children never carry `group`); stray trailing comma | Fixed — `node()` returns `LifecycleNode`; `topic()` wrapper adds `group` |
| `shared/lifecycle-*.ts` headers still said "dev-lifecycle page" / "order topics into inventory sections" | Fixed — topic-viewer, group stamping |
| `const expanded` misaligned (4-space in a 2-space body) | Fixed |
| `resp(sections: …)` fixture param kept v1 vocabulary | Fixed — `groups` |
| `selectedTopicNumber()` re-read per element in the stale-selection check | Fixed — hoisted |

## Deliberately accepted (not defects)

- **Deploy-window stale-client break** — an open v1 page reading
  `response.sections` during the FE/BE deploy window gets `undefined`.
  Single internal consumer, ~1 user, self-heals on refresh; IMPL already
  accepts "internal API, no versioning." Noted on the issue.
- **`truncatedNodes` removed from the response** — the field was dead
  payload (the `>0` throw precedes emit); retained on the internal fetch
  result + verify scripts. Sanctioned by IMPL §1.
- **Intra-group ordering** — v2 initially sorted `updatedAt` desc per
  the IMPL-FE plan; QA corrected it to **issue-number ascending** (v1's
  doc order was effectively numeric; user preference). The flat contract
  delegates ordering to the consumer.
- **`callables.test.ts` / `640` carried-over casts** — pre-existing test
  style, not introduced by this change.
- **Sequential `fetchData` → `fetchInventoryDoc` awaits** — one extra
  roundtrip on a 120s callable; left as readability-over-latency.
- **Store safety-net branch called "dead code"** by one axis — incorrect;
  it is the branch that renders `Ungrouped` when `groupOrder` is empty on
  the 404 path. Load-bearing, kept, now spec-covered.

## Verified

- Focused: 81/81 (lifecycle-tree, lifecycle-contracts, callables,
  topic-viewer ×3)
- tsc clean: `tsconfig.app.json`, `tsconfig.spec.json` (own files; the
  only spec errors are the other session's `options-replay-templates`),
  `functions/tsconfig.json`
- Live verifies (post-migration, pre-remediation): `637` offline,
  `639` fetch, `640` callable — all pass; re-run of `637`+`640` pending
  at ship alongside the full suite.
