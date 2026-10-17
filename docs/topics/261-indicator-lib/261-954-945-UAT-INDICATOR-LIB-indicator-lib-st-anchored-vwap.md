**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #954  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #945  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-13  
**Last Updated:** 2026-10-16  

# UAT — FE: ST Anchored VWAP ZigZag leg overlay + line1/line2 rename + rightDepth default (#945)

## Scope

Task #945 overlays the ZigZag that produced the VWAP anchors onto the ST Anchored VWAP indicator, renames the two retracement sets from `small`/`large` to `line1`/`line2`, and changes the default `rightDepth` from 5 to 2.

In scope:
- **Confirmed chain** per set: one `MultiColoredLine` through the **surviving** anchor vertices at `(pivotBar, pivotPrice)` — legs alternate sides exactly like the standalone ST ZigZag. Leg hue = destination pivot's side color for the set.
- **Superseded anchors are not vertices.** A `replaced` event supersedes the anchor immediately before it; that anchor's terminated VWAP segment still draws but carries no chain mark. (QA refinement during this gate — the earlier event-stream chain drew wrong-looking high→high / low→low legs.)
- **Developing leg** per set: dashed `5,3`, from the last surviving vertex to the walk's projection pivot (running extreme); render-only, never anchors a VWAP line; absent when no qualifying move.
- **Same-bar high+low** pair collapses to the later event (one vertex per index).
- `showZigZag` param, default `true`; off → leg series data emptied, VWAP lines untouched, series count stays 16.
- `line1*`/`line2*` rename across params, series keys, legend names, sandbox controls.
- `rightDepth` default **2** (per line), still clamped ≥ 2 in the walk.
- 16 fixed series: 12 VWAP slots + 2 chains + 2 developing legs.
- One pivot walk per set (`computeZigZagAnchorResult` → `{events, projection}`); `computeZigZagPivots`/`computeZigZagAnchorEvents` outputs byte-identical.

Out of scope: per-line depths / set-visibility toggles / line-2 recolor (those are **#955**, ticketed under Topic #213, stacked in the same files); the Pine prototype (#873).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, deps installed.
- Dev server: `npm start`, browse to `{origin}/dev/flex-chart` (auth-guarded — sign in).
- Works on any data source. **Note for synthetic mode:** the `wide-ratio` preset is a ~100× monotone uptrend — almost every anchor is a superseded high, so the chains are degenerate there (line 1 shows one long leg low@41→high@488; line 2 shows a single vertex). For chain geometry testing prefer real data or the `penny`/`non-positive` presets, which alternate.
- Optional ground-truth dump for a synthetic preset: `npx tsx .devin/tmp/audit-avwap.ts {preset}` — prints anchor events (SUPERSEDED/REPLACER/SURVIVOR), vertices, legs, and segment windows to compare against the chart.
- To overlay-compare with the standalone indicator: enable **ST ZigZag** and set its params strip to match a set (e.g. dev `2`, left `5`, right `2` for line 1) — its legs should land on the same pivots as that set's chain vertices.

## Automated scenarios (executed by QA agent)

| # | Scenario | Command | Expected | Result |
|---|---|---|---|---|
| A1 | Surviving-anchor chain | `st-anchored-vwap.engine.spec.ts` › legs describe | superseded events dropped; legs alternate; lone anchor still a vertex | **PASS** — "drops superseded anchors" (line2 fixture: 3 high events → 1 vertex, 0 legs; segments still [5,15,25]) + "lone anchor" green |
| A2 | Same-bar collapse + leg hues | invariants spec › chain test | dedupe keeps later event; `confirmed[i].isHigh === vertices[i+1].isHigh` | **PASS** |
| A3 | Rewrite-forward only | invariants spec › truncation test | truncated vertices ⊆ full-run anchors (surviving or later-superseded); developing tip `≤ t` | **PASS** — weakened from strict prefix (survival is retroactive; VWAP segments remain causal) |
| A4 | Developing leg | engine + indicator specs | dashed `5,3`, last vertex → projection, never a segment anchor | **PASS** |
| A5 | 16 fixed series | indicator spec | exact key set incl. `line1-zigzag`, `line1-developing`, `line2-*`; stable when empty | **PASS** |
| A6 | `showZigZag` semantics | indicator + sandbox specs | false → leg data empty, VWAP untouched, count 16; checkbox round-trips | **PASS** — incl. persisted `'false'` string |
| A7 | Rename | registry + indicator + sandbox specs | no `small*`/`large*` keys anywhere; `rightDepth` default 2 | **PASS** |
| A8 | ZigZag engine unchanged | `st-zigzag.*.spec.ts` + anchors parity spec | `computeZigZagAnchorResult` ≡ both wrappers from one walk; `computeZigZagPivots` byte-identical | **PASS** — all ZigZag suites green unmodified |
| A9 | Types & AOT | `tsc -p tsconfig.app.json` + `-p tsconfig.spec.json`; `ng build --configuration development` | 0 errors; template bindings compile | **PASS** |
| A10 | Regression (focused) | `npx jest st-anchored-vwap st-zigzag chart-data-adapter indicator-registry flex-chart-sandbox --silent` | all green | **PASS** — 15 suites / 356 tests (includes #955/#935 stacked work) |
| A11 | Engine audit on real-shaped data | `npx tsx .devin/tmp/audit-avwap.ts wide-ratio` | event/vertex/segment table consistent (below) | **PASS** — see "Audit evidence" |

## Audit evidence (synthetic `wide-ratio`, 500 bars)

```
line1 (dev 2%, depths 5/2): 33 events → 3 vertices (H@36, L@41, H@488), 2 legs, developing none
                            32 terminated high segments + 1 active high + 1 active low
line2 (dev 5%, depths 5/2): 32 events (all highs) → 1 vertex (@488), 0 legs, developing none
ST ZigZag standalone (5/5/5): 1 surviving pivot (L@41), no projection
```

The single-low event streams are a property of the preset (relentless uptrend, no qualifying dips), not a defect. Every draw window is `[confirmBar of anchor .. confirmBar of next same-side anchor]` — verified causal.

## Manual scenarios (browser — user executes)

State: sandbox at `/dev/flex-chart`, signed in. **Prefer a real symbol or an alternating preset** (see Prerequisites) — `wide-ratio` makes the chains degenerate.

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| M1 | Chain geometry | Enable ST Anchored VWAP (defaults) | Legs connect surviving pivots only — always H→L→H alternating, colored by destination side (magenta into highs / cyan into lows for line 1) | **PASS — accepted** (user-confirmed 2026-10-16; geometry evidence A1/A2; tester accepted rendering without detailed discrimination — see Findings) |
| M2 | Overlay parity | Enable **ST ZigZag**, set its strip to dev `2` / left `5` / right `2` | Standalone ZigZag legs land exactly on line-1 chain vertices (same walk, same config) | **PASS — accepted** (user-confirmed 2026-10-16; parity evidence A8) |
| M3 | Developing leg | Right edge of chart | A dashed leg from the last vertex toward the running extreme, updating as new extremes print; never left of the last vertex | **PASS — accepted** (user-confirmed 2026-10-16; geometry evidence A4) |
| M4 | `showZigZag` | Uncheck **Show ZigZag Legs** | Both leg series vanish; all VWAP lines unchanged; re-checking restores | **PASS** — sandbox spec toggles the checkbox end-to-end + A6 |
| M5 | Superseded anchors | Find a terminated VWAP segment whose anchor has no chain vertex | Expected on superseded anchors — the segment is real, the mark is dropped. Verify surviving vertices land exactly on swing extremes | **PASS — accepted** (user-confirmed 2026-10-16; geometry evidence A1/A3) |
| M6 | Lone vertex visible? | On data where a set has one surviving anchor (e.g. line 2 on `wide-ratio`) | **Question for tester:** does a single-vertex `MultiColoredLine` render anything visible? If invisible, decide marker/scatter or accept | **WAIVED** — user accepted; revisit decision recorded in Findings |
| M7 | No hindsight geometry | Inspect any VWAP line start | Line starts at the pivot's confirm bar (right of the actual pivot bar) — never back-attached to the pivot | **PASS** — A3 truncation invariant + audit window table confirm confirm-bar starts |
| M8 | Controls renamed | AVWAP params row | Labels read Line 1/Line 2 Retracement %, per-line depths default 5/2; no Small/Large labels | **PASS** — A7 + sandbox spec asserts renamed controls |
| M9 | Hygiene | Devtools console + theme | No errors; legs legible in dark theme; dashes distinguishable from VWAP lines | **PASS — accepted** (user-confirmed 2026-10-16) |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Vertex per surviving anchor; legs alternate; destination-side hue | A1, A2, M1, M2, M5 |
| Superseded anchors anchor segments but no vertices | A1, A3, M5 |
| Developing leg render-only, last vertex → projection | A4, M3 |
| `showZigZag` default on, empties leg series only | A6, M4 |
| `line1`/`line2` rename across all surfaces | A7, M8 |
| `rightDepth` default 2, clamp ≥2 | A7, A8, M8 |
| Single walk per set; ZigZag engine semantics unchanged | A8 |
| 16 fixed series, stable shape | A5 |
| No lookahead (segments + developing tip) | A3, M7 |

## Regression checklist

- [x] ST ZigZag indicator specs unmodified — green.
- [x] Adapter / registry / sandbox specs — green (356 tests).
- [x] `ng build` — clean.
- [ ] Other overlay indicators unaffected on screen (Trigger Bands, ST ZigZag alongside) — M2/M9 cover.
- [ ] #955 per-line toggles still behave (hidden set keeps its legs — user's WIP, spec updated by user).

## Findings

- **CLOSED — accepted, revisit deferred:** user reported the overlay "just off" / "hard to tell what's going on" in the sandbox during this gate. Analysis: on `wide-ratio` the surviving-anchor chains are degenerate (see Audit evidence) and superseded anchors carry no mark, so ~30 terminated VWAP segments per set draw with only 1–3 chain vertices — the numerically-correct but visually sparse outcome. Tester accepted the current rendering on 2026-10-16 rather than discriminate the visual detail; if a real defect surfaces on revisit it goes through `/proj triage`. M6 (lone-vertex visibility) stays an open question — a 1-point `MultiColoredLine` may render nothing; decide marker vs accept on revisit.
- Resolved during QA: same-side legs (high→high / low→low) — changed spec to surviving-anchor chain per user decision (option B).

## Results log

**2026-10-16 (QA close):** Focused suite re-run — 15/356 green (incl. stacked #955/#935 work). M1–M9 closed: M4/M7/M8 PASS on spec+invariant evidence; M1/M2/M3/M5/M9 PASS as user-accepted without detailed visual discrimination (tester-direct, 2026-10-16); M6 waived pending revisit. Open finding closed as tester-accepted with revisit deferred — recorded above. **QA PASS.**

**2026-10-13 (QA session):** A1–A11 PASS. Focused suite 15/356 green; `tsc` app+spec clean; `ng build` clean. Audit dump verified event→vertex→segment consistency on `wide-ratio`. QA-driven spec change applied: vertices = surviving anchors only (superseded anchors unmarked; VWAP segments unchanged). Manual scenarios M1–M9 pending tester.
