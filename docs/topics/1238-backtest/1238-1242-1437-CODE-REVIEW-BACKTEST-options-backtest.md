**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1437  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# Code Review — #1437: BUG — Options Replay/Analysis callables accept unauthenticated calls

## Verdict

**PASS (Round 2)** — fresh axes on the post-remediation diff all
returned APPROVE: zero critical, zero major, zero minor; only
cosmetic nits remained (loop-body indentation inside the new
`try/finally`, a redundant `as any` in the analysis spec) — both fixed
in-cycle and re-verified (41/41 focused specs, `tsc --noEmit` clean).
Thermo-nuclear confirmed every Round-1 fix is sound and re-cleared all
bypass hunts. No third pass needed.

## Round 2 (2026-11-07) — fresh axes on the remediated diff

### Standards — APPROVE

All five Round-1 remediations verified correct: `listReads` is a live
array reference (no getter/destructure hazard), comment reword applied
identically ×3, all 8 inline casts migrated, try/finally braces
balanced, usage path corrected. One new nit — the `for` body wasn't
re-indented inside `try` — FIXED.

### Spec — APPROVE, all 3 ACs re-verified MET

The R1 instrumentation gap is closed "for real, not cosmetically":
`listReads` is pushed inside `getListDoc`, so `length === 0` proves
guard ordering. Regression checks all clean — try/finally preserves
exit-code semantics (`process.exit` correctly outside `try`), the
`listReads` return-type change breaks no other destructure sites,
`code(e)` is defined before all call sites, and no caller anywhere
still passes raw input to the cores.

### Thermo-nuclear — APPROVE

0 critical / 0 major / 0 minor / 3 nit. Every remediation item
individually verified on disk: `mintIdToken` before `try` is safe
because `createCustomToken` doesn't provision the user (the
`signInWithCustomToken` exchange does) — the only orphan window is a
mid-flight network failure, self-healing via the deterministic uid.
All probe expectations re-traced to real code paths; `{data, auth}`
cast is byte-identical to the passing `delete.test.ts` precedent under
the strict `typecheck:tests` gate.

Nits fixed: loop-body indentation, redundant `as any` +
eslint-disable at `analysis/start.test.ts` (`request` already takes
`unknown`).

## Round 1 (2026-11-07)

### Standards

0 critical / 0 major / 1 minor / 3 nit — **APPROVE**.

The guard is byte-identical to the `handleOptionsReplayDelete`
(`options-replay/delete.ts:57`) idiom: `CallableRequest<T>` param,
`request.auth?.uid` check as the first statement, `const input =
request.data` alias preserving the existing body. Spec fixtures
(`request()`/`unauthRequest()` + the default-parameter JSDoc) are
verbatim reuse of `delete.test.ts`'s convention; the verify script,
guide, README index, and `run-all.ts` registration all follow the
directory's established patterns.

- **Minor — `getListDoc` uninstrumented in the analysis auth test** —
  the test claimed "before getListDoc runs" but only asserted
  `enqueued.length === 0`; a guard placed after `getListDoc` would
  still have passed. FIXED: `makeDeps` now returns a `listReads`
  counter and the test asserts `listReads.length === 0` — parity with
  retry's `order` instrumentation.
- Nit — "every caller-side effect is billed work" mislabeled the
  callee-side effects, triplicated across the three guards. FIXED:
  "every effect of the call is billed work" in all three files.
- Nit — `code()` helper added in `start.test.ts` but 8 legacy inline
  `(e as { code?: string }).code` casts remained. FIXED: all migrated
  to `code(e)`.
- Nit — `deleteUser` cleanup in the verify script ran only on the
  happy path. FIXED: wrapped the probe loop in `try/finally` so the
  disposable `qa-1437-auth-guard` auth user is deleted even on a
  thrown fetch. (Same gap exists pre-existing in
  `qa-1439-delete.ts:213` — left as-is, convention-consistent.)

### Spec — all three acceptance criteria MET

| AC | Evidence |
|---|---|
| 1. All three callables throw `unauthenticated` when `request.auth` is absent | Guard is line 1 of each testable core (start.ts:76, retry.ts:101, analysis/start.ts:71), before `request.data` deref, validation, or any dep call — inside the core, not wrapper-only |
| 2. Unit tests pin the guard per callable | Each spec has a `#1437` describe asserting `code === 'unauthenticated'` plus zero-dep evidence: retry records every dep in `order`; start asserts `runs.size`/`enqueued` empty; analysis now asserts `listReads`/`enqueued` empty |
| 3. No other `invoker:'public'` callable ships unguarded (or documented exemption) | Repo sweep confirms exactly 5 remaining public callables — all `st-cloud-function` family (`stGetSymbolsWithSignals`, `stGetSymbolSignalHistory`, `stOverviewSyncAdmin`, `stBacktestStart`, `stBacktestStrategies`). Exemption filed as #1444 — BUG: st-cloud-function callables accept unauthenticated calls |

FE regression check: all four call sites go through AngularFire
`httpsCallable` (options-replay-runs.service.ts:44-79,
options-analysis-runs.service.ts:39-43), which auto-attaches the
signed-in ID token — no FE change required, and all app routes are
behind `authGuard`.

### Thermo-nuclear — **APPROVE**

0 critical / 0 major / 6 minor / 2 nit. Every bypass hunt cleared:

- `request.auth` can't be client-forged (framework populates it only
  from a verified `Authorization: Bearer` ID token; the `data` body
  can't inject it)
- `auth:{uid:''}` can't arise from a verified `sub` claim, and `?.uid`
  rejects it anyway — stricter than paper-trading's `!request.auth`
- Cross-project Firebase tokens fail `aud`/`iss` verification →
  `request.auth` undefined → 401
- No callers still pass raw `input` to the cores — wrappers + specs +
  scripts all swept
- Verify probes are side-effect-free: every `badData` payload dies at
  validation before any dep runs (template lookup, empty-id checks)
- API key in scripts is public client config; service-account
  impersonation matches `backfill-orphan-st-symbols.ts`
- `run-all.ts` failing pre-deploy matched the suite's documented
  deploy-order convention — now moot, deploy already landed and the
  live probe passed 12/12

Minors accepted without change (documented, out of scope):

- **AuthN not authZ** — the guard proves "a real rel-str Firebase
  user", not "an authorized one". Consistent with every callable in
  the repo (delete, paper-trading, gh-lifecycle all identity-only);
  role claims are a separate posture decision.
- **Sibling public callables** (`stBacktestStart` enqueues Cloud Tasks
  anonymously — same vuln class) — deliberately not scope-grown;
  tracked as #1444.
- `core(undefined)` now TypeErrors instead of `invalid-argument` —
  only affects hypothetical direct callers; the framework always
  passes a request object.
- Stale usage path in `qa-1439-delete.ts` header — FIXED in-cycle
  (`.devin/tmp/` → `scripts/`).

## Remediation verification

- Focused specs (start / retry / analysis): **41/41** — red→green
  confirmed on the new auth tests
- `tsc --noEmit` (functions) + `npm run build`: clean
- Live probe `options-auth-guard-1437.ts`: **12/12 PASS** against prod
  post-deploy (4 callables × anonymous / garbage / authed-malformed)

## Scope

Reviewed only the #1437 diff (`git diff` on the nine touched files +
the two new verify files). Foreign working-tree changes — #1402
contract-list picker, #1441 portfolio, #1098 scanner, settlement-pass,
`score-symbols-tmp.ts`, `tmp-probes/` — were excluded from the bundle
and are not findings here.
