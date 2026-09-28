**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #609  
**Blueprint:** #604  
**Task:** #609  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — #609 Config-manager redesign (presets vs. sets, narrow rows, on/off, batch removal)

## Verdict: PASS (3 axes × 2 rounds — round 2 verified all fixes; residual nits only)

Scope note: the working tree also carries the user's uncommitted
symbol-nav/company-info WIP in the page component/spec — excluded from
this review; ship staging must graft only the #609 slice again, same as
#607/#608.

## Spec check (ACs — as amended 2026-09-27b)

| AC | Status | Evidence |
|----|--------|----------|
| Active list = narrow inline rows (dev/L/R, swatch, 1bar/trig, Save/Clone/×); no `<details>` | ✔ | `.active-row` template; spec asserts zero `details` elements |
| Per-row on/off checkbox — runtime-only `configEnabled`, never persisted; disabled slots compute nothing + dim | ✔ | `configEnabled[]` state + `toggleActiveConfig`; `recomputeAll`/`updateConfig`/`cloneConfig`/`cloneAll` all honor the flag; `chartConfig` filters indicators; `.disabled` opacity style |
| No Large/Small nomenclature | ✔ | `CONFIG_LABELS` deleted; spec asserts no `Large`/`Small` text in the dialog |
| Presets = 4 canned `SWING_PRESETS` (sweep set, desc devThreshold) + user singles; `+`/`✎`/`×` | ✔ | `SWING_PRESETS` store const; `savedPresets` computed; per-row activate/rename/delete |
| Saved sets = `configs[]` docs keyed `set_<joined pids>`; `+` replaces configs[] | ✔ | `deriveSetParamsId`, `isConfigSet`/`docConfigs`, `applyConfigSet` replace+recompute |
| Active header: `[Save set] [Clone all] [Clear]` | ✔ | `.header-actions` inside the Active `<h3>`; spec covers all three |
| Per-row Save = preset; header Save set = whole list | ✔ | `saveActiveConfig` (plain paramsId) vs `saveActiveSet` (`set_` id) |
| Batch sweep removed | ✔ | `batch-sweep.component.ts` + `swing-batch.ts` deleted; `runBatch`/`cancelBatch` + state + specs gone; grep clean in `src/` |
| Page spec updated: N>2 rows, preset/set split, toggle, no batch/saved-sets | ✔ | new specs: 4-row render, set apply, header ops, toggle, batch-absence assertions |

## Round 1 — findings → fixes

- **[MAJOR] `updateConfig` recomputed disabled slots** — editing a dimmed
  row repopulated `swings[i]`/`stats[i]` despite the off flag → gated on
  `configEnabled()[i]`; slot stays empty until re-enable (spec added).
- **[MAJOR] Dead service methods** — `saveAnalysis`/`loadAnalysis`/
  `loadAllSwingSets` + `docId` + ~200 spec lines + `SwingAnalysisInput`
  helper types excised (`loadSavedAnalyses` retained — option-chain caller).
- **[MAJOR] `saveConfig` silent no-write** — now `throwError`s on input
  with neither `config` nor `configs` (spec added).
- **[MINOR]** `applyConfigSet` reimplemented `docConfigs` → calls helper.
- **[MINOR]** `isConfigSet`/`docConfigs` disagreement on `configs: []` →
  `!!doc.configs?.length`.
- **[MINOR]** `renameSavedConfig` re-derived doc id → `paramsId`
  passthrough on `SwingConfigInput`.
- **[MINOR]** `deriveSetParamsId` order-sensitive → members sorted+deduped.
- **[MINOR]** Rename input triple-bound (`change`+Enter+`blur`) → Enter+blur.
- **[MINOR]** `savedPresets` leaked config-less docs → filtered.
- **[NIT]** Triple blank lines, stale "dual mode" comments/test names,
  `track paramSummary(preset)` → `track preset`, `saveActiveSet` unused
  name param → dropped, dead `name`/`getDoc`/`collectionData` mocks.

## Round 2 — verification

All substantive findings re-verified FIXED. Residuals swept in round 2
follow-up: stale `openSettings`/smallSwings comments, dead service mocks
in `symbol-nav.feature.spec.ts` + service spec fsMock plumbing, explicit
`name: undefined` in the set doc.

## Residual notes (accepted)

- `configEnabled` is a parallel array, not `{config, enabled}` wrappers —
  every mutation site keeps alignment (store spec asserts the transition
  sequence). Documented trade-off; a wrapper refactor is future cleanup.
- Muted slots keep a table/panel seat (`[]`/`null` rather than collapse) —
  deliberate: "muted ≠ removed" keeps row positions stable.
- Enter→blur rename can double-commit — guarded + idempotent (same
  paramsId upsert).
- Store file ~770 lines; dialog ~560 — both were already over the 400
  guideline; noted for the next split opportunity.
- Set doc ids grow with member count (~35 chars each; Firestore limit
  1500 → ~40+ member sets would fail `setDoc`) — unreachable in practice;
  a cap/hash is a follow-up if needed.

## Tests

- `npx jest swing-analysis --coverage=false` — **271/271, 8/8 suites**
- `npx jest --coverage=false` — **2034/2034, 149/149 suites**

## Findings (open)

None.
