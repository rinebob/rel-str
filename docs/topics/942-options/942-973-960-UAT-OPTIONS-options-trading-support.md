**Topic:** Options Trading Support  
**Topic Slug:** options  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #973  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #960  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# UAT — #960 MCP client option chain/instrument methods

## Scope

Typed `RobinhoodMcpClient` contract-discovery methods:
`getOptionChains(symbol)` (`get_option_chains`) and
`getOptionInstruments(filters)` (`get_option_instruments`) plus the
`OptionChain` / `OptionInstrument` / `OptionInstrumentFilters` types and
public `optionChainsSpec` / `optionInstrumentsSpec` for `executeBatch`.
Client-layer task — no UI surface; all scenarios are executable from the
command line. Manual UI/UX refinement pass: **not applicable**.

## Prerequisites

- Repo root: `C:\aa\projects\rel-str`
- No credentials or live session required — parsers verified against the
  committed captures under `docs/topics/657-rh-mcp/captures/`.

## Scenarios

### 1. `get_option_chains` — arg shape, envelope parse, sorted expirations

```powershell
npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts --coverage=false -t "getOptionChains"
```
**Expected:** 5 specs pass — `{ underlying_symbol }` arg asserted;
`{ data: { chains: [...] } }` parses; expiration dates sort ascending;
malformed payload → `[]`; failure → `RobinhoodMcpError`.  
**Result:** PASS — `Tests: 5 passed` (73/73 file).

### 2. `get_option_instruments` — filters, pinned state/tradability, parse

```powershell
npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts --coverage=false -t "getOptionInstruments"
```
**Expected:** 8 specs pass — `chain_symbol` + `expiration_dates` CSV +
4dp `strike_price` + `type` + `state:'active'` + `tradability:'tradable'`
asserted verbatim; optionals omitted when absent; non-finite strike
omitted; id-less rows skipped; malformed → `[]`; `data.next` warns;
failure → `RobinhoodMcpError`.  
**Result:** PASS — `Tests: 8 passed` (73/73 file).

### 3. Response field names verified against captured payloads

```powershell
python -c "import json; c=json.load(open('docs/topics/657-rh-mcp/captures/ro-opt-chains-01.json')); print(sorted((c.get('response') or c)['data']['chains'][0].keys())); i=json.load(open('docs/topics/657-rh-mcp/captures/ro-opt-instr-02.json')); ins=(i.get('response') or i)['data']['instruments'][0]; print(sorted(ins.keys())); print('occ_symbol:', 'occ_symbol' in ins)"
```
**Expected:** chains carry `id`, `symbol`, `expiration_dates`,
`settle_on_open`; instruments carry `id`, `chain_id`, `chain_symbol`,
`expiration_date`, `strike_price`, `type`, `tradability`; **no**
`occ_symbol` — justifying the IMPL deviation (identity is the
chain_symbol+expiration+type+strike tuple).  
**Result:** PASS — all parsed field names present verbatim in the real
captures; `occ_symbol` absent (verified 2026-10-12).

### 4. First-page truncation is flagged, not silent

**Evidence:** spec `warns when data.next indicates a truncated first page`
(asserts `console.warn` mentions `next`); implementation comments cite
`dep-opt-instr-10` (SPXW: 100 instruments + `data.next`) proving the
boundary is reachable.  
**Result:** PASS — covered in scenario 2's run.

### 5. Batch composability + full-suite regression

```powershell
npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts --coverage=false
npx tsc -p tsconfig.app.json --noEmit
```
**Expected:** whole client suite green (specs are public `ToolSpec`s for
`executeBatch`, whose own 8-spec suite is green); typecheck clean.  
**Result:** PASS — 73/73 specs; `tsc` clean. Full repo suite: 3502 pass /
43 fail — identical to the pre-task baseline; all failures trace to
unrelated uncommitted screenshot work (`order.component.spec.ts`
`Functions` provider, `screenshot-capture-contracts.spec.ts`
`PositionType` enum).

## Traceability

| Task AC | Scenario |
|---|---|
| `underlying_symbol` + sorted expirations | 1 |
| `chain_symbol` + filters + `state:'active'`; instrumentId + identity | 2 |
| Malformed/shape-variance tolerance | 1, 2 |
| Field names verified vs capture, unverified noted | 3, 4 |
| `data.next` truncation flag (in-review finding) | 4 |
| Batch composability (`optionChainsSpec`/`optionInstrumentsSpec`) | 5 |

## Regression / smoke

- [x] `getOptionQuotes`/`getOptionPositions`/orders paths untouched —
      shared `extractList`/`toNumber`/`parseSpecResult` unchanged; all
      pre-existing specs still green in scenario 5's run
- [x] No consumers exist yet for the new methods (first consumer lands
      in #961) — nothing else to regress

## Findings

None outstanding. Review-deferred items (documented, not defects):
`OptionInstrumentFilters.chainId` for multi-chain underlyings → #961;
symbol case-normalization → consistent with the rest of the client.
