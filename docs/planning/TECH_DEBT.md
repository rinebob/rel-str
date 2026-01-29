# RS Tech Debt

## Ideas

### Must-have

- [ ] CFSTR follow-on: actual Cloud Functions filesystem migration from `webhooks/*` into the new partner/rs/admin structure (implementation efforts after RS-BE-MAINT-CFSTR-2601-01).
- [ ] Tests: expand Jest unit test coverage for core RS pipelines (PDR/FRBARR) and critical callables; ensure new work ships with tests by default.
- [ ] Centralize all Firestore collection/path constants (including `system/rs-backfill-runs/runs` and `system/rs-time-series-jobs/dates`) into a shared enum instead of scattering string constants across RS/time-series and webhooks code.

### Nice-to-have

- [ ] Emulator workflow polish: scripts and docs for starting/stopping emulators, refreshing exports, and common local-debug paths.

### Exploratory / Parking Lot

- [ ] <Add tech-debt investigations or uncertain items here>

## Implementation order

### Next

- [ ] <Promote concrete tech-debt items from Ideas into this bucket when ready to schedule>

### Then

- [ ] <Second-tier tech-debt work to follow after Next items>

### Later

- [ ] Long-term logging/metrics uplift (structured logging, better correlation IDs, and dashboards for RS backfill/realtime health).

---

## Changelog

- 2026-01-25 – Created TECH_DEBT with Ideas/Implementation order buckets and seeded initial items (CFSTR follow-on, tests, emulator workflow, logging/metrics).
- 2026-01-25 – Added tech-debt item to centralize Firestore collection/path constants, including new RS backfill/time-series system roots.
