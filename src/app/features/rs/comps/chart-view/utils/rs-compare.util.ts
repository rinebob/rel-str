/**
 * Utility for running RS dataset comparison between two sets of OHLC data.
 * Delegates to compareRsDatasets and generates a summary string for the UI.
 */
import { compareRsDatasets } from '../../utils/rs-calc-utils-compare';
import { generatePercentChangeData, addColorToRank } from '../../utils/rs-calc-utils';
import { generateColorArray } from '../../utils/color-utils';
import type { CandleWithRSColor } from '../chart-two/chart-two.component';

export function runRsComparisonUtil(msftData: CandleWithRSColor[], qqqData: CandleWithRSColor[]): string {
  if (!msftData.length || !qqqData.length) {
    return `Error: MSFT or QQQ data missing (msft: ${msftData.length}, qqq: ${qqqData.length})`;
  }
  const msftCloses = msftData.map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
  const qqqCloses = qqqData.map(d => ({ [d.x.toISOString().slice(0,10)]: d.close }));
  const msftPct = generatePercentChangeData(msftCloses).slice(5);
  const qqqPct = generatePercentChangeData(qqqCloses).slice(5);
  const heatmapColors = generateColorArray(11);
  const result = compareRsDatasets(qqqPct, msftPct, heatmapColors);
  if (result.mismatches.length === 0) {
    return 'All results match!';
  } else {
    return `${result.mismatches.length} mismatches found`;
  }
}
