**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1380  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1368  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# UAT — #1368 analysis-results collection + rules + indexes

## Scope

The `st-options-analysis-results` Firestore root: canonical collection
constant + doc-key builder (`shared/st-collections.ts`), security rules
(`firestore.rules`), composite indexes (`firestore.indexes.json`), and the
verify script suite. Declarations only — no UI, no runtime service, no
emulator. Every check is a command.

## Prerequisites

- Repo root: `C:\aa\projects\rel-str`, dependencies installed.
- No credentials, no emulator, no env vars.

## Test scenarios

### 1. Collection constant + doc-key builder specs

**Steps:** `npx jest shared/st-collections.spec.ts --coverage=false`
**Expected:** suite passes; covers `ST_OPTIONS_ANALYSIS_RESULTS_ROOT` value,
`FLAT_ROOTS` membership, `stOptionsAnalysisResultDocId` exact output
(`{contractListDocId}_{exitId}`), single-path-segment validity, and symbol
uppercasing through the contract-list/analysis-result doc-key pair.
**Result:** PASS — `Tests: 27 passed`.

### 2. Rules + indexes declarations (content-level)

**Steps:** `cd functions && npm run test:st-rules-indexes`
**Expected:** all assertions pass — analysis-results root in the expected
canonical-roots coverage list, anchored read-only regex (authed read /
`allow write: if false;` / closing brace), both composites
(`contractListDocId+exitId`, `runId+exitId`), default-deny wildcard last,
and exactly-one-match-block-per-read-only-root (round-2 uniqueness guard).
**Result:** PASS — `pass 15 / fail 0`.

### 3. Verify script (alias resolution + doc-key composition)

**Steps:** `npx tsx scripts/verify/options-backtest-analytics-1368-results-collection.ts`
**Expected:** all checks pass — `ST_OPTIONS_ANALYSIS_RESULTS_ROOT` and the
builder resolve through the `@st/collections` alias under tsx, and every
provisional `EXIT_STRATEGIES` seed composes a valid 2-segment doc path.
**Result:** PASS — 11 checks, `All checks passed.`, exit 0.

### 4. Index JSON is well-formed and both composites present

**Steps:** `node -e "const j=require('./firestore.indexes.json');
const m=j.indexes.filter(i=>i.collectionGroup==='st-options-analysis-results');
console.log(m.map(i=>i.fields.map(f=>f.fieldPath)))"`
**Expected:** parses; prints `[['contractListDocId','exitId'],['runId','exitId']]`.
**Result:** PASS — both composites, COLLECTION scope.

### 5. Negative rules check — no second match block can sneak a write grant

**Steps:** covered by scenario 2's uniqueness assertion — each read-only
root pinned to exactly one `match /{root}/` block; plus each anchored regex
requires `allow write: if false;` immediately before `}`.
**Expected:** a future appended `allow create` leg or duplicate match block
fails the suite.
**Result:** PASS — both guards in place and green.

## Results log

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | st-collections spec | PASS | 27/27 |
| 2 | rules-indexes test | PASS | 15/15 incl. uniqueness guard |
| 3 | verify script | PASS | 11 checks, exit 0 |
| 4 | index JSON parse | PASS | both composites, COLLECTION scope |
| 5 | negative rules guard | PASS | anchored regex + uniqueness pin |

Full-suite context (review gate, 2026-11-02): 287 suites / 4,963 tests;
one load-induced timeout flake in
`option-order-ticket.component.spec.ts` (74/74 in isolation, untouched by
this task).

## Manual UI/UX refinement pass

**N/A** — no user-facing surface (Firestore declarations + shared constant
only).

## Findings / carried forward

- Rules and indexes are **declarations** — live enforcement requires
  `firebase deploy --only firestore:rules,firestore:indexes` (deploy
  decision, not part of this task).
- `scripts/verify/run-all.ts` carries an unrelated #1158 hunk next to the
  #1368 entry — hunk-level staging required at ship.
- Forward note for #1372 (analyzer worker): merge-write terminal success
  must clear the optional `error` field (`FieldValue.delete()` or full
  `set`) — annotated in IMPL-BE.
