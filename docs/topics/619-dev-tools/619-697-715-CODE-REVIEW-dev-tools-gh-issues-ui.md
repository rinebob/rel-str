# CODE REVIEW — #715 FE-IMPL: Topic Viewer visual polish pass

- **Topic:** #619 — DEV-TOOLS: GitHub read-only issue UI
- **Thread:** #697 — Topic Viewer UI polish & misc fixes
- **Task:** #715 — FE-IMPL: Topic Viewer visual polish pass
- **Inventory:** #713 (`619-697-713-INVENTORY-DEV-TOOLS-gh-issues-ui-topic-viewer-polish.md`)
- **QA:** #718
- **Date:** 2026-09-30
- **Verdict:** PASS

## Surface under review

| File | Change |
|---|---|
| `src/app/features/topic-viewer/topic-viewer-tree.component.ts` | Tree row layout, stage colors, depth guides, caret alignment + touch-target |
| `src/app/features/topic-viewer/topic-viewer-page.component.ts` | Header, left pane (430px, dot indicators, `Topic:` prefix strip), context header, banners, a11y |
| `src/app/features/topic-viewer/topic-viewer-tree.component.spec.ts` | Indent assertion, expandableIds stub, new coverage |
| `src/app/features/topic-viewer/topic-viewer-page.component.spec.ts` | New coverage (h1, prefix strip, stage dot, aria-current) |
| `src/app/features/topic-viewer/topic-viewer.store.ts` | Dead `toggleShowClosed()` removed |
| `shared/lifecycle-tree.ts` | Shared `stageOrdinal()` helper |

Pure presentation — no service, contract-shape, or backend changes. Read-only behavior preserved.

## Axes summary

### Standards
One major (component file size / inline-template convention) — **accepted**: repo practice has drifted to inline templates at this size (~44 components incl. comparable feature code); the standard doc is stale relative to convention, not the other way around. Minors all fixed (dead filter, duplicated predicate, spec casts, dead store API).

### Spec (inventory items 1–11 + user requirements)
**ALL MET.** Verified per-item with line evidence: chip soup resolved (flex+ellipsis, noise-label filter, task badges suppressed), context header, depth guides, stage color-coding, 430px left pane, chip-free left rows with stage dot, `Topic:` prefix strip, `Topic Viewer` heading, header wrap, banner/empty styling. Read-only preserved — zero mutation affordances.

### Thermo-nuclear
Two majors found and fixed (see below). Minors/nits fixed or accepted.

## Findings fixed during review

- **Major — missing `data-stage="4"` chip rule** (tree). `4_BACKLOG` nodes rendered default grey while the left-pane dot colored stage 4. Added a muted blue-grey rule — deliberately near-neutral for the backlog stage.
- **Major — 48px touch-target bleed** (tree). `mat-icon-button` renders a 48px `.mat-mdc-button-touch-target` inside the 24px caret, overflowing ~8px into adjacent rows and swallowing their clicks. Disabled via the documented token `--mat-icon-button-touch-target-display: none` (verified against installed Material 20.2 sources).
- **Fixed — guide lines 0.5px left of caret center**: `background-position` 11px → 11.5px (ancestor caret center = `20*depth + 12`).
- **Fixed — duplicated stage-ordinal logic** (regex vs `split`): shared `stageOrdinal()` exported from `shared/lifecycle-tree.ts`; both components use it.
- **Fixed — `hasVisibleChildren` mirrored `expandableIds`**: caret predicate now delegates to the store's set (provably equivalent for rendered rows).
- **Fixed — a11y**: `aria-current` on selected topic row; stage label exposed to AT via `.sr-only` text (dot stays decorative).
- **Fixed — dead code**: `l !== node.stageLabel` filter (decodeLabels already strips); `data-node-type`/`data-type` attributes (zero consumers); `toggleShowClosed()` store method + spec stub.
- **Fixed — `stripTopicPrefix`**: em-dash added to separator class; "Topical:"/"Topics:" correctly not stripped (verified).
- **Fixed — spec hygiene**: impossible fixture shape (`stageLabel` also inside `labels`), `as unknown as` cast, describe-level signals now reset in `beforeEach`, misleading comment corrected.
- **Fixed — `[style.--guides.px]`** → raw number + `calc(var(--guides,0) * 1px)` (unit suffix on custom-property bindings not reliably supported).
- **Added coverage**: h1 text, prefix strip + stage dot, `aria-current`, `data-stage` ordinal, `--guides` custom property.

### Accepted (nits, documented)
- `.banner.warn` / `.chip.status` hardcode amber hexes — no `--mat-sys-*` warning token exists.
- Stage palettes are raw hex — semantic lifecycle colors with no theme token equivalent; readable under dark theme.
- `toggleShowClosed` removal verified safe — no callers outside its own spec.
- Tree-head link shows raw title (context header intentionally keeps the `Topic:` prefix — it identifies the selected node's GitHub title).

## Verification

- `npx jest src/app/features/topic-viewer --coverage=false` — **4 suites / 34 tests green** (final run after all findings addressed).
- Second-round re-review pass: all fixes verified against Angular Material source; no new functional findings; 3 remaining lows fixed (spec resets, dead API, readonly consistency).

## Gate

PASS → task stays at `7_QA`; QA issue #718 open with UAT checklist.
