# Verification guide — #1675 (IBS computeIbs + availability)

**Task:** #1675 — SHARED: computeIbs + availability (`shared/st-ibs.ts` + `@st/ibs` alias)
**Script:** `indicator-lib-ibs-1675.ts`
**Env:** none — pure contract surface, read-only, no Firestore, no ADC.

## `indicator-lib-ibs-1675.ts`

```bash
cd functions && npx tsx scripts/verify/indicator-lib-ibs-1675.ts
```

**Flags/args:** none.

**What it verifies:**

1. `@st/ibs` alias — the script imports `computeIbs` through the
   functions/tsconfig paths mapping, so it only runs if the backend can
   resolve `shared/st-ibs.ts` via the alias.
2. Value semantics — `(C-L)/(H-L)` on literal bars: interior close → 0.8,
   high/low/midpoint → 1.0/0.0/0.5, zero-range → 0.5, inverted range → 0.5.
3. Daily availability (injected `now`) — same-day bar `undefined` before
   12:00 ET default, defined at the 12:00 boundary and after; yesterday-
   dated and future-dated bars always defined; `activateAtEtMin` override.
4. Weekly availability (injected `now`) — current-week bar `undefined`
   Mon/Tue, defined Wed (default `activateAtWeekday` = 3) onward;
   prior-week bar always defined; `activateAtWeekday` override.
5. Sunday monotonicity — a current-week bar on Sunday ET is defined
   (weekday gate treats Sunday as the trading-week tail, `0 → 7`).
6. Real wall-clock — `computeIbs` invoked with **no** `ctx`; the script
   derives the expected result from its own independent ET clock read
   (Intl `America/New_York`) and asserts agreement for a today-dated D
   bar and a this-week W bar.

**Passing:** `=== 20 passed, 0 failed ===`, exit code 0.
**Failing:** any `FAIL` line names the broken check; exit code 1.

**Notes:** the real wall-clock section is time-dependent by design — run
before 12:00 ET on a Mon/Tue and the "today-dated" checks legitimately
report `undefined`; that is correct behavior, not a failure.
