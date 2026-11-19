**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1620  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Task:** #1623  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# Code Review — FE-IMPL: Range pill UI (#1623)

Scope: `25|50|100` bar-count pills added ahead of the calendar presets in both range pill groups (`chart-view-toolbar` live, `chart-toolbar` hidden parity), toolbar specs for pill set/active-class/emit, plus a late scope addition — `rangesByInterval` defaults revised `D100/W100/M50 → '50'` on every interval (owner decision during UI verification) with all dependent spec assertions and docs updated. Review diff pre-scoped to the task's 7 src files (286 lines); unrelated working-tree changes excluded. IMPL-FE §Sequence/phases item 2.

## First pass complete

Three axes ran in parallel over the scoped diff.

- **Standards** — no critical/major. Minor: `'each chart keeps its selection independently'` writes `'50'` on daily (coincidence-proof under uniform defaults). Nits: `string[]`/`input<string>` mock looseness vs `ChartRange`; `.pill-group.flat[1]` index coupling; pre-existing spec-mock conventions (already dispositioned in #1622 review).
- **Spec** — no critical/major. Minor: the `[selectedRange]`-input binding spec went **vacuous** under uniform `'50'` defaults (passes on any key read — the desync test was correctly inoculated, this spot wasn't). Nits: second `activeRange` '50' assertion non-discriminating; "every union member" comment overpromises; `rangeBarsFor('100')` overshoot pin absent; 1-vs-7 emit-token asymmetry between toolbar specs. Per-criterion accounting: all PRD ACs applicable to this task MET (US-6 short-history deferred — flex-chart-side, out of scope).
- **Thermo-nuclear** — one MAJOR, same finding: the `[selectedRange]` spec lost its only tooth. Minors: view-toolbar highlight test can confuse monthly-with-weekly under uniform `'50'`; stale #1622 UAT doc still asserts D100/W100/M50 (historical record — #1623 UAT must supersede, noted); hand-mirrored pill parity could be a shared const (explicit markup is repo idiom — dispositioned as IMPL-doc decision, not a defect). Nits match Standards axis. Verified clean: TWO_DAY `'50'` coherent (inert, exhaustive key), no hidden `'100'` coupling anywhere, `'recent'` fully gone, new specs assert external behavior.

Convergent finding across all three axes: **uniform `'50'` defaults silently de-fanged four assertions that relied on asymmetric defaults**. The diff correctly inoculated two spots (service desync test `'1y'` marker, single-mode `'25'` write) but missed three.

**In-cycle remediation applied:**
- `signal-detail.component.spec.ts:241` — `[selectedRange]` test now writes `'1y'` on monthly before asserting (restores discrimination; also exercises emit-side wiring).
- `signal-detail.component.spec.ts:211` — weekly `activeRange` assertion now writes `'6m'` marker first.
- `chart-view-toolbar.component.spec.ts:250` — highlight test now seeds `'1y'` monthly + `'25'` daily; asserts `1Y` lit on cell activate.
- `chart-toolbar-state.service.spec.ts:164` — independence test writes `'25'` on daily (was `'50'` = default).
- `chart-toolbar.component.spec.ts` — `emitted` typed `ChartRange[]`.
- `signal-detail.component.spec.ts:57` — mock `input<ChartRange>` (was `input<string>`).
- `signal-detail.component.spec.ts` — added `rangeBarsFor('100') → 100` overshoot pin (TEST-plan edge case).

## Second pass complete

Re-checked the final diff hunk-by-hunk against all three axes' reports: every hunk (template pill blocks, service defaults + comment, all spec updates) is covered by at least one axis; no error paths exist in this surface (pure bindings); every captured finding is remediated or dispositioned. Remediation verified on the final diff — the four vacuous/coincidence-proof assertions now carry non-default markers identical to the pattern the author established. Remaining nits are dispositioned: DOM-order index lookup (existing spec idiom), emit-token asymmetry (pill-set test proves all 7 exist; single emit pin is sufficient), stale #1622 UAT numbers (completed per-task record — the #1623 UAT will document final behavior), shared-const pill refactor (explicit markup is the established idiom; IMPL doc records the decision).

## Test results

- Targeted: `chart-toolbar-state signal-detail chart-view-toolbar chart-toolbar` — **67/67** (4 suites; includes the added `'100'` pin).
- Full suite: **6116/6116**, 324 suites (jest emitted its pre-existing worker-teardown warning; no functional failures).
- `tsc --noEmit` — clean on touched files (unrelated pre-existing errors in `scripts/bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts` — other sessions' work).

## Verdict: PASS

Major finding remediated in-cycle and spec-pinned; minors taken or dispositioned; no critical/major findings remain on the final diff. Task advances to `7_QA`.

Notable disposition for QA: the completed #1622 UAT doc asserts the old D100/W100/M50 defaults — correct as a point-in-time record. The #1623 UAT must use the final expectations (every chart opens at `'50'`, `50` pill lit on the active chart) and supersede those scenario values.
