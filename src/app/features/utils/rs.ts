// Consolidated RS utilities facade
// Primary exports use optimized implementations by default.
// Original implementations are removed.

import type { BaselineTargetRankDatum, StringNumberObject } from "../common/interfaces-rs";

// Primary (optimized) exports
export { calculateRankOptimized as calculateRank } from "./rs-calc-utils-optimized";
export {
  generateTargetRanksDataOptimized as generateTargetRanksData,
} from "./rs-calc-utils-optimized";

// Utility exports retained from original module
export { generatePercentChangeData, addColorToRank } from "./rs-calc-utils";

// Re-export common types for convenience
export type { BaselineTargetRankDatum, StringNumberObject };
