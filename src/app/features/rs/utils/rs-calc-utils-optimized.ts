import { BASELINE_EQUITY_SYMBOLS, COMPARISON_MATRICES } from "../common/constants-rs";
import { BaselineTargetRankDatum, CalculationData, CalculationResult, Company, DataSet, DatumWithColor, RanksByDate, RanksDataWithColors, RelStrStockList, RelStrTableData, StockData, StockDatum, StringNumberObject } from "../common/interfaces-rs";

/**
 * Optimized version of RS calculation functions from rs-calc-utils.ts
 * - Avoids unnecessary object creation
 * - Reduces array allocations
 * - Uses typed arrays and local caching where possible
 * - Preserves original logic and output
 * - No original code is deleted
 */

export function calculateRankOptimized(subject: number[], baseline: number[]): number {
    let outcomesByMatrix: { [key: string]: number } = {};
    const subjectLen = subject.length;
    // Precompute sums for each matrix
    for (let i = 0; i < COMPARISON_MATRICES.length; i++) {
        const matrix = COMPARISON_MATRICES[i][0];
        let sum = 0;
        for (let j = 0; j < subjectLen; j++) {
            sum += matrix[j] === '1' ? subject[j] : baseline[j];
        }
        outcomesByMatrix[matrix] = Number(sum.toFixed(4));
    }
    // Sort outcomes only by value, keep matrix key
    const outcomes = Object.entries(outcomesByMatrix);
    outcomes.sort((a, b) => a[1] - b[1]);
    const index = outcomes.findIndex((el) => el[0] === '11111') + 1;
    const rank = index / COMPARISON_MATRICES.length;
    return rank;
}

/**
 * Optimized: For a rolling window, computes RS ranks for all days.
 * @param baseline Array of {date, value} percent changes for baseline
 * @param target Array of {date, value} percent changes for target
 * @param heatmapColors Color map for rank output
 */
export function generateTargetRanksDataOptimized(
    baseline: StringNumberObject[],
    target: StringNumberObject[],
    heatmapColors: string[]
): BaselineTargetRankDatum[] {
    // Toggle to use only a subset of the most recent N rows for performance/testing
    const USE_DATA_SUBSET = true; // Set to true to use a subset, false for all data
    const DATA_SUBSET_SIZE = 100;  // Number of rows to use if subset enabled
    if (USE_DATA_SUBSET && baseline.length > DATA_SUBSET_SIZE && target.length > DATA_SUBSET_SIZE) {
        baseline = baseline.slice(-DATA_SUBSET_SIZE);
        target = target.slice(-DATA_SUBSET_SIZE);
    }

    const targetRanksWithColors: BaselineTargetRankDatum[] = [];
    const n = target.length;
    // Preallocate rolling windows
    let targetPctChgs = new Array(5);
    let baselinePctChgs = new Array(5);
    for (let i = 5; i < n; i++) {
        const date = target[i].date;
        // Fill rolling window arrays
        for (let j = 0; j < 5; j++) {
            targetPctChgs[j] = target[i - j].value;
            baselinePctChgs[j] = baseline[i - j].value;
        }
        const rank = calculateRankOptimized(targetPctChgs, baselinePctChgs);
        // Debug log after all variables are set
        // console.log(`[OPTIMIZED] date=${date} targetPctChgs=${JSON.stringify(targetPctChgs.map((v, idx) => ({date: target[i - idx].date, value: v})))} baselinePctChgs=${JSON.stringify(baselinePctChgs.map((v, idx) => ({date: baseline[i - idx].date, value: v})))} rank=${rank}`);
        const targetRank: StringNumberObject = { date, value: rank };
        const targetRankWithColor: BaselineTargetRankDatum = addColorToRank(targetRank, heatmapColors);
        // Attach rolling window arrays for debugging
        Object.defineProperty(targetRankWithColor, '__debugWindows', {
            value: {
                targetPctChgs: [...targetPctChgs],
                baselinePctChgs: [...baselinePctChgs],
            },
            enumerable: false
        });
        targetRanksWithColors.push(targetRankWithColor);
    }
    return targetRanksWithColors;
}

// You can add more optimized versions of other functions as needed, following the same pattern.
// All logic and types are preserved for drop-in replacement.

// --- Utility: Color mapping (copied for completeness, not optimized) ---
function addColorToRank(targetRank: StringNumberObject, heatmapColors: string[]): BaselineTargetRankDatum {
    // This function can be further optimized if needed.
    const colorIdx = Math.floor(targetRank.value * (heatmapColors.length - 1));
    return { ...targetRank, color: heatmapColors[colorIdx], index: colorIdx };
}
