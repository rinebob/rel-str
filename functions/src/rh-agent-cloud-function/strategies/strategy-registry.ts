/**
 * Strategy Registry
 *
 * Central registry that maps strategy IDs to their implementations.
 * Strategies are imported explicitly (no dynamic require in Cloud Functions).
 *
 * Usage:
 *   import { strategyRegistry } from './strategies';
 *   const strategy = strategyRegistry.get('st-trend-rider');
 *   const signals = strategy.execute(input, config);
 */

import type { StrategyAdapter, StrategyMetadata, StrategyConfig } from './base-strategy';

// Import all strategy adapters
import { adapter as stTrendRiderAdapter } from './st-trend-rider/st-trend-rider.strategy';
import { adapter as leapDropAdapter } from './leap-drop/leap-drop.strategy';

// =============================================================================
// REGISTRY CLASS
// =============================================================================

class StrategyRegistry {
  private strategies = new Map<string, StrategyAdapter>();

  /**
   * Register a strategy adapter.
   */
  register(adapter: StrategyAdapter): void {
    if (this.strategies.has(adapter.metadata.id)) {
      throw new Error(`Strategy '${adapter.metadata.id}' already registered`);
    }
    this.strategies.set(adapter.metadata.id, adapter);
  }

  /**
   * Get a strategy by ID.
   * Throws if not found.
   */
  get(id: string): StrategyAdapter {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`Strategy '${id}' not registered. Available: ${this.listIds().join(', ')}`);
    }
    return strategy;
  }

  /**
   * Check if a strategy is registered.
   */
  has(id: string): boolean {
    return this.strategies.has(id);
  }

  /**
   * List all registered strategy metadata (for UI discovery).
   */
  list(): StrategyMetadata[] {
    return Array.from(this.strategies.values()).map(s => s.metadata);
  }

  /**
   * List all registered strategy IDs.
   */
  listIds(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Validate a config against a strategy's schema.
   * Returns true if valid, error messages if not.
   */
  validateConfig(strategyId: string, config: StrategyConfig): { valid: boolean; errors: string[] } {
    const strategy = this.get(strategyId);
    const schema = strategy.metadata.configSchema;

    if (!schema) return { valid: true, errors: [] };

    const errors: string[] = [];
    for (const [key, field] of Object.entries(schema)) {
      const value = config[key];
      if (value === undefined) continue;

      if (field.type === 'integer' || field.type === 'number') {
        if (typeof value !== 'number') {
          errors.push(`${key}: expected ${field.type}, got ${typeof value}`);
          continue;
        }
        if (field.min !== undefined && value < field.min) {
          errors.push(`${key}: ${value} < min ${field.min}`);
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(`${key}: ${value} > max ${field.max}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// =============================================================================
// SINGLETON INSTANCE + AUTO-REGISTRATION
// =============================================================================

export const strategyRegistry = new StrategyRegistry();

// Register all strategies at module load
strategyRegistry.register(stTrendRiderAdapter);
strategyRegistry.register(leapDropAdapter);

// Re-export types for convenience
export type { StrategyAdapter, StrategyInput, StrategyOutput, StrategyConfig, StrategyMetadata } from './base-strategy';
