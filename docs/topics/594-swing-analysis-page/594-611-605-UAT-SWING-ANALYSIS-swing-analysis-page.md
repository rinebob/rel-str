**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #611  
**Task:** #605  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# UAT — #605 st-swing-configs config library

## Scope

The `st-swing-configs` persistence seam: types, service CRUD, and security
rules for the global swing-config library. No UI yet — the settings dialog
consumes this in task #607; end-to-end UI verification happens there.

## Prerequisites

- Repo at working tree containing task #605 changes.
- `gcloud auth application-default login` completed (for the prod round-trip script).
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (repo env convention).

## Scenarios

### 1. Unit specs — service contract

- `npx jest swing-analysis.service.spec --coverage=false`
- Expected: all specs pass, including the `config library (st-swing-configs)` block —
  path shape, slim payload (no symbol/pivots/swings/stats), idempotent paramsId doc,
  name omitted when absent/whitespace, auth gating, error propagation, segment counts,
  `deriveParamsId` format pin + `showTriggerDots` differentiation + `lineColor` dedupe.
- **Result: PASS** — 46/46 (2026-09-26).

### 2. Prod round-trip — real Firestore

- `NODE_PATH=functions/node_modules npx tsx scripts/verify/swing-analysis-misc-fixes-605-config-library.ts`
- Expected: `write: ok`, `read-back + slim shape: ok`, `idempotent overwrite: ok`,
  `userId-scoped list: ok`, `delete + cleanup: ok`, `ALL CHECKS PASSED`.
- **Result: PASS** — ran against prod 2026-09-26; all five checks green, doc self-cleaned.

### 3. Security rules — structural check

- Inspect `firestore.rules` `match /st-swing-configs/{docId}` — owner-scoped
  read/create/update/delete, `userId` pinned on update, no `resource == null`
  escape (list queries must constrain `userId`, matching `loadConfigs`' where clause).
- **Result: PASS** — reviewed against the `st-swing-sets` block it mirrors;
  deploys with the normal rules deploy on commit.

### 4. (Deferred to #607) Dialog-driven round-trip

- Once the settings dialog lands: save a config from the UI, reload, confirm it
  appears in the Saved group; delete it, confirm removal. Verified in that task's UAT.

## Refinement pass

Not applicable — no user-facing surface in this task.

## Traceability

| AC | Scenario |
|----|----------|
| SwingConfigInput/Doc types keyed by paramsId | 1 |
| loadConfigs / saveConfig / deleteConfig | 1, 2 |
| firestore.rules owner-scoped block | 3 |
| No symbol/pivots/swings/stats written | 1, 2 |
| Specs pin the doc shape | 1 |

## Findings

- None for this task. Pre-existing flake in `swing-analysis-page.component.spec.ts`
  ("navigating onto a failed symbol", user's symbol-nav WIP) is unrelated —
  re-verify full suite before `/proj ship`.
