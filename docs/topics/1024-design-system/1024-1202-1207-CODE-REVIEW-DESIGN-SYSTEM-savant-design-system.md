**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1202  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1207  
**Domain:** DESIGN-SYSTEM  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# CODE-REVIEW — #1207 FE: data-theme bootstrap + ThemeService + header toggle

## Verdict

**PASS** — converged after one remediation round + one re-attack.
Round 1: Standards PASS, Spec PASS (4/4 ACs), Thermo 1 MAJOR (M1)
which the user explicitly accepted before this review — "the colors
are way off right now… that's ok as long as we know about it… keep to
the plan" — because the alternate fix IS the next task in the plan
(#1209, the dark `--mat-sys` bridge; the IMPL doc's "should land
together" note). Recorded as an accepted bound below, not dropped.
Round 2 re-ran all three axes on the post-remediation state: **all
three PASS, no new real defects** — the only residuals are the
documented accepted bounds. Two LOW test-hygiene suggestions from
round 2 were folded in (spy-invocation assertions kill a vacuous-pass
mutation; `afterEach` mock restore). Full core suite 328/328, focused
27/27, relay 21/21.

## Scope

Files belonging to #1207:

- `src/index.html` — synchronous inline `<head>` bootstrap: reads
  `localStorage['savant-theme']`, defaults `'dark'`, writes
  `document.documentElement.dataset.theme`, try/catch — before
  `<app-root>` and any deferred module bundle.
- `src/app/core/services/theme.service.ts` — NEW. Root-provided,
  signal-backed: `theme()`, `set()`, `toggle()`; dual effect writes
  `data-theme` + persists; corrupt → dark; storage throws tolerated;
  no `prefers-color-scheme`.
- `src/app/core/services/theme.service.spec.ts` — NEW. 8 specs.
- `src/app/core/comps/header/header.component.{ts,html,spec.ts}` —
  injects `ThemeService`, theme toggle icon button, 2 new specs.
- `scripts/verify/design-system-theme-plumbing-1207.{ts,md}` — NEW.
  21-check static relay incl. the single-writer invariant scan.
- `scripts/verify/README.md`, `scripts/verify/run-all.ts` — index row
  + registration.

Not in scope: the user's in-flight scanner (#1199) / order-ticket /
paper-trading WIP elsewhere in the tree.

## Standards axis — PASS

No CRITICAL/MAJOR. Verified: single-writer invariant holds; bootstrap
and `resolveStoredTheme()` are semantically identical (no value-set
drift); `data-theme="light"` falls through to `:root` light values —
harmless, no `[data-theme="light"]` selector exists; no XSS vector
(strict `=== 'light'` compare); service shape matches
`ui-state.service.ts` precedent; spec conventions match jest era
(`jest.fn()`, no jasmine APIs); `TestBed.resetTestingModule()` in
`beforeEach` is *required* (root-provided service caches across tests);
run-all.ts + README registrations match house style.

- **MINOR (fixed):** the two storage-throw branches —
  `getItem` throws (private mode) and `setItem` throws (quota) — were
  the only documented seams without coverage (`sandbox-settings.spec`
  precedent exists). Added two specs spying `Storage.prototype`;
  verified: `getItem` throw → dark, `setItem` throw → attribute still
  flips. 6 → 8 specs.
- **MINOR (noted):** the inline `<script>` is CSP-fragile by nature —
  must stay inline (a `src=` file defeats the pre-paint guarantee);
  no CSP exists in the project today. If one is ever added, this
  script needs a hash/`script-src` exception.
- **NIT (fixed):** relay writer-exemption `rel.includes('theme.service.ts')`
  would also exempt `foo-theme.service.ts`/`.bak` — now resolves to
  `f === THEME_SVC` (and `f === INDEX_HTML`).
- **NIT (fixed):** spec comment claimed the icon "mirrors the CURRENT
  theme" — the code shows the TARGET (`light_mode` under dark), the
  conventional affordance; comment corrected.
- **NIT (noted):** relay `signal()` check's second disjunct subsumes
  the first and could match comments — adequate for a static relay.
- **NIT (accepted):** pre-existing dead `// console.log…` comment at
  `header.component.ts:39` — predates #1207; opportunistic cleanup
  candidate only, left alone.
- **FYI:** `applyAttribute` touches `document` unguarded — would
  `ReferenceError` under SSR. SSR is disabled and `main.ts:10`'s note
  references `angular.json` keys that don't exist (pre-existing stale
  comment). Every neighboring service has the same exposure.

## Spec axis — PASS

| AC | Verdict | Evidence |
|---|---|---|
| Cleared storage → dark first paint, no flash | MET | `index.html:11-23` inline IIFE in `<head>` before `<app-root>`; default `'dark'`; synchronous before deferred bundle |
| Toggle flips live + persists | MET | `header.component.html:20-23` → `theme.toggle()`; service writes attribute + storage; bootstrap re-reads on reload |
| Corrupt value → dark, no throw | MET | `=== 'light'` compare + try/catch both layers; spec asserts no-throw |
| Spec covers default/persist/attribute/toggle/corrupt | MET | 8 specs, all dual-seam assertions |

- Bootstrap/service value sets identical — no drift.
- `data-theme="light"` vs token model confirmed harmless
  (`_tokens.scss`: `:root` light, `[data-theme='dark']` overrides only).
- R1 ("before the app bundle") is satisfied structurally — inline head
  script always runs before deferred module bundles; the relay asserts
  the verifiable proxy (inline-in-head, before `<app-root>`) since
  `index.html` source contains no bundle tag to order against.
- Single-writer boundary enforced statically by the relay (walks
  `src/`, fails on any writer besides index bootstrap/service/specs).

## Thermo-nuclear axis — one MAJOR + minors

### M1 — MAJOR → user-accepted bound

**Dark default ships before the dark `--mat-sys` bridge exists.**
`index.html` + `DEFAULT_THEME = 'dark'` mean every user gets
`data-theme="dark"` on first paint. `[data-theme='dark']` selectors
exist for `--ds-*` tokens (`_tokens.scss:115`) and
`--theme-surface`/`--theme-on-surface` (`_variables-global.scss:10-13`,
consumed by ~12 live components — rs-table, heatmaps, dashboard-v2/v3,
login, signup, scrollbars), so those go dark immediately — while the
`--mat-sys` block in `styles.scss` is light-only and `indigo-pink` is
light-only → mixed dark/light app until #1209 lands. Deterministic
default path, not an edge case; `_tokens.scss:16-19` and the IMPL doc
both warn the pair should land together.

**Disposition: accepted bound, explicit user sign-off 2026-10-22**
("the colors are way off right now… that's ok as long as we know about
it… keep to the plan"). The dark default is itself an acceptance
criterion (AC1 requires dark on cleared storage), so the only true
fix is shipping #1209 next — the header toggle restores light
regardless. Sequencing, not a code defect: the plumbing itself is
clean per all three axes.

### Minor

- **m2 (real, deferred):** the /dev/ds gallery *light* preview breaks
  under app-dark — the host binds `[attr.data-theme]` only when dark,
  so under app-dark the dark `--ds-*` values inherit through `<html>`
  even when the preview toggles "light" (the deliberate non-redeclare
  of `--ds-*` was written before anything set the attribute app-wide).
  Dev-page only. Defer to the explorer phase (#1211 lane): either the
  token layer gains an explicit `[data-theme='light']` block or the
  preview surface re-declares the light set.
- **m1 (latent):** service constructor `applyAttribute` touches
  `document` unguarded — `ReferenceError` if SSR is ever re-enabled
  (`main.ts:10` documents the intent). Disabled today; same exposure
  as every neighboring service.
- **m3 (fixed):** spec coverage gap on both storage-throw paths —
  closed with the two `Storage.prototype` spy specs (Standards MINOR-1).

### Nits / non-findings

- Relay single-writer regex is evadable (`document.querySelector('html').setAttribute`,
  indirect refs) — acceptable as a smell-check, not an invariant
  guarantee; recorded, no change.
- Verified non-findings: no injection-context issue; no bootstrap/
  service race (both synchronous, same thread); no multi-instance
  (`providedIn: 'root'`, no duplicate providers); overlay inheritance
  safe; spec quality clean (no type-erased fixtures, tautologies, or
  timing dependence).

## Round 2 — re-attack of the post-remediation state

All three axes re-verified the round-1 fixes hold and found **no new
real findings**:

- New specs confirmed non-vacuous under the catch-removal mutation
  (both exercise the intended try/catch branches); `Storage.prototype`
  spies cannot leak cross-file (per-file jsdom); `DOMException` is
  available in the jest env; `localStorage.clear()` never traverses
  the mocks.
- Relay exemption `f === INDEX_HTML || f === THEME_SVC` produces
  byte-identical path comparisons to `walk()` output; the `.spec.ts`
  exemption cannot mask a production writer; live grep confirms the
  only `data-theme` touchers remain the three sanctioned files.
- `.js`/`.tsx` files are outside the walk's `.(ts|html)` filter —
  theoretical gap, subsumed by the already-accepted regex-evadability
  bound (`src/assets/sf-debug.js` verified clean).

Round-2 LOW findings folded in:

- Spy-invocation assertions added (`expect(spy).toHaveBeenCalled()`) —
  closes the access-removal vacuous-pass mutation.
- `afterEach(() => jest.restoreAllMocks())` added — a mid-test throw
  can no longer leak a prototype mock into later specs in the file
  (matches `gallery-chart-mount-queue.service.spec.ts` convention).

## Test results

- `npx jest` full suite: **259/259 suites, 4449/4449 tests green**
  (run before the two new specs; they add 2 → 4451 on next run —
  focused re-run 27/27 confirms).
- Focused post-fix: `theme.service.spec` + `header.component.spec`
  27/27.
- Relay: **21/21** after the writer-exemption fix.
- Live: both running dev servers (ports 4200/4210) rebuilt — served
  `index.html` contains the bootstrap; preview opened for visual
  confirmation.

## Accepted bounds

- **M1** (above) — mixed dark-DS/light-Material render until #1209;
  user-accepted, the plan's own sequencing.
- Inline bootstrap is CSP-fragile by design — pre-paint requirement;
  revisit only if CSP lands.
- SSR latent exposure — consistent with neighbors; SSR disabled.
- Relay's single-writer scan is a smell-check, not a proof.

## UAT note

QA should exercise: first-paint dark on cleared storage (no light
flash), toggle persistence across reload, corrupt-value fallback via
DevTools (`localStorage.setItem('savant-theme','banana')`), and the
/dev/ds light-preview regression check (known-deferred — confirm the
flag, don't re-file it).
