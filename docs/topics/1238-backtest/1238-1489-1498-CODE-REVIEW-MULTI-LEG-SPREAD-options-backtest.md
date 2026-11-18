**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-spread  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1498  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# Code Review — #1498 optionsReplayStart two-form request + snapshot

**Verdict: PASS** — 3 axes converged on PASS after one major + convergent
minors were remediated in-cycle and re-verified.

## Pass sequence

```text
First pass complete — 3 axes in parallel: Standards PASS (9 findings, all minor/nit), Spec PASS (2 minors + info), Thermo changes-requested (1 major + 11 minor/nit). Convergent: 'custom' unreserved in registry namespace; missing functions-side run-all/README registration; missing all-three-forms unit case. Real major: unbounded variantName/legs → >1MiB doc → internal mid-fanout with partial state.
Second pass complete — remediation applied and re-verified: legs ≤8 + variantName string ≤200 at the boundary; 'custom' reserved in claimId (spec-pinned); canonical grid-Δ stamping; per-case poll deadline; run-all + README registration; OptionsReplayRunWrite requires variantSnapshot; test additions (all-three-forms, dup-stock, >8 cap, variantName rejects, canonical-Δ pin, validator-label assert); validateVariantLegs direct spec pins; comment/version/doc nits. Skipped with reason noted: variantName-on-other-forms strictness (never-typed modifier, silent drop acceptable), templateId hint (cosmetic), sparse-array (unreachable over JSON). No coverage gaps — every changed hunk was in at least one axis's scope.
Convergence: PASS — one major finding, fixed and re-verified (114/114 options-replay, 49/49 shared, 23/23 dry verify, 0 tsc errors); remaining findings are minor/nit and remediated or documented.
```

## Diff summary

- `functions/src/options-replay/start.ts` — three-form exclusivity gate +
  `resolveRequestVariant`; `variantSnapshot` stamped at create (required on
  `OptionsReplayRunWrite`); `prodReplayStartDeps` exported for verify.
- `shared/options-replay-templates.ts` — `validateVariantLegs` exported
  (the SHARED validator; registry loop delegates, byte-identical
  messages); `'custom'` reserved id in `claimId`.
- `shared/options-replay-contracts.ts` — `'custom'` sentinel decision +
  legs-form boundary note (comments only).
- `tests/functions/options-replay/start.test.ts` — 18 new/rewritten cases.
- `shared/options-replay-templates.spec.ts` — `'custom'` reserved pin +
  `validateVariantLegs` describe (3 cases).
- `functions/scripts/verify/options-replay-start-forms-1498.{ts,md}` — DRY
  (real registry, fake deps) + `--live` (real prodDeps submit → poll to
  terminal). Registered in `functions/scripts/verify/run-all.ts` +
  `functions/scripts/verify/README.md`; row in root
  `scripts/verify/README.md`.

## Findings by severity

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | **major** (thermo) | Unbounded `variantName`/legs → >1MiB doc → `internal` mid-fanout + partial state, reachable by any authed caller | **Fixed** — legs ≤8 (2× largest registry shape) + variantName must be string ≤200; both reject `invalid-argument`; tests pin 9-leg + 201-char rejects |
| 2 | minor (std+thermo) | `'custom'` not a reserved registry id — future variant could shadow the legs-form sentinel; pre-#1499 worker would run stamped-'custom' runs as that variant | **Fixed** — reserved in `claimId` (shapes+variants, shared namespace); spec pins rejection |
| 3 | minor (thermo) | Non-canonical `targetDelta` stamped raw (-0.19999 passes round-check, diverges from registry-canonical -0.2) | **Fixed** — stamped in canonical grid form at normalization; test pins -0.19999 → -0.2 |
| 4 | minor (thermo) | Verify script shared 180s deadline starved later cases | **Fixed** — per-case deadline |
| 5 | minor (std+spec) | Not registered in `functions/scripts/verify/run-all.ts` + functions README | **Fixed** — registered (DRY default is credential-free, run-all safe; appended to avoid renumbering foreign #1573-75 entries) |
| 6 | minor (spec) | all-three-forms case absent from unit suite | **Fixed** — added to exclusivity table |
| 7 | nit (std) | `OptionsReplayRunWrite` couldn't enforce always-stamped invariant | **Fixed** — `variantSnapshot` required on write type, optional on read |
| 8 | nit (thermo) | `--live` leftovers undocumented | **Fixed** — `.md` notes `optionsReplayDelete` cleanup |
| 9 | nit (std/thermo) | Stale/forward comments: test header, "worker reads this" qualifier, `options_` SDK-version note | **Fixed** |
| 10 | nit (thermo) | Test gaps: dup-stock-legs pin, validator-label assert, legs-acceptance enqueued/status | **Fixed** |
| 11 | nit (thermo) | `validateVariantLegs` standalone labels unexercised | **Fixed** — 3 spec pins (`leg {i}`, `{where} leg {i}`, dup index) |
| — | nit | variantName on variant/templateId forms silently dropped | **Accepted** — `?: never` modifier, not an identity form; harmless |
| — | nit | `templateId:'pcs-45-20-5'` error lacks a "use variantId" hint | **Skipped** — cosmetic |
| — | nit | Sparse-array legs could stamp `null` | **Skipped** — unreachable over JSON |
| — | nit | `options_` private-field hack brittle on SDK upgrade | **Accepted** — documented + version-pinned comment; only supported-API alternative is a dynamic-import refactor (verify-script scope) |

## Verified correct (hunted and cleared by ≥1 axis)

- Forms count airtight — `!== undefined` presence: `legs:null`,
  `variantId:null`, `legs:'x'`, all pairs/triple rejected; nothing
  malformed reaches Firestore (all validation precedes every deps call).
- Snapshot integrity — registry legs stamped from the `Object.freeze`d
  registries (safe by-reference); inline legs normalized to contract
  fields (extra keys incl. nested dropped).
- Byte-identical validator messages — `label(i)` ≡ old `legWhere`;
  ordering + `seen` scope preserved; 49/49 spec.
- Legacy path verbatim — `Unknown templateId` message unchanged;
  `templateId:'custom'` can't spoof (no such registry entry →
  invalid-argument).
- Backward compat proven live — `csp-45-20` run **completed** under the
  deployed worker; variant/legs runs failed `'Unknown templateId'` as
  designed until #1499 (38/38 live verify).

## Test results

- `tests/functions/options-replay/` — **114/114** (incl. pick-doc-client
  live-wire specs under the IPv4 preload)
- `shared/options-replay-templates.spec.ts` + `options-common.spec.ts` —
  **49/49 + 15/15**
- Verify script — dry **23/23**, live **38/38** (real enqueue → worker
  dequeue; snapshots persisted through real writes)
- `functions` typecheck — 0 errors (7 pre-existing foreign `#1575`
  errors resolved by their session during review)

## Advisory carried forward

- #1499 must read `variantSnapshot` (never the registry); a missing
  snapshot = permanent failure per IMPL-BE.
- The `'custom'` sentinel now guards both registries — reserved forever.
