# CODE-REVIEW — #1043 DS inventory catalog + mockup convention

Review of the #1043 diff: `docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md`,
`scripts/verify/design-system-inventory-1043.{ts,md}`, `run-all.ts` + README rows.

## Verdict — PASS

Three-axis review on the uncommitted diff; all counts re-derived against live
greps during review, not taken on faith.

## Spec axis — ACs

| AC | Result |
|---|---|
| Catalog doc exists in the topic directory with element + candidate rows | PASS — `1024-1025-DS-INVENTORY.md` at the exact issue-specified path; 12 extracted + 9 candidate rows |
| Each extracted element row cites real source files | PASS — every backticked path resolved on disk by the relay (incl. `av-proxy-api/…` cross-repo cites) |
| Mockup convention stated in the doc header | PASS — "`/dev/ds` screenshots or token-built SVGs, cited by element name" verbatim in the header block |
| Filename follows the per-Topic doc convention | PASS — `{topic}-{thread}-DS-INVENTORY.md` matches the issue's prescribed name |

Spec's column ask — "pattern name, source files, duplication count,
extraction status" — maps to `Element | Source file(s) | Dup count | Status`.
~10–20 rows: 12 in the extracted table.

## Standards axis

- Doc header follows the canonical proj-workflow block (field-per-line,
  two-space line breaks, `Domain: DESIGN-SYSTEM` matching topic convention).
- `Dup count` explicitly defined as live call sites (not historical copies) —
  defensible and honest.
- Candidate rows distinguish **migrate → existing mixin** vs **extraction =
  new package work** vs **Deferred** — the right triage vocabulary for the
  next thread's blueprint.
- Relay is consistent with sibling relays: `check()` helper, per-task `.md`
  guide, `run-all.ts` registration, `needsPath` sibling-checkout gate.

## Adversarial axis — findings across passes

| Pass | Finding | Disposition |
|---|---|---|
| R1 | `stat-strip` "local variants" row cited `allocation-page`/`portfolio-dashboard` — **already migrated** | Fixed — real holdouts are `order.component.scss` (hand-rolled `sb-*`) + `allocation-bucket-detail-dialog` (`.stats-strip`/`.pos-stats`) |
| R1 | Error-banner row's `+~20 more` — broad grep overcounted | Fixed — real literal count is 4 files, all named |
| R1 | `keyframes spin` marked Deferred-but-clean | Fixed — `run-metrics-strip` carries a local copy → dedupe candidate |
| R2 | ST's own vendored consumption (#1071) missing from infra table | Fixed — added alongside SA's #1042 row |
| R2 | `scripts/sync-savant-ds.mjs` cited bare in SA row — ambiguous vs rel-str's `.ts` | Fixed — SA cites carry `av-proxy-api/` prefix; relay widened to check `vendor/`/`scripts/`/`angular.json`/`package.json`, caught exactly this |
| R2 | `tsc` clean on both relay + run-all; no non-ambient errors | — |
| R3 | All `Dup count` cells re-grepped: `dialog-chrome`×6, `dense-table`×7, `state-block`×3ST+1SA, `stat-strip`×3, `vl.$up/$down`×6, empty-state×13, chips×10, toolbar×5, error-literals×4, mat-table×3 | All verified |
| R4 | `core-routes.ts` cited bare — actually lives at `src/app/core/core-routes.ts`; unresolvable as written | Fixed — full-path cite |
| R4 | Seven more bare-filename cites (`order.component.scss`, `position-card`, `chart-toolbar`, `heatmap-view`, etc.) — uncheckable shorthand | Fixed — all converted to full `src/…` paths; relay verifies every cited path now |
| R4 | `styles.scss` emits `@use 'tokens'` (ST side); only ds-gallery uses bare `@use 'index' as ds` (rest via `vl.*` shim) | Verified — doc wording accurate |

## Verification

- `design-system-inventory-1043.ts`: **16/16 checks green** (doc exists,
  header fields, convention stated, all cited paths resolve, tables populated)
- All ACs met; no code changes — DOCS task.

## Nits (informational)

- `~10 files` for direction-badge chrome includes the gallery demo card
  (9 production + 1 demo) — acceptable approximation, labeled `~`.
