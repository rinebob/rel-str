# Thermo-Nuclear Code Review: Chart-Review Component (2025-07-14)

## Commit 2 Files Reviewed
- `src/app/features/rh-agent/pages/chart-review/chart-review.component.ts`
- `src/app/features/rh-agent/pages/chart-review/chart-review.component.html`
- `src/app/features/rh-agent/components/signal-list/signal-list.component.ts`
- `src/app/features/rh-agent/components/signal-list/signal-list.component.html`
- `src/app/features/rh-agent/components/review-header/review-header.component.ts`
- `src/app/features/rh-agent/components/review-header/review-header.component.html`
- `src/app/features/rh-agent/components/signal-detail/signal-detail.component.html`

---

## Findings

### 1. [HIGH] `onPrevSymbol`/`onNextSymbol` navigate wrong list (bug)

**Problem:** Both methods use `triageStore.reviewSymbols()` (all flagged symbols) instead of `viewportSymbols()` (filtered by mode+list). In browse mode or with a list filter, prev/next jumps to symbols not visible in the sidebar.

**Fix:** Replace `this.triageStore.reviewSymbols()` with `this.viewportSymbols()` in both methods.

**Status:** [x] DONE

---

### 2. [MEDIUM] Auto-select effect uses wrong list

**Problem:** The auto-select-first-symbol effect reads `this.triageStore.reviewSymbols()` instead of `this.viewportSymbols()`. Auto-selected symbol may not be visible in the sidebar when a list filter is active.

**Fix:** Use `this.viewportSymbols()` so the auto-selected symbol matches the sidebar contents.

**Status:** [x] DONE

---

### 3. [LOW] `signal-list.component.ts` — `uiState` not renamed to `uiStateService`

**Problem:** `chart-review` renamed `uiState` → `uiStateService` for clarity, but signal-list still uses `uiState`. Inconsistent naming within the same feature.

**Fix:** Rename to `uiStateService` in signal-list component TS and HTML.

**Status:** [x] DONE

---

### 4. [LOW] `signal-detail.component.html` uses `uiState` (not `uiStateService`)

**Problem:** Template references `uiState.chartLayout()`, `uiState.fullscreen()`, etc. Same inconsistency.

**Fix:** Rename in signal-detail component TS and HTML.

**Status:** [x] DONE

---

### 5. [LOW] Thin computed wrappers add pointless indirection

**Problem:** `viewportSymbols`, `viewportMode`, `activeReviewList` are identity wrappers around the service's signals — `computed(() => this.viewportService.viewportSymbols())`. Adds an extra signal layer for no gain.

**Fix:** Assign the signals directly: `readonly viewportSymbols = this.viewportService.viewportSymbols;`

**Status:** [x] DONE

---

## Future Work

### 6. [LOW] `advanceReviewQueue` assumes decided symbol leaves the viewport immediately

**Problem:** After an ACR decision, `advanceReviewQueue` filters the decided symbol out of `viewportSymbols()` to find the next selection. But setting an ACR status does NOT remove the review flag — the symbol stays in the viewport. The local `remaining` array doesn't match actual viewport state, causing the selection to jump forward even though the symbol is still visible.

**Fix:** Either (a) auto-unmark from review when an ACR is assigned, or (b) simplify to just move to `idx + 1` without filtering since the symbol won't disappear.

---

### 7. [LOW] `signal-detail` chart store data aliases are identity wrappers

**Problem:** `chartData`, `chartDataWeekly`, `chartDataMonthly`, `chartLoading` in signal-detail are `computed(() => this.chartStore.foo())` — same zero-value indirection pattern that was removed from chart-review.

**Fix:** Assign directly: `readonly chartData = this.chartStore.dailyData;`
