**Topic:** Export ST indicators to PineScript for TradingView  
**Issue:** #224  
**Topic Parent:** #221  
**Domain:** SAVANT-TRADER  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-09-05  
**Last Updated:** 2026-09-05  

# Shared Implementation Plan

## Deliverable

Create one standalone, read-only Pine v6 indicator in `C:\aa\projects\rb-ps` that can be copied into TradingView and attached to a chart. It contains all four ST indicator families and the Zone V1/V2 price-pane event overlay.

The indicator uses Pine's `indicator(...)` declaration, not `strategy(...)`. It performs no order placement, broker calls, app calls, persistence, or runtime dependency on `rel-str`.

## Ownership and seam

This is a cross-repository SHARED effort managed by Topic #221 in `rel-str`.

- `rel-str` owns the production TypeScript implementation and the Topic workflow.
- `rb-ps` owns the Pine implementation, experiments, and final `.pine` commit.
- No TypeScript source is copied into `rb-ps`.
- No second Topic is created in `rb-ps`.

The comparison seam is visual behavior: the selected TypeScript implementation is the reference, while the standalone Pine plots and overlays are the delivered interface. Optional TradingView CSV export can be used when visual comparison cannot resolve a difference; a fixture exporter is not required for the first port.

## Phase 1: Standalone Pine foundation

Create a new final-indicator working file in `rb-ps` without modifying the historical scripts. Prefer a self-contained script so local copy/paste does not depend on published TradingView library imports.

Translate the shared math and state behavior needed by all families:

- fixed constants and lengths;
- EMA seed and recursive update behavior;
- missing-value handling;
- crossover/crossunder semantics;
- recursive smoothed Heikin-Ashi state;
- developing higher-timeframe values.

Use the existing `rb-ps` Pine source as historical reference and the current `rel-str` TypeScript implementation as the selected behavior target. Record any intentional divergence.

## Phase 2: Indicator and overlay port

Port the four families in dependency order:

1. Trend Bands: CTF fast/slow and HTF fast/slow bands.
2. Zone V1 and Zone V2 classification plots.
3. Trend Strength plots and thresholds.
4. Zone V1/V2 signal-event conditions.
5. Main-pane V1/V2 long/short event dots using the ATR-based placement convention.

Use developing higher-timeframe values so active interim bars paint immediately. Do not substitute confirmed-only values merely to avoid repainting.

The final script must provide the intended lower-pane plots and main-pane overlays from one file, with fixed v1 parameters and no required inputs beyond what is necessary for the single indicator to compile and render.

## Phase 3: Visual validation and handoff

Load the standalone Pine indicator in TradingView with representative symbols and timeframes. Compare it visually against the existing ST behavior in `rel-str`:

- four Trend Band shape, direction, and relative placement;
- Zone V1/V2 state and transitions;
- Trend Strength shape and thresholds;
- V1/V2 event timing, direction, and marker placement;
- active higher-timeframe interim behavior.

Use TradingView chart-data CSV export only when visual comparison is insufficient. Classify each difference as a defect, an expected developing-HTF difference, or an accepted Pine/runtime limitation. Record the selected TypeScript behavior, chart assumptions, and known differences in the implementation task or `rb-ps` validation notes.

## Cross-repository handoff

The `rel-str` task issue records the `rb-ps` path, final Pine filename, selected TypeScript behavior/revision, validation result, and known differences. The Pine implementation is committed in `rb-ps` only when the user explicitly authorizes committing. No `rel-str` runtime code changes are required for the first deliverable.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pine EMA/`na` semantics differ from array-based TypeScript | Compare primitives and band shapes before higher-level visuals; use explicit Pine logic where needed |
| Developing HTF values repaint | Treat repainting as required behavior; compare active and historical behavior separately |
| Original Pine and current TypeScript differ | Use the selected TypeScript revision as the port target and document intentional differences |
| Pine library imports are unavailable or versioned differently | Prefer a self-contained final script; retain original library scripts as references |
| One script cannot place plots in the desired panes | Prototype Pine plot/overlay behavior early and keep the final deliverable as one script |
| Visual comparison hides numeric drift | Use optional TradingView chart-data CSV export for the affected plots |
