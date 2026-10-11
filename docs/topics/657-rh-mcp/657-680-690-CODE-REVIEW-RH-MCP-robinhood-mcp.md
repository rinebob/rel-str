**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Full Tool Discovery  
**Thread Slug:** robinhood-mcp-full-tool-discovery  
**Issue:** #680  
**Thread Parent:** #658  
**Topic Parent:** #657  
**Task:** #690  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# CODE-REVIEW — #690 Verify script + scripts/verify registrations

## Verdict: PASS

Two minor findings, both remediated in-loop before verdict. No critical or
major findings.

## Scope under review

| File | Change |
|---|---|
| `functions/scripts/verify/rh-mcp-tool-inventory-690.ts` | New — disk-only completeness verifier (8 checks) |
| `scripts/verify/rh-mcp-tool-inventory-690.md` | New — per-task verify guide (commands, pass/fail, negative-test recipe) |
| `scripts/verify/README.md` | Registration row |
| `scripts/verify/run-all.ts` | Registration entry (`cwd: functions`, no creds) |
| `scripts/verify/rh-mcp-drift-682.md` | Stale baseline note corrected (76-vs-49 → 76/76 residual delta) |

## Standards

- Follows the established verify-script pattern exactly: top-of-file
  contract comment, `check(name, fn)` + `assert` harness, `N passed,
  M failed` + `process.exit(1)` — byte-level consistent with
  `rh-mcp-drift-682.ts`.
- Correct placement: `.ts` under `functions/scripts/verify/` (imports
  `loadToolCatalog` from `src/`), guide `.md` under `scripts/verify/`,
  matching all eight prior rh-mcp verify registrations.
- No credentials, no network, no MCP session — verified by reading every
  line: only `fs` reads of the canonical doc, `captures/`, and
  `.env.local` (optional, self-skipping). `loadToolCatalog` loads the
  bundled catalog, not the live server.
- ~170 lines, single responsibility, no dead code, no `any`.

## Spec

Issue ACs — all met:

- [x] `rh-mcp-tool-inventory-*.ts` completeness check exists and is registered.
- [x] Every catalog tool name present in the doc (`### <tool>` sections,
      bidirectional — extra/stale sections also fail).
- [x] Every tool has params + ≥1 response evidence (`**Parameters` +
      `**Safety:**` + `**Notes:**` + ≥1 `captures/*.json` link; linked
      files must exist on disk).
- [x] Coverage-matrix row count == catalog count (76).
- [x] Captures contain no account-number-shaped strings — field-scoped
      check (only `••••` masked, `$ENV:` placeholder, or the intentional
      bogus `"0"` allowed) plus verbatim full-value scan of captures and
      the doc against `.env.local` (self-skips when absent).
- [x] Passes on the finished doc (8/8, exit 0); fails when a tool/section
      is removed (proven: `get_accounts` carved into a `.devin/tmp`
      fixture → `FAIL missing sections: get_accounts`, exit 1; `--doc`
      flag makes this reproducible — recipe documented in the guide).
- [x] README row + `run-all.ts` entry added; entry placement/path
      resolution verified against existing entries.

## Thermo-nuclear

- No abstraction or sizing concerns — the script is a flat list of
  independent checks, which is the correct shape for a verifier.
- Report quality is good: failures name the offending tools/files, so a
  red run is actionable without re-running under a debugger.

## Findings (all remediated in-loop)

| Sev | Finding | Fix |
|---|---|---|
| minor | `--doc` with no trailing arg passed `undefined` to `readFileSync` — non-zero exit but an ugly uncaught stack | explicit guard → `FAIL --doc requires a path argument`, exit 1 |
| minor | verbatim-secret scan covered captures but not the doc itself, which quotes capture contents | doc added to the verbatim scan targets |
| nit (not fixed) | a `### ` line inside a fenced code block would parse as a section; acceptable — it flags real structural ambiguity | — |

**Bug found during development (self-caught):** first draft used a `\Z`
end-of-string lookahead — JavaScript has no `\Z`; it silently lexes as a
literal `Z`, which skipped the last doc section and truncated bodies at
stray `Z` characters. Replaced with index-slicing between `### ` headers.

## Test results

- `npm run test:rh-agent-mcp-discovery` — **130/130 pass**.
- `npm run typecheck` (functions, covers `scripts/verify/*.ts`) — clean;
  one `asserts cond` narrowing issue found and fixed.
- Verifier self-test — positive: 8/8, exit 0; negative (mutated
  fixture): 1 FAIL + exit 1 as designed.

## Ship surface

5 files: the new `.ts`, the guide `.md`, README row, run-all entry,
drift-682 note fix. No commits without explicit user approval.
