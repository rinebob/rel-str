**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Issue:** #1643  
**Task:** #1636  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# UAT — BE-IMPL: getLifecycleTopicTree callable (#1636)

## Scope

`getLifecycleTopicTree(owner, repo, topicNumber)` — per-topic subtree
callable for lazy loading: root probe → `isTopicRoot` guard → shared
`walkSubtree` BFS → shared `assembleTreeResponse`. One fully-populated
`LifecycleTreeResponse`.

## Prerequisites

- `GITHUB_READ_TOKEN` env var, or `gh auth token` (read-only).
- Repo `rinebob/rel-str`; configured project #1.
- IPv4 preload required on this network:
  `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`

## Getting to the feature

No user-facing surface — the callable is exercised through its handler
at the verification seam:

```bash
npx tsx scripts/verify/dev-tools-gh-lifecycle-1636-topic-tree.ts [topicNumber]
```

## Automated evidence (executed 2026-11-20)

| Check | Result |
|---|---|
| `npm run test:gh-lifecycle` | 101/101 pass |
| `npm run build` (functions) | esbuild clean |
| Full jest suite | 6,126/6,126 pass |
| Live verify (#1636 script) | ALL CHECKS PASSED — 4.1s, #619 = 61 descendants |
| Live guard paths | non-Topic → invalid-argument; unknown → not-found; `topicNumber: 0` → invalid-argument; unsupported repo → invalid-argument; unauth → unauthenticated |

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| S1 | Valid `Topic:` root → exactly one fully-populated topic | live: `#619` — 61 descendants, `children` non-empty, metadata/labels/Status intact | PASS |
| S2 | Single-root scoping — no other topic walked | spec `walks only the requested root subtree` (multi-root fixture asserts no search, no probe/subpage of root 2) + live: `topics.length === 1` | PASS |
| S3 | `topicNumber` is a non-`Topic:` issue → `invalid-argument` | live: `#697` (a Thread) rejected; spec-pinned | PASS |
| S4 | Unknown `topicNumber` → `not-found` | live: `#999999` (GitHub NOT_FOUND error → null → not-found); spec-pinned | PASS |
| S5 | Malformed `topicNumber` → `invalid-argument` | spec parametrized (absent/string/float/0/negative/NaN/over-Int32) + live `0` | PASS |
| S6 | Truncation propagates → `internal` | spec `subtree truncation propagates` + handler `truncatedNodes > 0 → internal` | PASS |
| S7 | `statusOf`/`childrenOf` parity with monolith | spec asserts subtree-restricted maps incl. Status decode (non-vacuous) | PASS |
| S8 | Callable registered + monolith retained | `index.ts:190` exports all three; live `getLifecycleTree` untouched (its suite green) | PASS |
| S9 | Grouping/`groupOrder`/`fetchedAt` parity | live: group stamped, groupOrder carries all inventory sections, stale-doc warning sanitized | PASS |

## Manual UI/UX refinement pass

**N/A** — backend-only callable; no user-facing surface exists at this
stage (FE consumption is #1637/#1638's scope).

## Findings

None. Live verification surfaced one defect during implementation —
GitHub answers unknown issue numbers with a `NOT_FOUND` GraphQL error
(not `issue: null`), which leaked `internal` — fixed in-cycle via
`GitHubApiError.gqlType` collapse to `null` → `not-found`, spec-pinned
and re-verified live.

## Traceability

| Acceptance criterion (#1636) | Scenario(s) |
|---|---|
| non-`Topic:` → `invalid-argument`; unknown → `not-found` | S3, S4, S5 |
| single-root scoping (multi-root fixture) | S2 |
| BFS/truncation parity (shared walkSubtree) | S6 (+ shared-code construction) |
| `statusOf`/`childrenOf` subtree parity | S7 |
| registered in `index.ts`; monolith retained | S8 |
| gh-lifecycle specs + build green | Automated evidence table |

## Regression / smoke

- The monolith `getLifecycleTree` spec battery (all pre-existing
  `fetchLifecycleData` specs) runs against the same extracted
  `walkSubtree` — green proves refactor parity.
- `getLifecycleTopicIndex` (shipped #1635) specs green post-split.
- Deploy-side check deferred to ship: `firebase deploy --only
  functions` rides with `/proj ship`; the verify script is re-runnable
  post-deploy for deployed-surface confirmation.

## Verdict

**PASS** — all six acceptance criteria evidenced; no open findings.

## Results log

| Date | Method | Result | Evidence |
|---|---|---|---|
| 2026-11-20 | automated | PASS | 101/101 specs, 6,126/6,126 jest, build clean |
| 2026-11-20 | live verify | PASS | script re-run post-remediation: 4.1s, 61 descendants, 16/16 checks |
