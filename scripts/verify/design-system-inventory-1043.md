# #1043 — DS inventory catalog verification guide

Verifies `docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md` — the
element catalog and mockup convention for the design system.

## Script: `design-system-inventory-1043.ts`

```bash
npx tsx scripts/verify/design-system-inventory-1043.ts
```

Run from the repo root. Requires sibling checkouts `../savant-ds` and
`../av-proxy-api` (the doc cites source paths inside them).

## Checks (16)

1. **Doc exists** at `docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md`
   (the per-Topic naming convention from the issue).
2. **Header fields** — canonical block present: Topic, Topic Slug, Thread,
   Issue #1043, Thread Parent #1025, Topic Parent #1024, Type, Status.
3. **Mockup convention** — the doc states `/dev/ds` screenshots or
   token-built SVGs, cited by element name.
4. **Cited paths resolve** — every backticked path with a `savant-ds/`,
   `av-proxy-api/`, `src/`, `vendor/`, or `scripts/` prefix (plus bare
   `angular.json`/`package.json`) is checked on disk; sibling-repo
   prefixes map to the sibling checkouts, everything else stays
   rel-str-relative. Cross-repo citations must carry the repo-name prefix —
   a bare `scripts/…` in an SA row fails, by design.
5. **Tables populated** — extracted-element table has ≥8 rows; candidate
   table has ≥5 rows.

## Pass / fail

- **PASS:** `16/16 checks passed`, exit 0.
- **FAIL:** a check prints `FAIL` with detail; unresolved citations print
  the offending path. Exit 1.

## Notes

- No setup/teardown — read-only.
- If the doc is edited to cite new files, this relay keeps citations honest:
  a renamed/deleted source file will fail the resolution check.
