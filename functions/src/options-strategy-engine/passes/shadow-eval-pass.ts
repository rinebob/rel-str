/**
 * Shim — the real module lives under paper-trading/engine/passes/ (the
 * options-strategy-engine tree is a thin re-export layer kept for import
 * stability).
 *
 * @topic #137 — Strategy Manager
 * @task #1713 — BE: per-tick shadow-eval + first-fire accumulation
 */

export * from '../../paper-trading/engine/passes/shadow-eval-pass';
