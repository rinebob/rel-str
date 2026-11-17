/**
 * Shim — the real module lives under paper-trading/engine/passes/ (the
 * options-strategy-engine tree is a thin re-export layer kept for import
 * stability).
 *
 * @topic #137 — Strategy Builder UI
 * @task #1544 — BE: Exit-scan pass over position marks
 */

export * from '../../paper-trading/engine/passes/manage-exit-scan-pass';
