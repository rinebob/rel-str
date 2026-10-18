# UAT — #1043 DS inventory catalog + mockup convention

QA checklist for #1043, per CODE-REVIEW `1024-1031-1043-…`. QA issue: #1095.

## Verdict — COMPLETE

## Scenario log

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| S1 | Catalog doc exists at the issue-specified path | `docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md` | PASS |
| S2 | Mockup convention stated in doc header | "`/dev/ds` screenshots or token-built SVGs, cited by element name" — verbatim, top of doc | PASS |
| S3 | Extracted-element rows cite real source files | Relay resolves every backticked path on disk (incl. `av-proxy-api/` cross-repo cites); 12 extracted rows | PASS |
| S4 | Candidate rows for the next thread | 9 rows — direction-badge chrome, unmigrated error banners (4 files named), empty-state variants (13), local stat strips (2), filter/toolbar row (5), chips/badges (10), dense-table holdouts (3), deferred PD-local tab mixins, `spin` dedupe | PASS |
| S5 | Relay green | `design-system-inventory-1043.ts` — 16/16 checks | PASS |
| S6 | Full DS relay battery still green | All 11 relays exit 0 (1034, 1035, 1036, 1037, 1038, 1039, 1040, 1052, 1041, 1042, 1043) | PASS |
| S7 | Registration complete | `run-all.ts` entry + `README.md` index row + per-task guide `.md` | PASS |

## Notes

- Doc accuracy was adversarially audited across two implement passes +
  review R4: bare-filename cites normalized to full paths, stat-strip
  holdout list corrected to the real unmigrated files, ST vendoring row
  added. Dup counts re-derived from live greps.
- No code changes — DOCS task; nothing to ship beyond the doc + relay.
