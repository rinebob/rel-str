# CODE-REVIEW — RH-MCP: Error-envelope probe session (#687)

**Topic:** #657 — Robinhood MCP
**Thread:** #658 — Full RH MCP Tool Discovery
**Blueprint:** #680
**Task:** #687 — BE-IMPL: Error-envelope probe session
**Reviewed:** 2026-10-06
**Verdict:** **PASS** — nits remediated in-session; no majors

## Surface

- `docs/topics/657-rh-mcp/probe-manifest.json` — 15 new `err-matrix` probes + `mx-quote-start` fix (symbols string→array; #685 latent bug caught by validator)
- `docs/topics/657-rh-mcp/captures/err-*.json` — 17 captures (15 runner-produced + 2 hand-written executor-level rejects)
- `docs/topics/657-rh-mcp/657-658-675-TEST-*.md` — "Error-envelope session (#687)" section

Data/artifact task — no production code. Scope excluded in-flight #685 `mx-*`/`eq-matrix` entries.

## Standards

**Clean.** Manifest entries conform to format and gates are safe-by-construction (bogus IDs can't match real resources; mutation gate correctly set on all 3 mutation tools). Runner captures match `ProbeCapture` envelope exactly; hand-written captures are honestly labeled (Ajv-exact error strings, `latencyMs:0` true for pre-flight rejects, provenance disclosed in notes). Redaction verified — nil-UUIDs only; `$ENV:` placeholders intact, zero resolved values. TEST outcome table matches files count-for-count (3+1+2+5+2+4 = 17). Loader hard-fails mis-gated mutations anyway.

**Nits — fixed this round:**
- Missing `redactFields`/`env` annotations on the 3 account-scoped err probes (123/126 others carry them — defense-in-depth for unexpected success envelopes) → added
- `err-*` entries key order differed from canonical `id/tool/args/group/gate/…/note` → normalized
- TEST doc `Last Updated` stale → bumped to 2026-10-06
- "`fetch failed`…recorded as an error capture" — the retry overwrote it; wording softened to say only the JSON 404 is on disk

**Nits — deferred:**
- Hand captures embed `{category,error}` inside `response` where runner captures put the server payload — reasonable adaptation (no payload exists); the shape is documented in the note
- Rounded `capturedAt` on hand captures — disclosed approximation

## Spec

**AC1 — ≥3 distinct error responses with categories: MET** — 6 distinct outcome shapes across 17 files: JSON 404 `{"detail":"Not found."}` ×3, structured `missing_instruments` 404, raw-HTML 404 ×2, server validation strings ×5, executor `VALIDATION` ×2, success-instead-of-error ×4. Categories recorded (`invalid_request` for all server errors; `VALIDATION` client-side).

**AC2 — conformance/deviation noted per tool: MET** — TEST doc claims verified against capture contents: HTML-404 route-miss deviation, success-instead-of-error tools (chains/crypto-quotes/option-quotes/mark_alerts_read), executor-layer Ajv rejects. One overclaim fixed (interval error does *not* enumerate valid values — only `asset_type` does).

**Scope items all evidenced:** invalid symbol ✓, missing required field (honestly captured at the layer that actually rejects it) ✓, `cancel_*` on bogus order_id both well-formed (JSON 404) and malformed (HTML 404) ✓.

## Thermo-nuclear

Self-checked: manifest↔capture joins verified programmatically (args/tool/gate identical on all 15; hand captures correctly have no manifest entry — the manifest can't express schema-invalid args). Outcome distribution: 13 error / 4 success. No capture/manifest mismatches, no fabricated success evidence, declined-transient honestly recorded.

## Tests

`run-probe-manifest.ts --dry-run` — 289 probes validate clean post-fix. Runner verify suite unchanged (no code touched).

**Verdict: PASS.**
