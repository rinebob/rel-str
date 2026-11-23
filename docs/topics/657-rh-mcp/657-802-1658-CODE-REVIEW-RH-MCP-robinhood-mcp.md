**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1658  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — #1658 RH OAuth grant deaths (refresh lease + lineage seal)

## Round 5 — re-review after r4 remediation (2026-11-22)

```text
First pass complete — three axes in parallel: Standards (all 5 r4 items REMEDIATED, 0 critical/major, 7 minor ~6 carried + 1 new, ~10 nits), Spec (all ACs MET — AC1 verified on-issue, AC5 re-verified live 10/10 post-fix; 1 new minor S1), Thermo-nuclear (all 5 r4 items REMEDIATED, 0 new majors; 3 minors + nit cluster)
Second pass complete — deduped: TN-m1 ≡ Spec-S1 (resurrected doc drops clientInformation/discoveryState → refresh-unusable; seal evidence can overclaim post-delete); TN-m2 pending-clear incomplete on lease-adopt paths; TN-m3 POSIX stat→rename residual documented/irreducible. No diff surface escaped all three axes.
Convergence: PASS — no new majors; in-cycle minor fixes applied (resurrect carries full doc fields, seal post-delete re-check inside held lease, discardPendingWrites on both lease-adopt sites, reloadBundle retries after transient load failure, probe exitCode preserves finally cleanup, README numbering)
```

### Round-5 verdict: PASS

rh-* suite **310/310**, lease spec 62/62, tsc + esbuild clean, live lease verify 10/10 (post-F6 fixture, run this round). Design direction confirmed live: concurrent independent grants minted + refreshed (two-grants probe), `https` redirect_uri accepted (redirect-uri probe) — per-store-mint architecture validated and recorded on the issue.

**In-cycle fixes applied** (all pinned):

- **Resurrect completeness (TN-m1/Spec-S1)** — `persistTokens` snapshots `clientInformation`/`discoveryState` alongside `presentedRt`; a null-reload resurrect now writes a self-refreshing doc, not a tokens-only husk. Asserted on the existing DeletingInterposer test.
- **Seal post-delete re-check (TN-m1b)** — after a committed CAS-delete, `sealLocalSourceIfCopied` re-`load()`s inside the still-held lease; a zombie-resurrected doc returns `rotated_during_seal` + corrective warning instead of a falsified `sealed: true`. Pinned by `ResurrectingRepo` test.
- **Pending-clear on lease-adopt (TN-m2)** — new `discardPendingWrites()` on the provider, called at both `refreshUnderLease` adopt sites (r4-4 was only fixed inside `persistTokens`).
- **`reloadBundle` retry (n4)** — transient `load()` failure now leaves `loaded: false` so the provider retries instead of staying permanently empty.
- **Comment accuracy (n3)** — the non-rotating-bump fallthrough comment no longer claims "rt is valid either way" in the winner-posted-but-unstored case.
- **Probe cleanup (Standards M-7)** — `process.exitCode` + `return` inside `try` so `finally` still sweeps the probe grant dir.
- **README numbering (Spec-S3)** — duplicate `61.` → `62./63.`.

### Carried minors (accepted / tracked)

- Dead `now?: Date` option on `StoredCredentialRefreshOptions` (callers pass it; nothing reads it).
- `delete(expectedRevision?)` fail-open optional param (JSDoc-mitigated; only caller passes it).
- `.orphan`/`.stale` litter has no GC (loud warn surfaces each; bounded by rarity).
- `memoryDocStore` + CAS fakes duplicated across two spec files; deepened file-repo duplication; spec file at ~1,090 lines (over the soft 1k line — split candidates noted).
- `adoptedWinner` not set on the persistTokens-adopt path (evidence nit).
- POSIX stat→rename residual in `restoreOrOrphan` (µs window, documented; irreducible without dir-fd APIs).
- Zombie-TTL bound: documented accepted residual — a holder stalled >60s mid-POST can be taken over → bounded double-POST window; tracked for the #811 runbook.

## Round 4 — re-review after r3 remediation (2026-11-22)

```text
First pass complete — three axes in parallel: Standards (all 6 r3 items REMEDIATED, 0 critical/major, 6 minor + nits), Spec (all 6 r3 majors REMEDIATED; 1 new MAJOR — verify script's -1ms TTL fixture broken by F6's 1s skew grace; ACs 1-4+6 MET, AC5 artifact compromised), Thermo-nuclear (all 6 r3 items REMEDIATED; 1 new MAJOR — zombie persistTokens adopt-on-null discards the only live rt; 2 minor + nit cluster)
Second pass complete — deduped: Spec-major fixed same-session (verify fixture -1→-5000 + guarded release + guide updated); TN-minor set overlaps Standards minors (dead `now`, dup fixtures, GC-less orphans). No diff surface escaped all three axes.
Convergence: FAIL — one new major in the remediated code (adopt-on-null), same grant-death class; label reverted to 5_IMPLEMENT
```

### Round-4 verdict: FAIL

All six r3 items verified REMEDIATED by all three axes. rh-* suite 304/304, lease spec 41/41 + 5× flake-free, tsc + esbuild clean. Two new findings:

**Spec-M — verify script's expired-TTL fixture invalidated by F6** (`scripts/verify/rh-mcp-refresh-lease-1658.ts:72`). `acquire('verify-1658-holder-c', -1)` writes `expiresAt = now−1ms` — inside the new 1s `CLOCK_SKEW_GRACE_MS`, so takeover denies and the check fails on the next live run. **Fixed same-session:** `-1` → `-5_000` (past the grace), `release(d!)` → guarded `if (d)`, guide `.md` documents the grace.

**TN-M — zombie `persistTokens` adopt-on-null drops the only live lineage copy** (`repository-oauth-provider.ts:199-205` × `upload-credential-bundle.ts:180-194`). Zombie Z (lease TTL overrun) has `POST rt-A` in flight; the seal takes over its expired lock, sees `rt-A === uploaded rt-A`, `delete(N)` succeeds. Z's POST returns rt-B (live). Z's persistTokens: conflict → `reloadBundle()` → `null` → `undefined !== presentedRt` → **return without storing** → rt-B — the only live copy — discarded; prod holds dead rt-A; seal reported success. Null-reload is an emptied store, not an interposer win — nothing exists to adopt. **Fix:** on `this.bundle === null` after reload → clear `storedRevision` and retry → resurrects rt-B (strictly dominates: prod is dead either way; resurrection preserves one live copy).

### Round-4 minors (in scope)

- TN-m1 — `restoreOrOrphan`'s blind rename overwrites a contender's empty dir on POSIX (rename onto empty dir replaces; C's pre-marker dir destroyed, C's marker lands inside the restored foreign dir → silent double-hold). Mitigate: stat lockPath before the restore rename.
- TN-m2 — adoption leaves `pendingClientInformation`/`pendingDiscoveryState` set — stale pending shadows the adopted grant's client_id → future `invalid_client`. Clear on adopt.
- TN-m3 — after reload→null, stale `storedRevision` makes retries use expected=N, never null (folds into the TN-M fix).
- Warn text claims "parked at orphan" even when the orphan rename failed.
- Nits — `adoptedWinner` flag absent on persistTokens-adopt; `local!` vs `local?.` inconsistency; restore retry delay not injectable; `.orphan` litter has no GC.
- Standards minors (carried): dead `now` option; `delete(expectedRevision?)` fail-open optional param; duplicated `memoryDocStore` + CAS-blind fakes; deepened file-repo duplication; spec file 946 lines.

### Round-4 test results

rh-* 304/304; lease spec 41/41 (5× consecutive clean); tsc + esbuild clean; live verify 10/10 (pre-F6 — re-verify post-deploy pending).

## Round 3 — re-review after r2 remediation (2026-11-22)

```text
First pass complete — three axes in parallel: Standards (all 4 r2 majors REMEDIATED, 0 critical/major, 2 minor, 6 nit; suspected-compile concern disproven — tsc clean on touched surface), Spec (all 6 ACs MET — AC1 verified on-issue, AC5 live verify 10/10; 0 major, ~4 minor), Thermo-nuclear (all 4 r2 majors REMEDIATED with residual gaps; 4 NEW majors F1–F4 same grant-death class, +F5/F6 minors)
Second pass complete — cross-axis dedupe: TN-F5 ≡ Spec-F2 (staleness guard asymmetry); TN-F1/F2 relate to Standards minor-1 (orphan dirs no GC). No diff surface escaped all three axes — TN traced all transitive consumers (robinhood-mcp-connection, local-oauth-bootstrap, session cache, rh-api) + SDK internals.
Convergence: FAIL — new major findings in the remediated code; gate rules require revert to 5_IMPLEMENT
```

### Round-3 verdict: FAIL

All four round-2 majors verified REMEDIATED by all three axes (release move-aside, restore-on-mismatch, StaleUploadError + --force, persistTokens retry). rh-* suite 295/295, lease spec 35/35, live verify 10/10, tsc + esbuild clean. But thermo-nuclear found four new majors — all squarely in the grant-death class on the core surface:

**F1 — `release()` restore-collision strands a successor's live lock → double-hold → double POST** (`file-refresh-lease.ts:177-211`). Zombie A's TTL expires → B completes takeover → A's release moves B's LIVE dir aside → restore fails when C mkdirs in the gap → B (mid-POST) + C both believe they hold the slot → two presentations of one rt → revocation. POSIX wrinkle: restore-rename onto C's empty pre-marker dir succeeds and destroys B's marker record. Fix: early-return when `observed.expiresAt <= Date.now()` — an expired marker is takeover-bait; leave it for the takeover path, collapsing the whole successor-kill window.

**F2 — `acquire()` takeover restore-failure strands a live foreign dir** (`file-refresh-lease.ts:148-156`). Mirror image: we rename-aside having observed expired; fresh holder H completes takeover in the gap; moved-marker mismatch → restore; a third contender claimed lockPath → restore fails → stalePath keeps H's live marker while C holds lockPath → double POST. Irreducible core of rename-based locking (can't un-hold H's in-memory lease); mitigate: retry restore once, deterministic orphan naming, loud surface.

**F3 — `sealLocalSourceIfCopied` load→delete not fenced against a zombie refresh's store()** (`upload-credential-bundle.ts:158-174`). Seal takes the refresh lease; `delete()` is guarded by the store lock — but a lease-EXPIRED refresh Z can land rt-B via `store()` between the seal's `load()` (saw rt-A == uploaded) and `delete()` → deletes the only live copy while prod holds dead rt-A → total lineage death. Mirror ordering resurrects the doc via persistTokens' expectedRevision=null retry → silently un-seals. Fix: `delete(expectedRevision)` CAS inside the store lock; landing rotation aborts the delete → refuse+warn.

**F4 — `persistTokens` retry plants a dead position when the interposer rotated; one retry is the whole budget** (`repository-oauth-provider.ts:169-202`). (a) The invariant "interposer can't rotate" breaks under deployment skew (old-build unguarded refresh on the shared doc) or `--replace` mid-refresh → retry stamps rt-B over interposer's live rt-C → next refresh replays dead rt-B → revocation. Fix: capture `presentedRt` before the loop; if the reloaded rt differs → adopt, don't store. (b) A second consecutive conflict discards minted rt-B → bounded loop (3–5) is nearly free and strictly safer.

### Round-3 minors

- **F5** — `--replace` guard fails open on undatable STORED stamp (`upload-credential-bundle.ts:87`; `currentStamp` NaN → any replace accepted). Symmetric fail-closed: require `--force`. (≡ Spec-F2)
- **F6** — KMS lease TTL evaluated on reader clocks, written on writer clock — no skew margin; document the NTP assumption or add grace (`kms-firestore-credential-repository.ts:180-197`).
- Standards m1 — orphaned `.stale`/`.release` dirs have no GC (comment over-promises; implement sweep or reword).
- Standards m2 — `now?: Date` is a documented dead option (`stored-credential-refresh.ts:13-15`; two callers pass it).
- Spec F4 — seal-busy error path offers no seal-only re-run (`upload-rh-credential.ts` generic exit 1).
- Nits — `isNodeError` triplicated; spec hardcodes lease doc path vs exported constant; `memoryDocStore` duplicated across specs; spec file 720 lines; `leasePort!` non-null assertion; no explicit BusyError classifier category.

### Round-3 test results

rh-* suite 295/295 pass; lease spec 35/35; `tsc --noEmit` clean on touched surface (only pre-existing #1501 error); esbuild clean; live verify (`scripts/verify/rh-mcp-refresh-lease-1658.ts`) 10/10 incl. scratch-doc cleanup.

### Round-3 fix plan

1. `release`: early-return on expired observed marker.
2. `acquire` takeover + `release`: restore retry once; deterministic orphan naming + loud surface on put-back failure.
3. File repos: `delete(expectedRevision)` CAS inside the store lock; seal passes `local.revision`; refuse+warn on rotation-landed.
4. `persistTokens`: presented-rt compare on the conflict retry (adopt if interposer rotated) + bounded retry loop.
5. `--replace` guard: fail-closed on undatable stored stamp.
6. KMS lease doc: clock-skew comment/margin.
7. Pin each with fault-injection tests; re-run gates.


## Round 2 — re-review after remediation (2026-11-22)

```text
First pass complete — three axes in parallel: Standards (all 6 fix-groups REMEDIATED, 1 suspected-compile major DISPROVEN, 5 minor, 6 nit), Spec (all 6 ACs still MET, 0 major, 5 minor), Thermo-nuclear (0 critical, 4 major, ~6 minor)
Second pass complete — cross-axis dedupe to 4 major fix-groups; verified no diff surface escaped all three axes; Standards' "major" foreign-hunks item reclassified as commit-time attribution (not a code finding)
Convergence: FAIL — new major findings in the remediated code; gate rules require revert to 5_IMPLEMENT
```

### Round-2 verdict: FAIL

All six round-1 majors verified REMEDIATED (extraction, TOCTOU hardening, test wiring, seal identity, TTL doc, branch coverage) — but the thermo-nuclear pass found four real majors in the new code and the seal's blast radius. Task label reverted `6_REVIEW` → `5_IMPLEMENT`.

**M1 — `release()` read→rm TOCTOU deletes a successor's live lock** (`auth/file-refresh-lease.ts:153-161`). Zombie-window scenario: our TTL expires, contender completes takeover between our `readMarker` and `rm` → we delete *their* live lock dir → every subsequent contender stacks on → concurrent POSTs. Fix: same private-dir idiom acquire uses — `rename` aside, inspect, `rm` if ours / rename back if not.

**M2 — `readMarker(stalePath)` throw orphans a live holder + restore-fail `rm` deletes a live foreign dir** (`auth/file-refresh-lease.ts:129-138`). Transient EPERM/AV on the moved-dir read propagates with a live foreign marker stranded under a private name while `lockPath` is free for a new holder. And when put-back `rename` fails (third contender), falling through to `rm(stalePath)` deletes a possibly-live marker. Fix: restore-then-rethrow on moved-read error; never `rm` on restore failure.

**M3 — `upload --replace` can regress prod to a dead rt, then the seal deletes the last copy** (`upload-credential-bundle.ts:59-83`, `scripts/upload-rh-credential.ts`). Operator re-uploads an old export file: CAS checks revision, not freshness → live rt-B overwritten by dead rt-A; seal sees local.rt == uploaded.rt → deletes the last remaining copy → entire lineage dead, discovered at the next prod refresh. Fix: replace path compares `lastTokenResponseAt` — prod newer than export → abort unless `--force`. **Most probable operator-error kill in the change.**

**M4 — Winner's CAS conflict after a successful POST discards the rotated rt** (`stored-credential-refresh.ts` → `repository-oauth-provider.ts persistTokens`). A non-refresh writer (`saveClientInformation`, `saveDiscoveryState`, `upload --replace`) bumps the revision between our reload and store → CAS throws → rt-B dies with the discarded response → next refresh replays dead rt-A. Same D2 death class, pre-existing but this task owns it. Fix: on `CredentialRevisionConflictError` inside `persistTokens`, reload + retry the store once while the lease is still held.

Round-2 minors (selected): `moved !== null` clause makes the put-back check incomplete (m1); takeover `writeMarker` failure leaves a self-owned markerless wedge (m2); `stale_export` comment overclaims ("proves" → "strongly suggests"; NaN-stamp direction unhandled) (m3); untested non-rotating-bump fallthrough + adopt-null (m4); post-plant staleness detection could move pre-upload (spec minor-1); machine-local seal doesn't cover other machines/env-secret bundles → #811 runbook note (spec minor-3); residual store-lock duplication across the two file repos (standards minor).

**Test results round 2:** rh-* suite 287/287 pass; `test:rh-agent-mcp-refresh` 39/39; live verify 10/10; esbuild + tsc clean on the task's surface (pre-existing #1501 error unrelated). Foreign-session hunks confirmed in `CONTEXT.md` and `functions/package.json` diffs — commit-time hunk attribution required.

---

## Round 1 (2026-11-22) — original FAIL, findings since remediated

## Pass sequence

```text
First pass complete — three axes in parallel: Spec (all 6 ACs MET, 1 major), Standards (2 major, 5 minor, 10 nit), Thermo-nuclear (4 major, 6 minor, 9 nit)
Second pass complete — cross-axis dedupe to 6 major fix-groups; confirmed no diff surface escaped all three axes; severity disputes resolved (TTL-fencing demoted to minor-once-documented)
Convergence: FAIL — major findings present; gate rules require revert to 5_IMPLEMENT
```

## Verdict: FAIL

Major findings exist. Task label reverted `6_REVIEW` → `5_IMPLEMENT`. Fix the majors below (minors strongly recommended — several ride the same edits), then re-run `/proj review 657 1658`.

## Summary of axes

**Spec** — all six ACs verified MET (concurrent-POST guarantee implemented + tested; seal-source wired; regression spec exists; live verify green incl. forced canary; classifier untouched). One major on seal identity weakness; minors on TTL-fence, `--keep-source` warning, non-refresh revision bump, wedged-lease alarm gap.

**Standards** — two majors: verbatim lock-code duplication across file repos; new spec not wired into `package.json` test scripts. Minors: non-atomic marker write, `as unknown as` lease-doc casts, unfenced seal, Feature-Envy `provider.repository`, whole-backend-as-port exposure.

**Thermo-nuclear** — four majors: residual file-lock TOCTOU windows, the same duplication, TTL-not-fencing undocumented, zero tests for the restore/fallback branches. KMS path called out as tight (txn-retry fix + fencing verified correct).

## Findings by severity (consolidated across axes)

### Critical — none

### Major

1. **DUPLICATE-LOCK** (Standards M1 = TN M2) — `encrypted-file-credential-repository.ts:127-220` ≡ `portable-file-credential-repository.ts:138-231`: ~95 lines of identical subtle concurrency code (`acquireRefreshSlot`, `releaseRefreshSlot`, `readRefreshMarker`, `refreshLockFallbackExpiry`, `restoreRenamedLock`, `refreshMarkerPath`, `STALE_LOCK_AGE_MS`). Every future lock fix must be applied twice — three fixes below literally need it today. **Fix:** extract `auth/file-refresh-lease.ts` → `createFileRefreshLease(lockPath, currentRevision)`; each repo gets a one-line literal.

2. **FILE-TOCTOU** (TN M1 + Standards m1 + Spec n6/n7) — residual windows after the marker-compare: (a) `moved === undefined` skips the compare → renamed dir with an in-flight `writeFile` is `rm`'d; (b) `restoreRenamedLock` failure falls through to `rm` of a possibly-live lock; (c) `releaseRefreshSlot` `rm`s the dir when the marker read throws — kills a fresh `mkdir`-before-`writeFile` holder; (d) marker `writeFile` is `O_TRUNC` non-atomic — a contender can read it empty → `expiresAt: 0` → takeover. Narrow windows, but the consequence is the exact D2 grant death. **Fix (inside the extracted helper):** `{ flag: 'wx' }` + write-temp-then-rename for markers; only `rm` when the compare positively confirms; fencing check in release.

3. **TEST-WIRE** (Standards M2) — `tests/functions/rh-credential-refresh-lease-1658.test.ts` is reachable by no `package.json` script; the D2 regression suite never runs under the repo's convention. **Fix:** add a `test:*` script entry (sibling convention at `functions/package.json:10-40`).

4. **SEAL-IDENTITY** (Spec #3 + Standards m3) — `sealLocalSourceIfCopied` (`upload-credential-bundle.ts:94-108`): rt-equality can't distinguish an independent grant from a stale copy of the same lineage — a local store that refreshed between export and upload yields `independent_grant` while prod holds a dead rt (revocation bomb on first prod refresh → kills the live local copy too). Also load→delete isn't fenced vs an in-flight local refresh. **Fix:** compare `clientInformation.client_id` — same client_id + different rt → warn "may be a stale copy of the same lineage — re-export before uploading"; optionally take the repo's `refreshLease` around the seal when present.

5. **TTL-FENCE** (TN M3 + Spec #1) — the lease is advisory-TTL: a holder whose load→POST→CAS exceeds `leaseTtlMs` keeps running while a contender takes over → both POST. Inherent to TTL leases (no server-side idempotency to fence against), but the `RefreshLeasePort` contract doesn't say the guarantee is bounded by `critical-section < TTL`. **Fix:** document the bounded guarantee on the port + a comment at `acquire`; optionally log-tighten by having the KMS winner re-check the lease doc inside its store txn.

6. **UNTESTED-BRANCHES** (TN M4) — the trickiest new code has no direct tests: file-impl compare/restore (`moved !== observed?.raw`), markerless-lock fallback (`refreshLockFallbackExpiry`), corrupt/`NaN` marker, file-impl release fencing. **Fix:** spec cases planting a foreign live marker mid-takeover, an empty dir (markerless), a corrupt marker, and a foreign-holder release.

### Minor

- **NON-REFRESH-BUMP** (Spec #4 = TN m1 = S n7) — `waitForWinnerWrite` treats any revision bump (incl. non-refresh writes, and doc-deletion → null) as the winner's write; loser may adopt an unrotated grant and skip the refresh. Self-heals next call; rt-compare already reports honestly — optionally keep waiting when `adopted.rt === baselineRt`.
- **KEEP-SOURCE-WARN** (Spec #2) — `--keep-source` preserves exactly the fixed bug; the log line doesn't warn both copies die on next rotation. Louder warning warranted.
- **STALE-5MIN** (TN m2) — `STALE_LOCK_AGE_MS` (5min, borrowed from store lock) gates markerless-lock takeover vs the 60s lease TTL; a crashed mid-acquire blocks refresh for up to 5min. Scale fallback to `ttlMs`.
- **CATCH-ALL** (TN m3) — `catch { return null }` on rename/takeover swallows EPERM/EACCES as "contention" → 20s wait + BusyError instead of the real error. Rethrow non-ENOENT/ENOTEMPTY.
- **DOC-DECRYPT** (S n1 = TN m4) — `currentRevision()` doc says "without decrypting"; file impls call `load()` (full DPAPI decrypt+parse) per 400ms poll. Fix the doc text.
- **CASTS** (S m2) — `as unknown as Partial<RefreshLeaseDoc>` twice; snapshot `data()` typed `StoredCredentialDoc` is a lie for the lease doc. Generic typing or validated read.
- **BACKEND-AS-PORT** (S m5) — KMS repo exposes the whole `TransactionalCredentialDocumentBackend` as `refreshLease`; file repos use narrow literals — mirror that.
- **ALARM-GAP** (Spec #5) — corrupt far-future lease doc → perpetual `transient`, never `reauth_required`. Note in #811 runbook (already commented).
- **ZOMBIE-POST** (Spec #1/TN M3 residual) — inherent TTL-lease zombie POST window; document in #811.

### Nit

- Feature Envy `provider.repository` (S m4 = TN n3) — narrow accessor or options param would keep Demeter.
- `NonNullable<RepositoryOAuthProvider['repository']['refreshLease']>` twice instead of importing `RefreshLeasePort` (TN n2).
- `refreshLockFallbackExpiry` returns a one-field object — return the number (TN n1).
- `options.now` required but never read in `stored-credential-refresh.ts` (S n3 — pre-existing).
- Misleading test name + dead `const now` at spec:240-250 (S n2 = TN m6).
- `adoptedWinner`/`holderId` unused by prod callers — keep-or-drop deliberately (S n4).
- `memoryDocStore` duplicated between the two spec files — could live in fixtures (S n5).
- Marker `holderId\nexpiry` format — caller-supplied `\n` corrupts parse; JSON doc matches `RefreshLeaseDoc` (TN n6).
- Verify script: no cleanup release if a mid-run check throws (S n8).
- `docs/DATA-MAP.md:143` — `rh-agent-credentials` doc count now 2 while lease held (S n9).
- CONTEXT.md + verify README carry foreign-session hunks (S n10/TN n9/Spec n9) — commit-time attribution; the README dup "55." belongs to the foreign #1649 hunk.

## Test results

- `tests/functions/*.test.ts` full tsx suite (with NODE_OPTIONS IPv4 workaround): **793 tests, 782 pass, 11 fail — all 11 in `legacy-cohort-retirement-1661.test.ts`** (untracked, belongs to another session's in-flight task; asserts zero-references against its own uncommitted WIP). Zero failures in #1658's surface.
- `rh-credential-refresh-lease-1658.test.ts`: 17/17.
- `rh-*.test.ts`: 277/277.
- tsc + esbuild: clean. Pre-existing unrelated tsc error in `options-engine-eod-selection-1501.ts` (noted, untouched).
- Live: `rh-mcp-kms-repo-1639.ts --connect` PASS; `rh-mcp-refresh-lease-1658.ts` 11/11 on real Firestore (scratch doc); forced canary `state: ok` (deployed build — lease path lands post-deploy).

## Fix plan (for re-review)

1. Extract `auth/file-refresh-lease.ts` (fixes #1; vehicle for #2).
2. Inside it: `wx`+atomic marker write, positive-confirm compare before `rm`, fenced release, rethrow non-ENOENT, TTL-scaled fallback, JSON marker.
3. `package.json` test script for the spec (fixes #3).
4. New spec cases: compare/restore, markerless, corrupt marker, file release fencing (fixes #6).
5. `sealLocalSourceIfCopied`: client_id mismatch warning + optional lease fence (fixes #4).
6. Port-contract bounded-guarantee doc + `currentRevision` doc fix (fixes #5 + minor doc items).
7. Ride-along minors where the edit already touches the line (`refreshLeasePort` accessor, `RefreshLeasePort` import, number return).
