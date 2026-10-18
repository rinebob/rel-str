# SHARED TEST — Trade Analysis & Forensics

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1065  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

## Unit targets

- `serializeDataset`: RFC-4180 quoting (embedded commas/quotes/newlines), percent-units formatting, ISO dates, sparse-field empties, deterministic byte-identical output on same input (row order normalized).
- `ANALYSIS_COLUMNS` ⇄ `TradeAnalysisRow` drift guard: bijection — every row key has exactly one manifest entry, no orphan columns.
- Path helpers: `analysisDatasetsPath`/`analysisSlicesPath` return the anchor-pattern paths.
- `AnalysisSlice` serialization round-trip; `SliceFilter` op coverage.

## Integration boundaries

- Golden-fixture CSV snapshot — any column reorder/format change fails loudly (this is the contract the FE parser and future pandas consumers depend on).
- Codec output feeds a papaparse-equivalent parse in test to prove cross-side fidelity.

## Edge cases

- Fields that legitimately contain delimiters (notes/expressions); `undefined`/`null` → empty cell, not the string "undefined"; negative vs zero percents; non-signal rows with empty `ind.*`/`strength.*` blocks.
