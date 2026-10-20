**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #1127  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #762  
**Domain:** GALLERY-VIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Scope — Task #762

Route promotion + order-flow handoff: canonical `trading/gallery` route (lazy, auth-gated — same component as retained `dev/gallery`), Trading → Gallery nav entry, run-dashboard navigation consolidated to the gallery ('Review Latest Signals' button + per-run row action, both with `setActiveRun` seeding), `signals/review`/`trading/live` unchanged. Delivered with the task's user-directed additions: "Sunk"→**Actioned** section with per-status exits (Unwatch / Restore / Requeue; Settled is terminal), default grouping **None** + `dataPending` loading gate, ticket dialog stays open on done-status showing a **confirmation panel** (View order / Done), card ticket-line deep link to `trading/live?ticket=<id>` honored by the order page, manual **Paper** disabled behind `GALLERY_MANUAL_PAPER_ENABLED`.

## Prerequisites

- `npm start` dev server on `http://localhost:4200`, logged in as the app's single user.
- At least one **completed run** (SUCCESS/PARTIAL) with signals — the gallery reads the latest completed run.
- A card with an existing non-STAGED ticket (resting/failed/settled) is needed for the deep-link scenario — or submit a real order in scenario 6 first.
- ⚠ **Order submission is REAL** — submitting from the gallery reaches Robinhood. For scenario 6 either use a token whole-share order on a cheap symbol you intend to trade anyway, or verify the confirmation panel on a paper/option path you don't mind executing. Scenarios 7–8 can reuse any existing resting/settled ticket.

## Start instructions

1. `npm start` → `http://localhost:4200`.
2. Landing redirects to Portfolio — use the left nav or type the URLs below.

## Test scenarios

| # | Feature | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Canonical route | Navigate to `/trading/gallery` | Gallery renders — card grid for the latest completed run (or the loading/empty states per scenario 5). URL stays `trading/gallery`. | PASS — gallery in use throughout QA session |
| 2 | Dev route retained | Navigate to `/dev/gallery` | Same gallery renders — identical component, no redirect. | WAIVED — owner accepted; route pinned in `core-routes.spec` |
| 3 | Nav entry | Left nav → **Trading** group | 'Gallery' listed first (above Live/Paper); clicking it lands on `/trading/gallery`; header shows 'Signal Gallery'. | WAIVED — owner accepted; nav order pinned in `nav-sections.spec` |
| 4 | Dashboard entry points | `/signals/runs` → click **Review Latest Signals**; then back and click a run row's Review action | Both navigate to `/trading/gallery`; the row-action variant lands seeded to *that* run (cards for that run's signals, not necessarily the latest). | WAIVED — owner accepted; spec-covered |
| 5 | Loading + default grouping | Hard-reload `/trading/gallery` on a run with signals | 'Loading signals…' → cards appear progressively — **no** 'No signals' flash in between. Group dropdown defaults to **None** (flat grid). | PASS — user observed ~5-10s Loading before cards; no empty-flash reported |
| 6 | Submit → confirmation | On an actionable card: **Trade** → submit a quantity order (⚠ real order — see prerequisites) | Dialog does **not** auto-close: confirmation panel shows status copy ('Order submitted'/'resting…'), symbol + terms (e.g. `buy limit 10 @ 210.50`), 'View order' + 'Done' buttons. | WAIVED — user deferred live orders; dialog spec covers confirmation-panel path |
| 7 | View order handoff | From the confirmation panel: **View order** | Dialog closes → `/trading/live?ticket=<id>` loads with **that** ticket selected (not the first row). | WAIVED — deferred with #6; spec-covered |
| 8 | Ticket-line deep link | On any card with a ticket: click the ticket line (`limit 10 @ … · Resting`) | `/trading/live?ticket=<id>` opens with the ticket selected — works for resting/settled tickets once RH orders load (a brief first-row fallback may flash first). | WAIVED — deferred with #6; spec-covered incl. hidden-row race fix |
| 9 | Actioned section + exits | Scroll to the Actioned section on a run with rejected/failed cards | Prominent band header 'ACTIONED · N' with per-status sub-sections (FAILED/SETTLED/REJECTED, color-accented), cards fully legible. Rejected → **Restore**. Failed → **Requeue** or **Reject**. Settled → no exit buttons. *QA refinement: Monitor membership no longer sinks cards — monitored symbols' signals stay actionable.* | PASS — reject→Actioned→restore→grid verified live by user; per-status sub-headers + accents approved; Requeue spec-covered |
| 10 | Manual Paper hidden | Toolbar on an actionable card | No Paper button — `GALLERY_MANUAL_PAPER_ENABLED=false` hides it (QA refinement: hidden, not disabled). | PASS — button hidden post-refinement |
| 11 | Unchanged surfaces | `/signals/review` and `/trading/live` (direct + nav) | Both render exactly as before; order-queue operations on trading/live unaffected. | WAIVED — owner accepted; both surfaces in regular use |
| 12 | Negative — stale deep link | Open `/trading/live?ticket=NOPE-INVALID` | Page loads normally, selects the first queue row — no error, no blank detail pane. | WAIVED — owner accepted; spec-covered |
| 13 | Negative — revert | (Optional, needs a way to fail/requeue a ticket after submit — e.g. requeue a FAILED ticket on `trading/live` while its dialog confirmation is still open) | Confirmation clears and the ticket form (with error) returns — the panel never shows success over a failed leg. | WAIVED — needs live failure; spec-covered |

## Traceability

| Criterion | Scenario(s) |
|---|---|
| AC1 — `trading/gallery` lazy + auth; `dev/gallery` works | 1, 2 |
| AC2 — dashboard entry → gallery (user-directed consolidation) | 4 |
| AC3 — `signals/review`, `trading/live` unchanged | 11 |
| PRD story 1 — entry point navigates, auth-gated | 3, 4 |
| PRD story 19 — both legacy surfaces reachable | 11 |
| Dialog confirmation (user-directed) | 6, 7, 13 |
| Ticket deep link (user-directed) | 7, 8, 12 |
| Actioned exits (user-directed) | 9 |
| Loading/grouping fix (user-directed) | 5 |
| Manual Paper disable (user-directed) | 10 |

## Regression / smoke checklist

- [ ] Grouped mode (Sector/etc.) still renders groups with the Actioned section below
- [ ] Card Chart defer-mount, D/W chips, filters unchanged
- [ ] Order queue requeue on `trading/live` still mints fresh refId (shared `requeueTicketPatch`)
- [ ] signals/review auto-accept → ticket lands in `trading/live` queue as before
- [ ] Dialog cancel of a still-STAGED ticket discards it (card back to pending)

## Verdict

**APPROVED — gate-owner waiver, 2026-10-20.** Executed: 5 (loading), 9
(Actioned exits — reject→restore verified live; per-status sub-sections
approved), 10 (Paper hidden), 1 (canonical route, via session use).
Owner-waived with spec coverage: 2–4, 6–8, 11–13 and the smoke checklist —
live-order scenarios deferred by the user ("not doing any orders"); the
confirmation panel, `?ticket=` deep link (incl. the hidden-row race fix),
and revert guard are all spec-pinned. QA refinement items resolved during
the gate: Monitor→watched derivation removed (BTSG/TDY root cause), Paper
hidden rather than disabled, Actioned split into per-status sub-sections,
Chart stub button removed.
