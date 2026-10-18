# UAT — #1041 FE `/dev/ds` gallery (element showcase + provenance)

QA checklist for #1041, per CODE-REVIEW `1024-1031-1041-…`. QA issue: #1091.

## Verdict — COMPLETE

## Scenario log

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| S1 | `/dev/ds` route loads under `authGuard` | `core-routes.ts` lazy `loadComponent` block; `core-routes.spec.ts` route↔`PAGE_INFO` parity; relay route-wiring checks | PASS |
| S2 | Every seeded element renders via `savant-ds` | `@use 'index' as ds`; `ds.*` mixin includes; zero local `@mixin` bodies; live sass compile of the component SCSS through real includePaths | PASS |
| S3 | `seen in:` provenance on every card | 12 entries, each `seenIn[]` rendered as footer; relay pins the contract | PASS |
| S4 | Dark toggle flips `[data-theme]` | Spec asserts host attr flip; resolved `--ds-shadow-1/2` displayed via `getComputedStyle` | PASS |
| S5 | `index*` shadow guard | Planted `_index.scss` under `ds-gallery/` → relay FAILs (guard + `Undefined mixin` reroute); removed → green | PASS |
| S6 | Package consumption regression | `design-system-consumption-1039` green (EOL-normalized vendor drift check); all 9 DS relays green | PASS |

## Evidence

- Relay `design-system-ds-gallery-1041.ts`: **37 checks / 0 failures**
- Jest: `ds-gallery` + `nav-sections` + `core-routes` — **129/129**
- `npm run build` — green (18.9s); only pre-existing `UpperCasePipe` warning in `GalleryTicketDialogComponent`
- DS relay battery: #1034, #1035, #1036, #1037, #1038, #1039, #1040, #1052, #1041 — all `ALL CHECKS PASSED`
- `tsc --noEmit` — clean
