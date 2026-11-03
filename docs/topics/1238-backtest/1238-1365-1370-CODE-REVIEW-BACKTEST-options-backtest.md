**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1365  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1370  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Code Review — #1370 optionsAnalysisStart callable

## Verdict: **PASS** (one round; all findings remediated or accepted in-cycle)

Thin validator+enqueuer over the established deps-seam family. Three-axis
review found no Critical/Major issues *in the task's own code* — but TN
traced a real latent race in the shipped `retry.ts` (round-1 #1369 code)
that this feature's usage pattern exposes, and it was fixed in-cycle.

## Gate results

| Axis | Result |
|---|---|
| Thermo-Nuclear | Clean for the callable itself — validated the thin design; **Major forward finding** on the shipped `retry.ts` + worker contract (below) |
| Standards | PASS — family conventions verified line-by-line (deps seam, `Pick<>`, `code()` helper, fixture pattern, config parity); 1 Minor + nits |
| Spec | PASS — all 3 ACs implemented and tested; error vocabulary exact (`failed-precondition` for missing AND non-success; `invalid-argument`; no `not-found`); payload deep-equals `OptionsAnalysisTaskPayload`; coverage exceeds TEST-BE |
| Full jest suite | 286/287 suites — **1 foreign failure**: untracked `option-chart-generator.spec.ts` (user's in-flight #1243 wiring; component now injects `OptionsReplayRunsService`, spec lacks `Functions` provider — `NG0201` ×5). Untouched by this task |

## Findings + dispositions

| # | Finding | Disposition |
|---|---|---|
| TN-M1 | **`retry.ts` `resetListDoc` clobbers fresh success** — a losing concurrent retry resets a doc to `pending` (deleting `rows`) after the winning task already re-succeeded; doc stuck `pending` with `rows` deleted under a `'success'` outcome — a later analysis could then see an incoherent doc | **FIXED** — `resetListDoc` is now transactional: skips the reset when the doc reads `success`/`running` at tx time |
| TN-M1-fwd | **Worker must re-validate at run time** — the success-check→enqueue gap is inherently non-transactional; missing `rows` = reset-in-progress, NOT a valid empty analysis | **FORWARD-NOTED** — IMPL-BE §3 step 1 amended + start.ts header documents worker ownership (lands on #1372) |
| ST-M1 | Enqueue failure propagated raw — caller loses the cause message (siblings wrap `internal` + preserve message) | **FIXED** — `try/catch` → `HttpsError('internal', msg)`; spec updated |
| SP/STD-N | IMPL §2 prose said "a dedicated `options-analysis` queue" — actual queue name = worker export `optionsReplayAnalysis` | **DOC FIXED** — §2 now names the literal queue + explains the naming rule |
| TN-N | Malformed docId (`/`, >1500 bytes) → `internal` not `failed-precondition`; corrupt-doc missing fields → `undefined` payload fields; deploy-ordering (worker doesn't exist until #1372); cross-deploy registry skew (detectable via `registryVersion`) | **ACCEPTED** — thin-callable scope discipline; deploy-sequencing already flagged; skew self-detecting |

## In-cycle remediation summary

| Change | Files |
|---|---|
| Transactional `resetListDoc` — `success`/`running` docs skipped (closes the losing-retry clobber race; #1369 follow-up) | `functions/src/options-replay/retry.ts` |
| Enqueue failure → `HttpsError('internal', cause)` (sibling message parity) | `functions/src/options-analysis/start.ts` |
| Worker stale-task ownership documented in header | same |
| IMPL-BE §2 queue-name literal + §3 status-re-check requirement | `1238-1266-1357-IMPL-BACKTEST-BE-...md` |
| Enqueue-failure spec: `internal` + preserved message | `tests/functions/options-analysis/start.test.ts` |

## Re-verified after remediation

- `test:options-analysis` → **13/13** · `test:options-replay` → **64/64** (env-dependent pick-doc test green this run)
- Functions `tsc --noEmit` + esbuild → clean

## Carried forward to downstream tasks

- **#1372 worker** (hard requirement now in IMPL-BE): re-validate `status === 'success'` at run time; missing `rows` → retryable, never zero-count overwrite.
- **Deploy order:** `optionsAnalysisStart` enqueues to a queue that only exists once `optionsReplayAnalysis` deploys — ship them together (or worker first).
- `optionsReplayStart` still lacks `timeoutSeconds` (pre-existing #1281) — carry-forward hardening candidate.
- **Foreign suite failure** to watch: `option-chart-generator.spec.ts` needs `{ provide: Functions, useValue: {} }` — user's in-flight #1243 work, not this task.

---

## Review — Round 2 (post-remediation re-review)

All three axes re-ran on the remediated files. **Verdict: PASS — no Critical, no Major in the remediated code.**

| Axis | Result |
|---|---|
| Thermo-Nuclear | Remediation verified **correct and atomic** — tx skip closes the doc-side clobber window across all traced interleavings; `'running'` in the guard proven necessary, creates no stuck-doc mode; `tx.set`+merge on missing doc correct. One **pre-existing Major** characterized (worker-side mirror, below). |
| Standards | PASS — all 5 round-1 fixes verified; nits only (dep JSDoc parity — fixed). |
| Spec | PASS — all ACs hold; guard proven sound (`listOutcomes==='failed'` implies doc was `failed` at record time); coverage matrix complete. |
| Full suite | 286/287 — same foreign failure (`option-chart-generator.spec.ts`, NG0201 ×5; untracked, user's #1243 work). |

### Round-2 in-cycle remediation

| # | Finding | Fix |
|---|---|---|
| TN-m1 | `failRun` could falsely regress a healthy `running` run to `failed` when `restored` was empty (all un-enqueued symbols re-resolved) | Guard generalized: **no write at all when nothing was restored** — outcomes unchanged anyway, the run converges via close-out |
| TN-m2 | The TN-M1 skip predicate had zero coverage (prod-wiring seam) | Extracted `shouldResetForRetry` as an exported pure fn + unit test covering all 5 status inputs (16th retry test) |
| ST-N | `getListDoc` dep member lacked JSDoc | Added |
| TN-n | `resetListDoc` comment motivated only the `success` case | Comment now covers `running` (pointless write under a mid-flight worker) |

### Carried forward — NEW this round

- **Worker-side mirror race (pre-existing Major, since #1369):** a stale terminal-skip delivery stalled between `getListDoc` and `closeOutList` can re-record `'failed'` after `resetRunForRetry` deleted the outcome → doc/outcome divergence (doc `success`, outcome `failed`). Heals on a subsequent retry *if* the run reached `failed`; invisible while `running`. Fix belongs in the worker's outcome write or a stale-`running` reconciler — tracked alongside the existing sweeper note for #1372+.
- Ultra-narrow residual: losing retry can reset a doc a winning task *re-failed* — convergent, regenerates cleanly.
- `getListDoc`/`resetListDoc` raw rejections → generic `internal` (sibling-consistent).

### Re-verified

- `test:options-replay` → **65/65** (incl. new predicate spec) · `test:options-analysis` → **13/13**
- `tsc --noEmit` + `eslint` on both touched files → clean
