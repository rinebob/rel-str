# CODE-REVIEW — #1351 Selection Replay UI polish + pick-doc contract alignment

**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1274  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1351  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

**Verdict:** PASS (after remediation — two majors fixed in pass)

## Scope reviewed

FE (#1351): `options-replay-new-run-dialog.component.{ts,html,scss,spec.ts}` — Y/M/D selects, 200px symbols field, 2026-01-01 default.
BE (thread maintenance, ships alongside): `functions/src/options-replay/pick-doc-client.ts` + `tests/functions/options-replay/pick-doc-client.test.ts` — alignment to SA's delta-picks discovery doc (`partnerOptionsDeltaPicksV1`, `delta` param, `{ok}` envelope, `OPTIONS_NOT_ENABLED` propagation).
Docs: IMPL-FE as-built bullet + `Last Updated` bump.

## Standards axis — findings addressed

| Severity | Finding | Disposition |
|---|---|---|
| major | `partnerPickDocTransport` untested — the wire realignment (param spelling, envelope, code extraction) had zero coverage | **Fixed** — new fetch-stub describe (6 specs): V1 URL + `delta=` param, `{ok:true}` unwrap, `ok:false`/`ok`-absent → 502, invalid JSON → 502, `OPTIONS_NOT_ENABLED` code extraction. Same IAM+upstream harness as `options-contract-availability.test.ts` |
| minor | Year select offered 2016–2025 — dead years before coverage | **Fixed** — floored at `EARLIEST_COVERAGE_YEAR = 2026` |
| minor | `MatTooltipModule` dead import | **Fixed** — removed |
| minor | Comment drift: test header "endpoint pending", scss "4 chars max", client docblock over-generalized 404 skip | **Fixed** — all three |
| minor | IMPL-FE `Last Updated` not bumped | **Fixed** — 2026-11-01 |
| minor | `PickDocument.updatedAt?: string` vs SA `string\|null` | **Deferred** — shared type in unchanged file; runtime-safe (merge guards `shard.updatedAt &&`) |
| nit | `PICK_DOC_ENDPOINT_PATH` not in `PartnerEndpointPath` enum; `deltaPct` field name vs wire `delta` | **Accepted** — field name matches SA's own parsed-params interface; enum move optional |
| nit | `parseSymbols` duplicates the sim dialog's helper | **Accepted** — one-function duplication across two dialogs; extracting a shared util is more churn than value |
| nit | `CommonModule` unused; `String()` redundant; sequential shard awaits | **Accepted** — sibling precedent; ~11 serial requests is fine |

## Spec axis — all contract elements + ACs MET

- Every documented contract element verified against `options-delta-picks-discovery.md` AND SA's implementation (`options-delta-picks-partner.ts`): endpoint name, GET, `symbol/type/delta/dte/year` params, `{ok:true,…doc}` envelope, `OPTIONS_NOT_ENABLED` vs `NOT_FOUND` 404 split, 400/401/403/500 semantics, earliest coverage 2026-01-01, `startDate` as shard selector not wire param.
- #1284 ACs unregressed: same `OptionsReplayStartRequest` payload (`startDate` still `YYYY-MM-DD`), REPLAY_TEMPLATES select, free-text uppercase symbols, ReactiveForms.
- #1351 ACs: impossible dates unconstructable (leap-aware day list), spec coverage per fix, payload shape unchanged.
- `permutation.ts` 404-permanent path correctly absorbs the newly-propagating `OPTIONS_NOT_ENABLED` — list docs fail honestly, no retry loop; `partnerHttpErrorToCallableCode` already maps it to `failed-precondition`.

## Thermo-nuclear axis — findings addressed

| Severity | Finding | Disposition |
|---|---|---|
| major | `body.ok === false` guard too weak — `ok` absent/`0`/string silently accepted as a doc | **Fixed** — `body.ok !== true` + dedicated spec |
| minor | Skipped shards invisible — no logging on the `continue` path | **Fixed** — `logger.warn('partnerPickDoc_shard_skipped', {symbol, year, partnerCode})` |
| minor | `Number(slice(0,4))` accepts `'20266-01-01'` as 2026 | **Fixed** — strict `YYYY-MM-DD` shape regex + spec |
| minor | Inverted window throws misleading 404 | **Fixed** — `firstYear > lastYear` → 400 invalid-window + spec |
| minor | Full response body embedded in thrown error (500-char log snippet existed) | **Fixed** — error message sliced to match |
| minor | `setValue` ordering hole — controls set in declaration order (day last) could persist Feb 31 programmatically | **Fixed** — `startDay.valueChanges` also triggers the clamp; spec proves `{month:2, day:31}` → 28 |
| minor | Year-change leap clamp (Feb 29 → non-leap year) untested | **Fixed** — spec added |
| nit | `dayOptions()` allocates per CD; subscriptions lacked `takeUntilDestroyed`; `DEFAULT_START.y` could precede the year list | **Fixed/accepted** — `takeUntilDestroyed` added; allocation fine under OnPush; 2026 floor guarantees the default is in-range |

## Test results

- `tests/functions/options-replay/pick-doc-client.test.ts` — **20/20** via `tsx --test` (was 10; +6 transport, +1 merge-meta, +3 window/abort)
- `npx jest options-replay` — **75/75** across 9 suites (dialog 10 → 13)
- `npm --prefix functions run build` — clean
- `npm run typecheck:tests` — clean for all in-scope files (pre-existing failures in `tests/functions/signal-date-writer.test.ts` are topic 984-1019's, on prod — not this diff)
- Env note: `functions/npm install` was run (google-auth-library absent from a stale node_modules — not a code issue)

## Convergence log

- Implement pass: dropdowns + contract alignment; 10 dialog + 10 backend specs green.
- Review pass 1 (3 axes in parallel): 2 majors (transport coverage, `ok` guard) + ~15 minors/nits.
- Remediation 1: both majors + 11 minors fixed; nits accepted/deferred as recorded.
- Review pass 2 (same 3 axes, verification mode): all pass-1 findings verified FIXED; one new gate-blocking defect — `type: 'put'` literal in the transport fixture fails strict `typecheck:tests` (fixed → `OptionType.PUT`); plus `days` presence check on the envelope, dead `Number.isFinite` removal, `endDate` var in the error message, `upstreamCall()` filters by endpoint name (not "first non-IAM"), year-floor spec pinned (`toContain(2026)`), mid-sweep `OPTIONS_NOT_ENABLED` spec, header/as-built wording.
- Remaining opens: 4 accepted nits (`deltaPct` field name, `parseSymbols` dup, `CommonModule`, `String()` cast) + 1 deferred minor (`PickDocument.updatedAt` `string|null` widening — unchanged shared file).
- Verdict: **PASS** — no unresolved critical/major findings; pass-2 remediation introduced zero new defects.
