# FE TEST — Trade Analysis & Forensics

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

- Store: `filteredRows` composed-filter correctness (enum ∈, numeric range, date range, AND semantics), reset, sort chain (multi-key + asc→desc→removed — reuse #1067 spec patterns).
- Stats computeds against a fixture CSV with hand-computed expectations: %profitable, payoff, expectancy, per-signalType breakdown; `analysisCohort='excluded'` + `status!=CLOSED` rows never counted; include-open toggle changes cohort and marks provisional.
- Slice serialize/apply: save → apply to dataset missing a column → predicate skipped + notice; compare-mode overlay inputs.

## Integration boundaries

- `loadDataset` — stub `getDownloadURL`/fetch, real papaparse on a fixture CSV; parse-by-header-name tolerant of column append/reorder.
- Component specs: jsdom for table/filters/count; Syncfusion views behind light stubs (precedent: paper-trading spec) with binding assertions; run-config form → callable mock returning datasetId; `generating` chip + refresh behavior.
- Delete flow removes index doc AND storage object (service spec spies both calls).

## E2E journeys

- Generate snapshot → library shows `generating` → `ready` → open → workbench → filter `direction=long` + `ind.zoneV2=4` → table/count/views reflect subset → save slice → apply to a second dataset → compare overlays.
- Replay run (AMAT defaults) → dataset stats block matches prototype numbers (98 closed, 32.7%, payoff 1.30).

## Edge cases

- Empty dataset / all-rows-filtered-out → views show empty states not NaNs; malformed CSV row → parse error surfaces as error banner; very wide viewport vs narrow — table + views layout.
