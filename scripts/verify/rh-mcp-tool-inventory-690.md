# Verify — #690 RH-MCP canonical doc inventory

Disk-only completeness gate for the canonical tool-discovery doc
(`docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-657-658-689.md`)
and its per-category children (`rh-mcp-tools-*.md` in the same dir — the
`###` tool sections live there). No credentials, no network, no MCP session.

| # | What | Script | Needs |
|---|---|---|---|
| #690 | canonical doc completeness + capture redaction | `functions/scripts/verify/rh-mcp-tool-inventory-690.ts` | none (offline) |

Run from `functions/`:

```powershell
npx tsx scripts/verify/rh-mcp-tool-inventory-690.ts
```

## Checks

1. Every bundled-catalog tool name has a `### <tool>` section across the
   `rh-mcp-tools-*.md` children (76/76; a missing child fails its tools).
2. No `###` section names a tool absent from the catalog.
3. Every section carries `**Safety:**`, `**Parameters`, and `**Notes:**`.
4. Every section links ≥1 `captures/*.json` evidence file.
5. Every linked capture exists on disk.
6. Main-doc coverage-matrix row count == catalog tool count.
7. No `account_number`/`rhs_account_number` JSON field in any capture
   holds an unmasked value (`••••` masked, `$ENV:` placeholder, or the
   intentional bogus `"0"` are the only allowed forms).
8. The real `RH_ACCOUNT_NUMBER`/`RH_RHS_ACCOUNT_NUMBER` values from
   `.env.local` (if readable) appear nowhere verbatim in the main doc,
   children, or captures — self-skips when the file is absent.

## Pass / fail

- **Pass:** `8 passed, 0 failed`, exit 0.
- **Fail:** `FAIL <check>: <detail>` lines + non-zero exit. Fails when a
  tool section is removed (check 1), when a section loses its params/
  notes/safety lines (3) or capture links (4), when a capture file is
  deleted while still linked (5), when the matrix drifts (6), or when a
  capture leaks an account number (7/8).

## Negative test (proves the fail path)

Children resolve as `rh-mcp-tools-*.md` siblings of `--doc`, so stage a
mutated copy of the doc set:

```powershell
# from repo root — copy the doc set, carve get_accounts out of its child
$tmp = '.devin/tmp/inventory-neg'
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-657-658-689.md $tmp/
Copy-Item docs/topics/657-rh-mcp/rh-mcp-tools-*.md $tmp/
node -e "const fs=require('fs');const p='$tmp/rh-mcp-tools-account-performance.md';const d=fs.readFileSync(p,'utf-8');const s=d.indexOf('### get_accounts');const n=d.indexOf('\n### ',s+10);fs.writeFileSync(p,d.slice(0,s)+d.slice(n+1))"

# from functions/
npx tsx scripts/verify/rh-mcp-tool-inventory-690.ts --doc ../.devin/tmp/inventory-neg/rh-mcp-tool-discovery-canonical-657-658-689.md
# expected: FAIL "every catalog tool has a doc section: missing sections: get_accounts", exit 1
```

`--doc <path>` overrides the main doc path; captures are always checked
against `docs/topics/657-rh-mcp/captures/`.
