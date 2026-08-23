# Topic #159 — Task Order

Methodical execution order for remaining tasks. Check off as shipped.

## BE (0 remaining)

1. [x] **#167** — Completion signal, watchdog, downstream consumers (shipped)
2. [x] **#168** — Fallback timer and open pass timer (shipped)
3. [x] **#169** — PDRv2 cleanup, dead code, logging, monitoring (QA #175)

## FE (3 remaining)

4. [ ] **#170** — Local bar-read service (IMPL)
   - FE service to read bars from Firestore instead of partner API. Foundation for chart migration.
5. [ ] **#171** — Option chart migration to local bar store (IMPL)
   - Migrate option charts to read from local Firestore.
6. [ ] **#172** — Spread chart migration to local bar store (IMPL)
   - Migrate spread charts to read from local Firestore.

## Done

- [x] **#166** — SDS core: subscriber, worker, intraday doc (shipped 2026-08-23)
