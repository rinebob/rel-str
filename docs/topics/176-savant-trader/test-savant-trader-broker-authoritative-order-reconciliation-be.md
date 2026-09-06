**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #225  
**topic parent:** #176  
**domain:** savant-trader  
**type:** test plan  
**area:** be  
**status:** approved  
**created:** 2026-09-05  
**last updated:** 2026-09-06

---

## integration tests

- Normalize direct and nested `place_equity_order` responses.
- Normalize `get_equity_orders` list and single-order responses.
- Normalize `get_equity_positions` responses and cursor pages.
- Detect embedded MCP tool errors when transport success is true.
- Preserve raw broker responses and normalized fields.
- Capture queued, confirmed, filled, cancelled, rejected, failed, and unknown states without assuming unsupported semantics.
- Enforce timeout behavior without creating false successful results.
- Handle missing broker IDs as errors rather than successful orders.

## acceptance criteria

- Broker adapter output is independent of MCP response nesting.
- A tool-level error never creates a Broker Order mirror.
- A successful broker order always has a broker order ID.
- Repeated identical broker responses are idempotent.
- Pagination produces a complete source snapshot.
- Redaction rules prevent account and credential leakage.
