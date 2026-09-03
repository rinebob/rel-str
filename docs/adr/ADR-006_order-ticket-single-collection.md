# Single Order Ticket collection replaces occurrence-decisions and order-intents

**Status:** Accepted

The signal-review decision pipeline used two Firestore collections — `occurrence-decisions` (the durable ACCEPT/REJECT decision) and `order-intents` (the proposed broker order) — created together on accept but with independent lifecycles. They diverged: resets deleted decisions but not intents, TTL cleaned up decisions after 7 days but intents persisted indefinitely, and different load paths meant the signal review status and the order page list could show different things for the same symbol.

We decided to merge both into a single `order-tickets` collection. One document per accepted symbol per user. Accepting creates the ticket; toggling accept off deletes it. One source of truth for "is this symbol accepted," read by signal review, the order page, and the header count. 3-day TTL.

The rejected alternative was keeping two collections and fixing the sync (transactional writes, matching TTLs, shared reset logic). This was rejected because the two concepts — "I decided this signal is good" and "I want to place an order for this" — are the same action in the user's mind. Maintaining two documents for one user action is the root cause of the divergence, and no amount of sync logic fixes that root cause.

## Consequences

- One ticket per symbol means multi-occurrence signals (e.g., LONG + SHORT on the same symbol in the same run) collapse to one ticket. Last write wins. Acceptable per user requirements.
- REJECT and CONSIDER decisions are no longer persisted. Not accepting a signal is the default state; there is no "I explicitly decided not to trade this" document. Acceptable — the user rarely used these and they added cognitive load without value.
- The glossary terms "Order Intent" and "Order Draft" are retired, replaced by "Order Ticket."
