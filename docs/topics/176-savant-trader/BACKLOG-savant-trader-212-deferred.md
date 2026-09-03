**Topic:** Savant Trader — deferred cleanup from #212 UAT
**Issue:** #212
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Backlog
**Status:** Open
**Created:** 2026-09-03
**Last Updated:** 2026-09-03

---

## Purpose

Tracks code quality improvements identified during the #212 code review (see `CODE-REVIEW-savant-trader-176-212-r2.md`) that are deferred to future cleanup. These are not blocking — they are judgement-call smells and test coverage gaps.

Architectural/correctness fixes from the same review are tracked in `BACKLOG-savant-trader-205-deferred-from-212.md` under issue #205.

---

## Items

| # | Finding | File(s) | Notes |
|---|---------|---------|-------|
| C1 | Duplicated account redaction | `order-ticket.component.ts`, `order.component.ts` | Extract `redactAccount` helper |
| C2 | Duplicated stepper markup | `order-ticket.component.html` | Reusable stepper component |
| C3 | Repeated switches in queue grouping | `order-queue.component.ts` | Status-to-group map |
| C4 | Repeated switches in group dot colors | `order-queue.component.scss` | Sass map |
| C5 | Primitive obsession — money as string | `signal-review.facade.ts` | Typed money value instead of `String(number)` |
| C6 | Test coverage gaps | `order-ticket.component.spec.ts`, `signal-review.facade.spec.ts`, `order-queue` | Add tests for: cancel, modify, retry, invalid qty, no-account guard, stop-loss validation, guardrails, option/ETF paths, queue grouping, batch-remove |
