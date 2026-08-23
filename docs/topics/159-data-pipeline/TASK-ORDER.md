# Topic #159 — Task Order

Methodical execution order for remaining tasks. Check off as shipped.

## BE (3 remaining)

1. [ ] **#167** — Completion signal, watchdog, downstream consumers (IMPL)
   - Next after #166. Adds completion detection to SDS run docs, watchdog for stuck runs, and downstream consumer notification.
2. [ ] **#168** — Fallback timer and open pass timer (IMPL)
   - Safety net timers: fallback PDR if partner doesn't fire, open pass timer for options.
3. [ ] **#169** — PDRv2 cleanup, dead code, logging, monitoring (CHORE)
   - Final cleanup pass after all BE impl is done.

## FE (3 remaining)

4. [ ] **#170** — Local bar-read service (IMPL)
   - FE service to read bars from Firestore instead of partner API. Foundation for chart migration.
5. [ ] **#171** — Option chart migration to local bar store (IMPL)
   - Migrate option charts to read from local Firestore.
6. [ ] **#172** — Spread chart migration to local bar store (IMPL)
   - Migrate spread charts to read from local Firestore.

## Done

- [x] **#166** — SDS core: subscriber, worker, intraday doc (shipped 2026-08-23)
