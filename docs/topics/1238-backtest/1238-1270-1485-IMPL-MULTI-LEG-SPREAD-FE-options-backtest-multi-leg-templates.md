**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1485  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Domain:** MULTI-LEG-SPREAD  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Implementation Plan — FE: Multi-leg Templates

## Architecture Overview

One builder, two run surfaces. The template/variant builder dialog is the shared composition surface — pick a named variant, dial a base template to concrete Δ/DTE values, or compose legs from scratch — and it feeds both the Selection Replay run dialog (`/options/strategy/backtest`) and the strategy-instance flow (`/options/strategy/build`). Composition always resolves to concrete `legs[]` client-side; saving a variant = copy paste-ready JSON into the code registry.

```mermaid
flowchart LR
    subgraph Builder[Variant builder dialog]
        NV[named variants dropdown<br/>one-click]
        BT[base templates dropdown<br/>→ per-leg Δ/DTE fields<br/>bounded by bands]
        FS[from-scratch mode<br/>free-form legs]
        NV --> PREV[composed legs preview]
        BT --> PREV
        FS --> PREV
        PREV --> ACT[Run / Apply / Copy JSON]
    end
    Builder --> RD[Replay run dialog<br/>/options/strategy/backtest]
    Builder --> SF[Strategy form + build page<br/>/options/strategy/build]
    RD -->|variantId OR legs[]| BE[optionsReplayStart]
    SF -->|coordinate → config| ENG[strategy instance]
    LIST[contract-list table] -->|v1→v2 narrow| ROW[position rows<br/>expandable legs]
```

## Modules

### 1. Variant builder dialog (new — the core component)

Two-section layout inside one dialog:

- **Named variants section** — dropdown of `REPLAY_VARIANTS`; selection shows the concrete legs read-only; runs as-is.
- **Base templates section** — dropdown of `REPLAY_TEMPLATE_SHAPES`; selection renders one Δ picker + DTE picker per option leg, options bounded by that leg's `deltaBand`/`dteBand`; stock legs render as fixed rows. Composed `legs[]` preview updates live.
- **From-scratch mode** — add/remove legs freely: each row picks kind (option|stock), type, side, Δ, DTE — no shape behind it (`structure: 'custom'`).
- **Actions:** `[Run]`/`[Apply]` (destination-dependent), `[Copy JSON]` — emits the paste-ready `{id, name, description, structure, legs[]}` registry block for variants worth keeping.
- Naming: an optional variant-name field stamps `variantName` on the run; the JSON export prompts for the registry `id`.

### 2. Replay run dialog (`/options/strategy/backtest`)

The template picker is replaced by the two-section layout. Named variant → submits `{variantId}`; template-dialed or scratch-composed → submits `{variantName?, legs[]}`. Symbols + startDate controls unchanged. Multi-symbol unchanged — one run, one list doc per symbol.

### 3. Strategy-build entry points (`/options/strategy/build`)

- "Create new template" button on the build page → builder dialog.
- Inside the new-strategy dialog: a template/variant selector + builder button opening the dialog over the form; on return, the chosen variant's option leg populates the form's coordinate fields (`optionType`, `targetDelta`, `targetDte` — replacing the delta/DTE window inputs for pick-doc-driven configs). Engine stays single-leg: multi-leg variants are selectable only where the surface supports them — the strategy form filters to 1-leg option variants this thread (multi-leg instance support is #1483).

### 4. Contract-list table (position rows)

- Read through the v1→v2 narrowing shim — legacy `pick` docs render as 1-leg positions.
- Row shows position summary: `entryDate`, structure label/name from snapshot, per-leg chip summary (side+type+Δ+DTE→resolved contract). Expandable detail per row: each leg's contractId, strike, expiration, entry mark, Δ, IV.
- `no-selection` rows show per-leg miss detail (`legMisses`) — which coordinate failed and why.
- `legMetas[]` coverage display — per-leg pick/miss counts where today's single meta renders.

### 5. Row actions / chart hand-offs

- Position row → "Open in Spread Viewer" (hands the position payload to the spread-chart surface — #1486 defines the chart; this thread provides the payload contract: legs[] with contractIds + sides + entry day).
- Option leg → existing `/options/chart` contract viewer handoff per leg (unchanged mechanism).
- Stock leg → underlying price chart link if one exists; otherwise no action.

## Conventions

- Builder dialog owns the band knowledge — composition is client-side; no server round-trip to resolve a template.
- The dialog emits concrete `legs[]` only — `variantId` is used solely for registry-listed named variants.
- Feature state (builder open/compose state, run submissions) lives in a dedicated signal feature, not component-local signals, per project convention.

## Out of scope (re-stated)

- No saved-variant management UI (edit/delete) — registry is code; JSON copy is the save path.
- No multi-leg strategy-instance form — #1483.
- The spread-chart viewer itself — #1486 (this thread defines the payload it consumes).
