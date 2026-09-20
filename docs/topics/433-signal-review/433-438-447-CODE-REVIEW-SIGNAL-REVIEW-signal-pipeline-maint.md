**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #438  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #447  
**Domain:** SIGNAL-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-20  

# Code Review â€” #447: Heal jest-30 spec infra (jasmine shim gaps + fakeAsync/native-async)

## Summary of axes

**Standards** â€” clean. The shim semantics were verified against jest-preset-angular preset sources and jasmine's real CallData contract; `transformIgnorePatterns` correctly preserves the preset default while adding `jose`; the `?.length` template guards match a legitimate `{}` input default; spec fixes follow repo patterns (real `setInput`, `jest.fn()` mocks, typed enums).

**Spec conformance** â€” all five acceptance criteria met:
- `toHaveBeenCalled*` on shimmed `jasmine.createSpy` spies: jest-30 matchers read `fn.mock.calls` natively; the `.calls` surface now returns correct jasmine CallData records, and all 17 `.calls.*` call sites in specs use the shape consistently.
- `objectContaining`/`anything`/`resolveTo`/`rejectWith`: implemented via real jest asymmetric matchers + `mockResolvedValue`/`mockRejectedValue`; usage verified in trading-config, order-execution, order, order-ticket specs.
- `fakeAsync`/`tick` vs native `await`: only two surviving `fakeAsync` usages and both flush legitimate timer/synchronous-observable paths, not promises. Pattern documented in `AGENTS.md` (Testing section) and in `signal-review.facade.spec.ts`'s `flush()` helper.
- Full `npx jest` run green: **107/107 suites, 1446/1446 tests** (plus the user's in-flight `swing-compare` spec green on re-run â€” 108/108).
- Named specs (`signal-review.facade`, `occurrence-decision.store`, `group.store`) remain green and were strengthened, not weakened.

**Thermo-nuclear** â€” no criticals; two majors found and **fixed in-round** (below). The structural recommendation â€” eventually codemod the ~22 jasmine-idiom specs to jest-native and delete the shim â€” is sound but is a follow-up, not part of this heal.

## Findings by severity

### Critical â€” none

### Major â€” found and fixed in-round

- **M1 (fixed):** `autoServiceMock` in the two dashboard specs returned `of([])` for every member â€” `await`-ing a mocked Promise-returning method would resolve to the Observable object, and `await mock` itself would hang (thenable capture). Replaced with a fail-loud proxy: `$`-suffixed methods return `of([])`, other methods return `Promise.resolve([])`, `then`/`catch`/`finally` are guarded. Re-verified both specs green.
- **M2 (assessed, downgraded):** the claim that the jasmine shim is type-invisible is overstated â€” `@types/jest` declares the `jasmine` namespace (`@types/jest/index.d.ts:1511`), so `jasmine.Spy`/`jasmine.createSpy` resolve under `tsc -p tsconfig.spec.json` (verified clean). Residual note: this depends on `@types/jest` continuing to ship the compat namespace â€” a follow-up migration to jest-native removes the dependency.

### Minor

- `jasmine.clock()` was a silent no-op â†’ now throws with a "use jest fake timers" message (fixed in-round).
- `setup-jest.ts` comment incorrectly implied jest-30 matchers consume the CallData shape â€” corrected; the real consumer is spec code calling `calls.*` (fixed in-round).
- `dashboard.component.spec.ts` "should render title" was vacuous â†’ now asserts rendered children (fixed in-round).
- `occurrence-decision.store.spec.ts` fixture used `status: 'ACTIVE' as any` â€” `ACTIVE` isn't a `SignalStatus` member â†’ `SignalStatus.CONFIRMED` (fixed in-round).
- `auth.store.spec.ts` `as any as Router` double-cast â†’ removed (fixed in-round).
- `autoServiceMock` duplicated in two specs â€” acceptable at 2 copies; extract to a shared helper if a third appears.
- Pre-existing (not this task): `trading-config.service.spec.ts:190,201,206` vacuous `expect(true).toBe(true)` (verified unmodified by this change); `option-chain-pct-change.store.spec.ts` six `as never` spy injections. Both are candidates for the inventory doc.

### Nit

- `callThrough` is a semantic no-op on shim spies â€” annotated.
- `mostRecent()` on a never-called spy now returns `{args: []}` (was `{args: undefined}`).
- `createSpyObj`'s third arg (`propertyNames`) ignored â€” zero call sites; documented behavior differs from jasmine.

## Test results

- Full suite: **107/107 suites, 1446/1446 tests green** (one transient suite failure during the run was the user's actively-edited `swing-compare.component.spec.ts` â€” green on re-run).
- `tsc -p tsconfig.spec.json --noEmit` â€” clean.
- Post-fix re-run of touched specs: 6/6 suites, 47/47 tests green.

## Verdict

**PASS.** All acceptance criteria met; both major findings fixed and re-verified in-round; suite fully green. Recommended follow-up (inventory entry): mechanical migration of jasmine-idiom specs to jest-native so the shim can eventually be deleted.
