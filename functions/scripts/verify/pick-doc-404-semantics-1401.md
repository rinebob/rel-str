# pick-doc-404-semantics-1401 — pick-doc 404 semantics probe (#1401)

Verifies the #1401 fix live against the real SA endpoint
(`partnerOptionsDeltaPicksV1`): a shard-gap 404 (`code: 'NOT_FOUND'`) is
skipped as a coverage gap; a Google-infra 404 (no `partnerCode`)
propagates as a fetch failure instead of masquerading as missing data.

## Usage

```powershell
# functions/
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
$env:GOOGLE_IMPERSONATE_SERVICE_ACCOUNT="rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"
npx tsx scripts/verify/pick-doc-404-semantics-1401.ts
```

## Prerequisites

- ADC able to mint an ID token for the partner caller SA — either
  `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT` (as above) or user ADC with
  Service Account Token Creator on `rel-str-partner-caller-prod`
- IPv4 preload on this machine (AT&T IPv6 breakage — see AGENTS.md)
- Read-only — GETs only, no writes, no cleanup needed

## Legs

| Leg | What it proves |
|-----|----------------|
| A — happy path | QQQ put −0.20 45-DTE doc, window 2026-01-05→2026-03-31 → `PickDocument` with days (endpoint + token path work) |
| B — shard-gap skip | Same coordinate, window 2015→2026: every pre-coverage year returns real 404 + `{code:'NOT_FOUND'}` → skipped; merged doc has only ≥2026-01-01 days. **If SA's code drifts from `NOT_FOUND`, this leg throws — it's the regression tripwire for the narrowed skip.** |
| C — infra-404 propagation | Re-execs itself with `PARTNER_PICK_DOC_URL` pointed at `qaNoSuchEndpoint1401` on the real host → genuine Google infra 404 (HTML). `fetchPickDoc` must reject with that error — never `no year shard found`. The #1401 regression leg. |

## Pass / fail

- `PASS` per leg + `=== ALL PASS ===`, exit 0.
- FAIL A → endpoint or auth broken (check ID-token mint first).
- FAIL B → SA changed the shard-miss code, skip logic regressed — **or SA backfilled pre-2026 shards**: days <2026-01-01 are then legitimate data, not a regression; check `partnerPickDoc_shard_skipped` logs before diagnosing.
- FAIL C → a bare 404 was skipped/wrapped again — the exact #1401 bug.

Side effect: each leg logs `partnerPickDoc_request` +
`partnerPickDoc_shard_skipped` / `partnerPickDoc_upstream_error`
entries — expected noise, not failures.
