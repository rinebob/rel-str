import { COMPARISON_MATRICES } from "../shared/constants/rs.constants";
import { BaselineTargetRankDatum, StringNumberObject, RelStrStockList } from "../shared/types/rs.interfaces";

/**
 * V2-specific RS calc utils
 * - Keeps hyphen-delimited pair IDs (e.g., BASELINE-TARGET)
 * - Keeps subset slicing for performance
 */

export function generatePairData(baselineData: any[], targetData: any[], heatmapColors: string[]) {
  const baselinePercentChangeData = generatePercentChangeData(baselineData);
  const targetPercentChangeData = generatePercentChangeData(targetData);
  const targetRanksData = generateTargetRanksData(baselinePercentChangeData, targetPercentChangeData, heatmapColors);
  return targetRanksData;
}

export function generatePercentChangeData(stockData: ReadonlyArray<Record<string, number>>): StringNumberObject[] {
  const percentChangeData: StringNumberObject[] = [];
  let yestVal = 0;
  let todayVal = 0;
  let value = 0;

  for (const datum of stockData) {
    const date = Object.keys(datum)[0];
    todayVal = Object.values(datum)[0] as number;
    if (yestVal !== 0) {
      value = ((todayVal - yestVal) / yestVal) * 100;
      percentChangeData.push({ date, value });
    }
    yestVal = todayVal;
  }
  return percentChangeData;
}

export function generateTargetRanksData(baseline: StringNumberObject[], target: StringNumberObject[], heatmapColors: string[]): BaselineTargetRankDatum[] {
  // Use a subset for performance
  const USE_DATA_SUBSET = true;
  const DATA_SUBSET_SIZE = 100;
  if (USE_DATA_SUBSET && baseline.length > DATA_SUBSET_SIZE && target.length > DATA_SUBSET_SIZE) {
    baseline = baseline.slice(-DATA_SUBSET_SIZE);
    target = target.slice(-DATA_SUBSET_SIZE);
  }

  const targetRanksWithColors: BaselineTargetRankDatum[] = [];
  for (let i = 5; i < target.length; i++) {
    const date = target[i].date;
    const targetPctChgs: StringNumberObject[] = [];
    const baselinePctChgs: StringNumberObject[] = [];
    for (let j = 0; j <= 4; j++) {
      const baselinePctChange = baseline[i - j];
      const targetPctChange = target[i - j];
      targetPctChgs.push(targetPctChange);
      baselinePctChgs.push(baselinePctChange);
    }
    const rank = calculateRsRank(targetPctChgs, baselinePctChgs);
    const targetRank: StringNumberObject = { date, value: rank };
    const withColor = addColorToRank(targetRank, heatmapColors);
    // attach debug windows non-enumerable
    Object.defineProperty(withColor, '__debugWindows', {
      value: { targetPctChgs: [...targetPctChgs], baselinePctChgs: [...baselinePctChgs] },
      enumerable: false
    });
    targetRanksWithColors.push(withColor);
  }
  return targetRanksWithColors;
}

export function calculateRsRank(target: StringNumberObject[], baseline: StringNumberObject[]): number {
  let outcomesByMatrix: { [key: string]: number } = {};
  for (let i = 0; i < COMPARISON_MATRICES.length; i++) {
    const changes: number[] = [];
    const matrix = COMPARISON_MATRICES[i][0];
    const matrixEls = matrix.split('');
    for (let j = 0; j < matrixEls.length; j++) {
      const el = matrixEls[j];
      const val = el === '1' ? target[j].value : baseline[j].value;
      changes.push(val);
    }
    const pctChg = Number(changes.reduce((acc, v) => acc + v, 0).toFixed(4));
    outcomesByMatrix[matrix] = pctChg;
  }
  const outcomes = Object.entries(outcomesByMatrix);
  outcomes.sort((a, b) => (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0));
  const index = outcomes.findIndex((el) => el[0] === '11111') + 1;
  return index / COMPARISON_MATRICES.length;
}

export type RankColorInput = StringNumberObject;
export type RankColorOutput = BaselineTargetRankDatum;

export function addColorToRank(targetRank: RankColorInput, heatmapColors: readonly string[]): RankColorOutput {
  const colorIdx = Math.floor(targetRank.value * (heatmapColors.length - 1));
  const color = heatmapColors[colorIdx];
  return { ...targetRank, index: colorIdx, color } as BaselineTargetRankDatum;
}

export function getPairsForList(list: RelStrStockList): string[] {
  const baseline = list.baseline;
  const pairs: string[] = [];
  for (const symbol of list.symbols) {
    const pair = `${baseline}-${symbol.symbol}`; // hyphen for v2
    pairs.push(pair);
  }
  return pairs;
}
