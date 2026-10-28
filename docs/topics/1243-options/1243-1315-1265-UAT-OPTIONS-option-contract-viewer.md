**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1315  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1265  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

## Scope

Acceptance for #1265 — connected chip↔series hover. Both directions share `hoveredContractId`: chip side lights the chip border and dims every other rendered series; chart side (mark line, span marker, legend item) emits the contract id so the chip lights the same way. No refetch, no view swap, all series stay rendered.

## Setup

- `http://localhost:4210/options/chart` — symbol `QQQ`
- Load the same set as prior UATs (S2 shape — one bare + two dated):

```
QQQ260331P00455000
2025-07-01,QQQ260331C00440000
2025-09-15,QQQ260331C00450000
```

- Expected: 3 chips, 3 colored mark lines, span markers on the two dated contracts, `Loaded 3 / 3`.

## Scenarios

| # | Scenario | Expected |
|---|---|---|
| H1 | **Chip hover** (regression — shipped in #1264): hover a chip | Chip gets highlighted border; its line stays full color/width; the other two lines dim; marker spans of other contracts dim |
| H2 | **Mark-line hover**: move the pointer onto a mark line mid-segment (not a dot — the line itself) | Same behavior as H1 from the chart side — that contract's chip highlights, other lines dim |
| H3 | **Span-marker hover**: hover a marker dot and the dashed span line | The marker's contract chip highlights — the marker belongs to the same contract as its mark line |
| H4 | **Legend hover**: hover a legend entry — both the text label and the color glyph | That contract's chip highlights, other lines dim |
| H5 | **Non-contract targets**: hover the underlying price line and its legend entry | No chip highlights (underlying isn't a plotted contract); nothing dims |
| H6 | **Leave/restore**: move the pointer off a series onto plot background, axes, or out of the chart entirely | All chips and lines restore to normal |
| H7 | **No refetch**: watch devtools Network during all hovers | No Firestore/backend requests — hover only re-styles already-loaded series |
| H8 | **Cross-hover handoff**: hover chip A, then move straight onto mark line B without leaving the chart | Highlight transfers A → B cleanly; no flicker of "everything dimmed" |

## Result

Executed 2026-10-28 against `http://localhost:4210/options/chart` — all scenarios **PASS** (user-executed manual UAT, reported in session).

- [x] H1 chip hover — PASS — chip border lights, other series dim, hovered stays full
- [x] H2 mark-line hover — PASS — chip highlights from chart-side hover
- [x] H3 span-marker hover — PASS — marker resolves to its contract's chip
- [x] H4 legend text + glyph — PASS — both child elements map to the mark contract
- [x] H5 underlying — PASS — no chip highlight, nothing dims
- [x] H6 leave/restore — PASS — full restore on background/exit
- [x] H7 no network — PASS — hover re-styles loaded series only, no requests
- [x] H8 cross-hover handoff — PASS — clean A → B transfer, no flicker

## Known cosmetic limits (from review — not failures)

- The hover target is the rendered stroke itself — thin dashed marker lines are a narrower hit area than the dots.
- Hovering mid-label whitespace inside a legend item can momentarily clear the highlight — move onto the text/glyph itself.
