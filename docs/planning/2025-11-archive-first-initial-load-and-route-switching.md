> **Transition Note (Multi-Interval RS):** This document assumes a daily-only RS model with `signals-daily` and/or `pairs-data.data[]`. A multi-interval RS transition is now planned; see `docs/planning/MULTI_INTERVAL_RS_TRANSITION.md` for the up-to-date design. This file will be updated once implementation is complete.

# Archive-First Strategy: Initial Load Latency and Fast Route Switching (Nov 2025)

## Decision
- Deprecate Legacy RS reads (root doc `pairs-data/{PAIR}`) and adopt Archive-based reads (`pairs-data/{PAIR}/archive-YYYY/{YYMMDD}`) as the authoritative path.
- Keep the UI ultra-smooth once data is in-memory; focus on minimizing initial load latency and route-switch latency (Dashboard V2 ↔ Decision Board).

## Current Behavior (Prod)
- After data is in memory, scrolling across full history is extremely fast and jank-free.
- The perceived latency is concentrated in initial reads (cold load or first visit after a while).

## Goals
- Time-to-first-meaningful-render (TTFMR) ≤ 2–3s for both views.
- Data starts appearing immediately and continues to stream without blocking interaction.
- Switching between views does not incur a cold-start penalty when possible.

## Constraints and Realities
- Archive implies multiple sub-collection reads (per-year shards).
- The number of selected pairs can be large; naive serial reads multiply network RTT.
- Firestore limits and quotas require controlled concurrency.

## Proposed Approach (Discussion Only)

### 1) Progressive, Staged Loading (Per View)
- Stage A: Fetch minimal slices needed to render quickly (e.g., last N days). Paint the heatmap or decision data immediately.
- Stage B: Incrementally backfill older years in the background; merge into state without blocking.
- Stage C: When idle, prefetch adjacent data ranges likely to be needed next.

### 2) Parallelization with Concurrency Caps
- Per-Pair: Load series for multiple pairs concurrently (bounded pool size) to reduce wall-clock time.
- Per-Year (Archive): Load yearly shards in parallel with a small cap (e.g., 3–4) to balance speed and Firestore limits.
- Early Abort: If a hard error (e.g., permission or not-found) occurs, stop remaining shard fetches for that pair and surface fallback/UX messaging quickly.

### 3) Client-Side Caching and Reuse
- In-memory TTL cache keyed by `(pairId, view, data-scope)`, so toggling routes or reselecting lists reuses already-fetched series.
- Warm cache through idle-time prefetching for the “other” view (Dashboard ↔ Decision Board).
- Cache invalidation policies tied to time (TTL), user-triggered refresh, or backend update signals.

### 4) Route-Switch Optimizations
- Preload the next view’s critical data slices during idle time while the user is engaged in the current view.
- Preserve view state and data store when navigating; avoid re-instantiation that discards warm memory.
- Show immediate UI with cached data, and then reconcile with fresh fetches in the background.

### 5) Perceived-Performance UX
- Immediate skeletons/placeholders for grids/cells.
- Lightweight progress indicators for background backfills.
- Avoid blocking spinners; let users interact while data streams in.

### 6) Measurement and Guardrails
- Instrument TTFMR and wall-clock for: initial slice, total backfill, and route-switch refresh.
- Log request counts, concurrency levels, and any throttling.
- Monitor Firestore read costs and adjust concurrency/TTL accordingly.

## What We Are Not Doing
- Keeping Legacy as a primary path. Legacy will be deprecated, only retained temporarily if required as a safety fallback during rollout.

## Open Questions
- Minimum slice for Stage A: How many days are necessary for a meaningful heatmap on first paint?
- Acceptable TTL for cache in prod (e.g., 5–15 minutes)?
- Do we limit historical depth for certain views, or is full history always required?

## Next Steps
- Adopt archive-first across the code paths.
- Implement staged loading and bounded parallelism.
- Add in-memory TTL cache and idle-time prefetch, focusing on cross-view reuse.
- Measure, tune caps, and revisit UX affordances based on real telemetry.
- TODO[deprecate]: Remove root `pairs-data/{PAIR}` fields `data` and `latest` (FE readers, BE writers) once Decision Board and any legacy paths stop relying on them. Archive shards remain authoritative.
