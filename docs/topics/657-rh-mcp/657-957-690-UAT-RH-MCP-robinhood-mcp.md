**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full Tool Discovery  
**Thread Slug:** robinhood-mcp-full-tool-discovery  
**Issue:** #957  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #690  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# UAT — #690 Verify script + scripts/verify registrations

## Scope

The canonical discovery doc (`rh-mcp-tool-discovery-canonical-657-658-689.md`)
now has a permanent regression gate: a disk-only verifier that fails when a
tool section is dropped, a section loses its parameters/response evidence,
the coverage matrix drifts from the catalog, a linked capture disappears, or
any capture leaks an account number. Registered into `scripts/verify/` so it
runs with the standard pipeline.

## Prerequisites

- Repo checkout; Node 24 + `npx tsx` (same toolchain as every verify script).
- **No credentials needed** — no Robinhood session, no ADC, no `gh` token.
- `.env.local` optional: if present, its `RH_ACCOUNT_NUMBER` /
  `RH_RHS_ACCOUNT_NUMBER` values are used for the verbatim-leak check; if
  absent that check self-skips with a note.

## Scenarios

### S1 — clean pass on the canonical doc

```powershell
cd functions
npx tsx scripts/verify/rh-mcp-tool-inventory-690.ts
```

Expected: `catalog: 76 tools · doc: 76 sections`, 8 × `OK`, `8 passed, 0
failed`, exit 0.

**Result:** PASS — observed `8 passed, 0 failed`, exit 0 (fresh run during QA).

### S2 — fails when a tool section is removed

```powershell
# from repo root — carve out the get_accounts section into a fixture
node -e "const fs=require('fs');const d=fs.readFileSync('docs/topics/657-rh-mcp/rh-mcp-tool-discovery-canonical-657-658-689.md','utf-8');const s=d.indexOf('### get_accounts');const n=d.indexOf('\n### ',s+10);fs.writeFileSync('.devin/tmp/mutated-doc.md',d.slice(0,s)+d.slice(n+1))"

# from functions/
npx tsx scripts/verify/rh-mcp-tool-inventory-690.ts --doc ../.devin/tmp/mutated-doc.md
```

Expected: `FAIL every catalog tool has a doc section: missing sections:
get_accounts`, `7 passed, 1 failed`, exit 1. Fixture lives only in
`.devin/tmp/` — real doc untouched.

**Result:** PASS — observed the named FAIL and exit 1.

### S3 — fails when a capture leaks an account number

```powershell
# from repo root — plant a synthetic leak capture
node -e "require('fs').writeFileSync('docs/topics/657-rh-mcp/captures/zzz-leak-test.json', JSON.stringify({account_number:'FAKE99999'}))"

# from functions/
npx tsx scripts/verify/rh-mcp-tool-inventory-690.ts

# cleanup
node -e "require('fs').rmSync('docs/topics/657-rh-mcp/captures/zzz-leak-test.json')"
```

Expected: `FAIL no unmasked account_number values in any capture:
zzz-leak-test.json: FAKE99999`, exit 1. The plant file is deleted after the
run; `git status` must show no leftover.

**Result:** PASS — planted `zzz-leak-test.json` produced
`FAIL no unmasked account_number values in any capture: unmasked account
numbers: zzz-leak-test.json: FAKE99999`, `7 passed, 1 failed`, exit 1;
plant file deleted, `git status` clean.

### S4 — registrations resolve

- `scripts/verify/README.md` has the `#690` row linking the guide.
- `scripts/verify/run-all.ts` has the
  `{ name: 'rh-mcp tool inventory (canonical doc)', file: 'verify/rh-mcp-tool-inventory-690.ts', cwd: 'functions' }`
  entry — `cwd:'functions'` + `scripts/${file}` resolves to
  `functions/scripts/verify/rh-mcp-tool-inventory-690.ts`, which exists.
- `needsAccount`/`needsAdc`/`needsGh` all unset → run-all never gates the
  script out.
- `tsc --noEmit` on `run-all.ts` parses.

(Full `run-all` not executed for QA — it would trigger ~30 scripts including
ADC-dependent Firestore/KMS mutators; registration correctness is verified
statically + the script itself runs standalone per S1.)

**Result:** PASS — README row at line 41; run-all entry at lines 189–194
with `needsAccount: false, needsAdc: false` (no `needsGh`); resolved path
`functions/scripts/verify/rh-mcp-tool-inventory-690.ts` exists; `tsc
--noEmit` on `run-all.ts` clean (review evidence). Full run-all not
executed — see note above.

### S5 — allow-list forms pass

The real captures already exercise the accepted forms: masked `••••…`
values, `$ENV:` placeholders in probe args, and the intentional bogus `"0"`
from `err-positions-bad-acct`. S1's green run over all 354 capture files is
the evidence that legitimate shapes do not false-positive.

**Result:** PASS — covered by S1 evidence: 354 captures scanned, zero
failures on the masked/`$ENV:`/`"0"` allow-list.

### S6 — guide completeness

`scripts/verify/rh-mcp-tool-inventory-690.md` documents the command, all 8
checks, the pass/fail contract, and the `--doc` negative-test recipe — a
developer can reproduce S1–S3 from the guide alone.

**Result:** PASS — guide documents the command, all 8 checks, pass/fail
contract, and the `--doc` negative-test recipe verbatim.

## Traceability

| Issue AC | Scenario |
|---|---|
| `rh-mcp-tool-inventory-*.ts` exists + every catalog tool in doc | S1 |
| every tool: params + ≥1 response block | S1 (checks 3–5) |
| matrix rows == catalog count | S1 (check 6) |
| captures: no account-number-shaped strings | S1 (checks 7–8) + S3 |
| passes on finished doc | S1 |
| fails when a tool/section removed | S2 |
| README row + run-all entry | S4 |
| no credentials — disk-only | S1–S3 run with none |

## Regression / smoke

- `npm run typecheck` (functions) — covers `scripts/verify/*.ts` — clean.
- `npm run test:rh-agent-mcp-discovery` — 130/130 (suite unaffected;
  verifier only reads artifacts).
