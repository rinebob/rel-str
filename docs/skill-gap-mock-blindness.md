# Skill Gap: Mock Blindness and Contract Verification

**Origin:** Task #334 (Swing Analysis Store) in the rel-str project. A code
review caught 3 critical, 5 major, and 8 minor/minor findings after TDD
"passed" with 16/16 green tests. The root causes are skill-level gaps that
affect every consumer of the `tdd`, `code-review`, and implementation skills.

## The incident

A SignalStore was implemented with TDD. The store delegated Firestore
persistence to a `SwingAnalysisService`. Tests mocked the service at the
store seam (correct for store logic) and also mocked `@angular/fire/firestore`
at the module level (incorrect for service contract validation).

All 16 store tests passed. The review found:

- **3 critical:** Firestore `collection()` and `doc()` paths had invalid
  segment counts — `collection(firestore, 'zig-zags', sym)` (2 segments,
  needs odd) and `doc(firestore, 'zig-zags', symbol, paramsId)` (3 segments,
  needs even). These throw at runtime. No test caught them because
  `jest.mock('@angular/fire/firestore')` replaced `collection`/`doc` with
  no-op stubs that accept anything.
- **5 major:** `this` context misuse in SignalStore methods, no `error`
  state, no request cancellation (race conditions), `saveAnalysis` tests
  that only asserted "does not throw" without verifying the service was
  called with the correct payload, and flaky `setTimeout`-based async
  tests.
- **8 minor:** unnecessary `runInInjectionContext`, `as never` type casts
  masking real contracts, duplicate `deriveParamsId` calls, converter
  + `idField` double-assignment, missing `bars` restoration on
  `loadAnalysis`, etc.

The implementation plan itself specified an invalid Firestore path
(`zig-zags/{symbol}/{paramsId}` — 3 segments for a doc). The plan was
followed without verifying against existing service patterns in the repo.

## Root causes

### 1. Mock blindness — `tdd/mocking.md`

**The gap:** The mocking guide says "mock at system boundaries" and "don't
mock things you control." It doesn't address the case where a service
*wraps* an external SDK. When you mock the service to test the store, the
service's own contract with the SDK is never validated. The mock accepts
any arguments; the real SDK rejects them at runtime.

This is distinct from "don't mock things you control" — the service *is*
something you control, so you shouldn't mock it in the service's own tests.
But when testing the store, you *should* mock the service. The problem is
that mocking the service at the store seam makes the service's SDK contract
invisible, and nothing in the skill docs says "you still need to test that
contract separately."

**Proposed addition to `tdd/mocking.md`:**

```markdown
## Mock blindness — when the wrapper is the bug

Mocking a service that wraps an external SDK hides contract bugs in the
wrapper itself. The store tests pass because the mock accepts anything;
the real SDK rejects the call at runtime.

When the seam under test delegates to a service that wraps an external
system (Firestore, HTTP, Stripe, S3), the service's contract with the SDK
is not covered by the store tests. Add at least one of:

1. **A contract test for the wrapper** — test the real service against
   the real SDK (or emulator) without mocking the SDK. This catches
   invalid paths, wrong auth, malformed payloads.
2. **A spy on the SDK calls** — if a full integration test is too heavy,
   spy on the SDK functions (`doc`, `collection`, `setDoc`) and assert
   the path arguments match the expected contract. Don't replace them
   with no-op stubs that accept anything.
3. **A verification script** — run the real service against the real
   environment (see `proj-implement` step 3).

The rule: **mocking the service is fine for testing the store's logic,
but it never validates the service's own contract with the SDK.** That
contract needs its own test or verification.
```

### 2. Prior-art verification — missing from implementation guidance

**The gap:** The implementation plan specified an invalid Firestore path.
The plan was followed without reading existing service patterns in the
repo. A 30-second read of `chart.service.ts` would have shown the correct
segment-count pattern (`doc(firestore, 'symbol-data', symbol, 'weekly', 'all')`
— 4 segments for a doc).

The `tdd` skill says "read `CONTEXT.md`" for domain language. The
implementation skills say "follow the implementation plan." Neither says
"verify external SDK contracts against existing code in the repo before
writing new calls to that SDK."

**Proposed addition to `tdd/SKILL.md` (or a new `prior-art.md`):**

```markdown
## Verify external contracts against prior art

Before writing code that calls an external SDK (Firestore, HTTP, Stripe,
S3), read an existing service in the repo that calls the same SDK. The
implementation plan may specify a path, endpoint, or payload shape — but
the plan is not the source of truth for the SDK's contract.

- **Firestore paths:** collection references need an odd number of
  segments; document references need an even number. Verify against
  an existing service before writing new path construction.
- **HTTP endpoints:** verify the URL, method, and payload shape
  against an existing callable or API client.
- **Plan vs. reality:** if the plan's path/endpoint/contract differs
  from what the SDK requires, fix the plan and the code. Do not
  follow the plan blindly.

This is not "research before coding" — it's a 30-second check against
existing patterns. Search the repo for `doc(this.firestore` or
`collection(this.firestore` and read one result before writing your own.
```

### 3. Test quality discipline — `tdd/SKILL.md` and `tdd/tests.md`

**The gap:** Several test anti-patterns slipped through:

- **`as never` type casts** — `interval: 'DAILY' as never` and
  `magnitudePercent: {} as never` masked real type contracts. The
  existing skill says "tests verify behavior through public interfaces"
  but doesn't address type-assertion discipline.
- **`setTimeout`-based async tests** — 9 tests used `setTimeout(..., 50)`
  to wait for synchronous-of() observables. Non-deterministic and
  flaky. The skill doesn't prescribe async test patterns.
- **"Does not throw" as the only assertion** — `saveAnalysis` tests
  only asserted no throw, not that the service was called with the
  correct payload. The skill says "tests read like a specification" but
  doesn't call out this specific anti-pattern.

**Proposed additions to `tdd/SKILL.md` anti-patterns section:**

```markdown
- **Type-erased** — uses `as never`, `as any`, or `as unknown as` to
  bypass the type system in test fixtures. The test compiles but the
  fixture doesn't match the real contract. Use real enum values and
  typed builder functions instead. If the type is hard to construct,
  that's a signal the production type needs a factory or builder, not
  that the test should cast.

- **No-assert** — the test only asserts "does not throw" or "returns
  undefined" without verifying the side effect (service called with
  correct args, state patched correctly, event emitted). A no-assert
  test passes even if the method is a no-op. Every test must assert
  at least one observable outcome beyond "didn't crash."

- **Timing-dependent** — uses `setTimeout` or `sleep` to wait for
  async operations instead of deterministic async primitives
  (`fakeAsync`/`flush`/`tick`, `await`, `Subject` for deferred
  emission). Timing-based tests are flaky and non-portable.
```

### 4. Implementation checklist gaps — coding guidelines

**The gap:** The rel-str coding guidelines have an "LLM implementation
checklist" (section 10) that covers file size, duplication, `any`, dead
code, security, atomic writes, and regression tests. It doesn't cover
external contract verification or type-assertion discipline.

**Proposed additions to the implementation checklist:**

```markdown
- [ ] External SDK calls (Firestore, HTTP, Stripe) verified against
      existing service patterns in the repo — not just the
      implementation plan.
- [ ] No `as never`, `as any`, or `as unknown as` type assertions
      that mask real type contracts. Use real enum values and typed
      fixtures.
- [ ] When a service is mocked in tests, the service's own contract
      with its SDK is tested or verified separately.
- [ ] Async tests use deterministic primitives (fakeAsync, await,
      Subject) — not setTimeout.
```

### 5. Code review axis coverage — `code-review/SKILL.md`

**The gap:** The code review skill runs Standards, Spec, and
Thermo-nuclear axes. All three caught the Firestore path bug, but only
because the reviewers happened to know Firestore's segment rules. There's
no explicit instruction to verify external SDK contracts during review.

**Proposed addition to the Standards or Thermo-nuclear axis guidance:**

```markdown
### External contract verification

When the code under review calls an external SDK (Firestore, HTTP,
Stripe), verify:

- The call arguments match the SDK's contract (e.g., Firestore path
  segment counts — collections odd, documents even).
- The call pattern matches existing services in the repo that call
  the same SDK.
- The implementation plan's specified contract matches the SDK's
  actual contract. If they differ, flag it — the plan may be wrong.

If the code mocks the SDK in tests, check whether the service's
contract with the SDK is tested or verified separately. A mock that
accepts anything hides contract bugs.
```

## Summary of proposed changes

| Skill doc | Change | Status |
|-----------|--------|--------|
| `tdd/mocking.md` | Add "Mock blindness" section on wrapper-contract testing | **Applied** |
| `tdd/SKILL.md` | Add "Verify external contracts against prior art" section | **Applied** |
| `tdd/SKILL.md` | Add `Type-erased`, `No-assert`, `Timing-dependent` anti-patterns | **Applied** |
| Coding guidelines (implementation checklist) | Add 4 checklist items for external contracts, type assertions, mock coverage, async test patterns | **Applied** |
| `code-review/SKILL.md` | Add "External contract verification" to review axis guidance | Pending (rb-skills) |

## Why this matters

The #334 incident is not unique to rel-str. Any project that uses TDD
with mocked services wrapping external SDKs has the same blind spot.
The store tests pass, the review catches the bug, and the fix cycle
repeats. The skill docs should prevent the bug from being written in the
first place — that's cheaper than catching it in review.
