/**
 * Universal primitives shared across frontend and backend.
 *
 * This file holds domain-agnostic trading/types concepts that are not specific
 * to options, spreads, or any single subsystem. Keep it small and stable.
 */

export enum TradeSide {
  LONG = 'long',
  SHORT = 'short',
}
