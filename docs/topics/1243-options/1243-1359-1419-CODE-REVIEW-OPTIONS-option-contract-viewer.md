**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1419  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — #1419 BUG: Chunk live-drive emits but picker selection/lines stay stale

## Verdict

**PASS** — two converged rounds. R1: all four ACs met; three axes
converged on one ordering defect plus a semantics hole, remediated
in-cycle. R2 (verification re-run on the final diff): every fix verified
semantically correct, no regressions, no new defects — nits only.
Remaining items are nits and one documented design flag for the user.

## Round 2 — verification axes (2026-11-05)

Both axes re-ran on the post-remediation diff and confirmed:

- `send()` reorder verified — `close` is idempotent, `pickerRef` nulls
  before `onSend` runs, `data===undefined` path closes cleanly,
  empty-selection guard precedes `close()` (spec-pinned `['close','send']`).
- `onLoad(sentLines?)` verified — manual path byte-for-byte unchanged
  (all writes gated on `sentLines !== undefined`); every write
  immediately precedes a dispatch; cancelled confirm returns before any
  write; `emitLinesToChart`+`onLoad` double `loadConfirmOpen` guard is
  coherent (inner check covers the manual Load button too).
- New specs verified sound — `mockReturnValueOnce` lands on the
  CONFIRM open (ngOnInit makes no `dialog.open` call); `jest.spyOn(store,
  'loadPlotted')` intercepts the real call site (established pattern).

New findings: none above nit. Residuals:

- **Nit** — `rejectedEntries.set` runs before the confirm, so a
  cancelled >50 send could leave rejection chips for lines the textarea
  never received. Informative rather than wrong; same semantics as
  manual cancel; restructuring would break the manual path. Accepted.
- **Nit** — double `loadConfirmOpen` guard (`emitLinesToChart` +
  `onLoad`) — redundant but harmless; inner check is the real guard.
- **Info** — a second send during a pending confirm is silently dropped
  — strictly better than R1 (no field/chart divergence), and
  UI-unreachable behind the modal backdrop.
- **Info (pre-existing, out of scope)** — two ≤50 sends with
  `loadPlotted` in-flight race last-writer-wins; the feature is built
  for it (`status==='loading'` re-reads per await).

## The model being reviewed

`selection` is the single source of truth; the chart only ever plots
`selection`, and only on an explicit Send (recorded in IMPL doc —
"Sync model (#1419)" section). `sendSteppedChunk`/`sendChunkAt`/
`emitCurrentChunk` removed; `step`/`setChunk` are cursor-only. Picker
Send = emit + close; ×/backdrop aborts. Mini-controls `◀▶` navigate
only; `All` = `selectAll` + emit.

## Findings and disposition

| Severity | Axis | Finding | Disposition |
|---|---|---|---|
| Major | TN (+Spec F1, +Standards) | `send()` ran `onSend` **before** `dialogRef.close()` — the >50 confirm opened nested inside the still-mounted picker (focus-trap steal, stacked backdrop), and a thrown send left the dialog open | **Fixed:** `send()` now materializes lines → `close()` → `onSend(lines)`. Invocation order pinned in spec (`['close','send']`). |
| Major/Medium | TN F1/F3 + Spec F2 | Confirm-cancel drift: `emitLinesToChart` wrote `occIdInput` before the >50 confirm resolved — a cancelled send left the textarea disagreeing with the plotted set; `loadConfirmOpen` bail also left `lastEmitted` claiming a handoff | **Fixed:** `onLoad(sentLines?)` defers the textarea write past the confirm gate and the single-contract early return; `emitLinesToChart` passes lines through instead of pre-writing. `lastEmitted` re-contracted as **attempted** emit (JSDoc + IMPL note) — observability-only, nothing UI-visible reads it. |
| Minor | TN F4 | "Abort" isn't abort — Close/× skips the emit but mutated `selection` persists (incl. `rs-optlist`); reopening can show a selection the chart doesn't reflect | **Intended workspace model** (picker spec pins preservation) — flagged for UX sign-off; a "pending ≠ plotted" indicator is a possible #1420-adjacent refinement, not a code defect. |
| Minor | Standards | Stale JSDoc: picker `data` field ("Send stays open"), store `step` ("mutate the selection workspace"), mini-controls header grammar | **Fixed** — comments now state the real contract. |
| Minor | Spec F5 | Stale assertions in *historical* docs (#1362/#1363 UATs, PRD) reference live-drive/send-stays-open | **Left as-is** — dated records of what those tasks shipped; IMPL marks the model superseded. Living docs (IMPL/TEST) updated. |
| Nit | Standards | Self-referential oracle in picker send spec (`lastEmitted === emittedLines` both derive from `toPairLines`) | **Fixed** — literal `arrayContaining(['2026-06-01,AAA'])` pin added. |
| Nit | Standards/TN | `lastEmitted` has no production reader | Noted — observability field, kept per its #1362 rationale; now honestly labeled. |
| Nit | TN | `dialogRef.close(lines)` + `afterClosed` result could replace `DS_DIALOG_DATA.onSend` now that Send closes | Noted — optional contract simplification; callback keeps the emit synchronous, deferred. |

## New spec coverage

- Picker: `send()` asserts invocation order `close → send` and a literal
  line in the forwarded payload.
- Page: `onLoad(sentLines)` confirm paths — cancelled >50 send leaves
  `occIdInput` untouched and calls no `loadPlotted`; approved send
  writes the lines and loads once.

## Explicitly probed, clean

- Zero `sendSteppedChunk`/`sendChunkAt`/`emitCurrentChunk` references
  remain in `src/`.
- `sendAll` ordering (`setSelection` → `emitSelected`) is atomic under
  `patchState`; can't emit stale lines.
- Strip `All` can't emit `[]` (doc validation guarantees ≥1 pick row;
  `emitSessionLines`'s `lines.length` guard is a backstop).
- Negative no-emit assertions are non-vacuous (cursor position pinned
  alongside `lastEmitted === []`).
- `pickerRef` clears synchronously on close — no reopen deadlock.

## Test evidence

- Touched sweep: **6 suites / 131 tests — green** (incl. new ordering +
  confirm cancel/commit pins).
- Full suite: **301 suites / 5,244 tests — green** (pre-remediation
  run; remediation touched only scoped files re-verified by the sweep).
- AOT `strictTemplates` — clean.

## Files in scope

- `stores/contract-list-session.store.ts` + `.spec.ts`
- `components/contract-list-picker/` (.ts/.html/.spec.ts)
- `components/contract-list-mini-controls/` (.ts/.spec.ts)
- `pages/option-chart/option-chart.component.ts` + `option-chart-list.spec.ts`
- `docs/topics/1243-options/1243-1352-1358-IMPL-OPTIONS-FE-…md`,
  `…-TEST-OPTIONS-FE-…md`
