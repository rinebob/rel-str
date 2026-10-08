# Code Review — FE: Gallery metered chart-mount queue (#860)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #860  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Review — 2026-10-07 (round 1 — GATE PASS after remediation)

Scope: `GalleryChartMountQueueService` (new root injectable — FIFO
per-frame mount grants via `requestAnimationFrame`), the
`GalleryCardChartComponent` mount/window/grant rework, and the per-leaf
computed storm fix that preceded it in the same diagnosis.

**Verdict: PASS after remediation.** Spec: all three acceptance criteria
verified (paced first paint, immediate unmount / paced remount, grant
invalidation). Standards: PASS — its one "Critical" (rAF `spyOn` allegedly
unsupported under this jsdom config) was empirically falsified — the spec
suite ran green before and after. Thermo: one Major + one Minor found,
fixed, and re-verified; a second re-review confirmed both fixes and
surfaced only one Low latent window, hardened.

### Majors/minors — fixed

- **T1 (thermo, major) — dead grants consumed the whole frame budget.**
  A card queued then scrolled off before its frame still burned the
  one-per-frame slot — under sustained scroll, stale backlog starved
  live cards. Fixed: queue entries carry an optional `stillValid`
  predicate re-checked at flush; dead entries are skipped WITHOUT
  consuming the budget. Component passes
  `grantTicket === ticket && inWindow && data-ready`.
- **T2 (thermo, minor) — queue paced the `mounted` flag, not the mount.**
  A grant taken while `loading` flipped `mounted` early; when bars
  landed, `<app-flex-chart>` instantiated inside the data patch's CD
  pass — a refresh burst could coalesce K mounts in one pass, outside
  the queue. Fixed: `mounted` is now `computed(inWindow && granted)`;
  a grant is only *requested* by an effect when
  `inWindow && bars?.length > 0 && loadError === null`, and every
  `!want` transition revokes the grant and bumps the ticket. First
  mount, scroll remount, and post-data-arrival mount all require a
  live grant — re-verified: no bypass path exists in the template.
- **S1 (spec, latent) — re-entrant `request()` mid-flush could arm a
  second frame.** Unreachable today (grants never re-queue) but one
  future caller away from a cap violation. Fixed: `finally` guard
  `pending.length && !scheduled` — also covers a throwing grant
  stranding the queue.

### Thermo re-review — new findings

- **NF1 (low, hardened)** — `stillValid` initially re-checked only
  ticket + `inWindow`; the ticket only advances when the effect runs,
  leaving a theoretical pre-flush window where a store patch could
  grant a mount that produces nothing. Unreachable under zone-based
  CD (a tick runs between consecutive rAF callbacks), but now
  self-contained: the predicate re-checks the full `want` condition.
- **NF2 (trivial, logged)** — `granted` is read and written by the
  same effect; a `want→false` transition runs it twice and
  double-bumps `grantTicket`. Converges immediately, harmless.
- **NF3 (trivial, logged)** — destroy-with-pending-grant and
  error-arrival-revoke lack direct component-level assertions; the
  `stillValid` mechanics are covered at the service level and the
  stale-run no-op is exercised via captured-grant invocation.
- **NF4 (observation, intended)** — an interval flip to an uncached
  lane now unmounts and re-paces (placeholder → fetch → grant →
  remount) rather than holding the stale chart during the fetch.
  Deliberate — consistent with unmount-on-exit semantics.

### Verification

- Queue + chart specs: 37/37 — incl. dead-grant skip is budget-free,
  throwing grant re-arms via `finally`, mid-flush ordering, no grant
  requested while bars pending, grant-gated mount, stale-grant no-op.
- Gallery suite: 220/220.
- `tsc -p tsconfig.app.json`: clean in scope (pre-existing foreign
  errors in `scripts/bulk-swing-sweep.ts` and
  `indicator-config-dialog.component.ts` unchanged).
- Full suite: 2,951/2,952 — lone failure is the foreign-scope
  `screenshot-capture-contracts.spec.ts` (#746 stream's spec-vs-enum
  mismatch).

### Design notes

- `CHART_MOUNTS_PER_FRAME = 1` — grants run inside rAF so each mount's
  DOM paints in its own frame. Tunable if stream-in feels slow.
- Unmounts never queue: `inWindow` feeds `mounted` directly via the
  computed — leaving is cheap and must be immediate.
- A grant pending on an invisible-then-visible cell is invalidated by
  the ticket and re-requested by the effect — live cells can never
  starve behind dead work.
