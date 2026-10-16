**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1029  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# Test Plan: ST consumption + /dev gallery + SA smoke (FE)

## E2E User Journeys
- Gallery: user navigates to `/dev/ds` → sees every element group rendered
  (tokens, spacing, type, elevation, page shell, dialog states, banner,
  badges) → each card shows its "seen in" provenance footnote.
- Dark theme: user toggles `data-theme="dark"` → token swatches/patterns
  re-render under dark values.
- SA smoke: SA app builds and renders the one savant-ds-consuming element.

## Integration Tests
- `DsGalleryComponent` spec (TestBed): renders the element entries array,
  shows each card + "seen in" footnote. Firebase injection tokens stubbed
  per `AGENTS.md` convention (`{ provide: Firestore, useValue: {} }` etc.)
  if the component pulls config.
- Consumption smoke at build level: `npm run build` green in rel-str proves
  includePaths + `file:` resolution; `ng build` green in av-proxy-api proves
  the SA side. These are compile-seam checks, not jest specs.
- `_pd-visual-language` delegation: a sass-compile check (same verify-script
  pattern) that a fixture `@use`ing the shim still exposes
  `vl.page-shell`/`vl.dialog-chrome`/`vl.dialog-status`/`vl.error-banner`.
- Existing dialog specs (close-position, stop-loss, order-confirm) must
  stay green after the mixin extraction — they are the regression net.

## Unit Tests
- Gallery entry array shape (name/kind/seenIn present on every entry).

## Test Seams
- Highest seam: `npm run build` in both apps (real Angular pipeline, real
  package resolution).
- Lower seam: `DsGalleryComponent` TestBed spec; offline `scripts/verify/`
  compile checks.

## Existing Test Coverage
- `close-position-dialog`, `stop-loss-dialog`, `order-confirm-dialog` specs
  exercise the refactored mixins — they are the pre-existing coverage the
  extraction must not break.
- `scripts/verify/run-all.ts` gains the new design-system verify entry.

## Edge Cases
- `npm install` in rel-str before savant-ds exists → clear README + task
  ordering prevents it; the failure mode is a broken `file:` symlink.
- `node_modules/savant-ds` copied instead of linked → gallery still renders
  but edits don't propagate; README warns.
- Gallery under `authGuard` — unauthenticated visit redirects like other
  dev routes (consistent, not a bug).
- Dark theme: every tokenized element has a dark value or an explicit
  light-only justification in the catalog.
