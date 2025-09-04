import { ChartComponent, VisibleRangeModel } from "@syncfusion/ej2-angular-charts";
import { CandleWithRSColor, OHLCDatum } from "../../common/interfaces-rs";

export function getXExtents(range: VisibleRangeModel): {minX: number, maxX: number} {
    // console.log('------------- fn getXExtents ------------------');
    // console.log('fn gXE input range: ', range);
    const minX = range.min || 0;
    const maxX = range.max || 0;
    // console.log('fn gXE min/max: ', minX, maxX);
    return {minX, maxX};
}

export function autoscaleYAxis(chartData: CandleWithRSColor[], baselineData: OHLCDatum[], chartComponent: ChartComponent): ChartComponent | undefined {
    // console.log('------------- fn AYA autoscaleYAxis ------------------');
    // console.log('fn aYA input chartDataLength/chartData/component: ', chartData.length, chartData, chartComponent);
    if (!chartData.length || !chartComponent || !chartComponent.primaryXAxis) return;
    
    // Use Syncfusion's visible X range
    const xAxis = chartComponent.primaryXAxis;
    const xRange = (xAxis as any).visibleRange;
    // console.log('fn aYA xRange: ', xRange);
    if (!xRange) return;
    
    const minX = xRange.min;
    const maxX = xRange.max;
    
    // Filter both datasets to visible X range
    const filterVisible = <T extends OHLCDatum>(data: T[]): T[] => {
        return data.filter((d) => {
            const xVal = d.x instanceof Date ? d.x.getTime() : d.x;
            return xVal >= minX && xVal <= maxX;
        });
    };
    
    const visibleChartData = filterVisible(chartData);
    const visibleBaselineData = baselineData ? filterVisible(baselineData) : [];
    
    if (!visibleChartData.length && !visibleBaselineData.length) {
        return;
    }
    
    // Find min/max across both datasets
    const allVisibleData = [...visibleChartData, ...visibleBaselineData];
    const min = Math.min(...allVisibleData.map((d) => d.low));
    const max = Math.max(...allVisibleData.map((d) => d.high));
    
    // Update chart Y-axis
    chartComponent.primaryYAxis.minimum = min;
    chartComponent.primaryYAxis.maximum = max;
    chartComponent.dataBind()
    // console.log('fn aYA Set chartComponent.primaryYAxis.maximum:', chartComponent.primaryYAxis.maximum);
    return chartComponent
}

export function autoscaleYAxisForRange(chartData: CandleWithRSColor[], baselineData: OHLCDatum[], chartComponent: ChartComponent, minX: number | Date, maxX: number | Date): ChartComponent | undefined {
    // console.log('------------- fn AYAFR autoscaleYAxisForRange ------------------');
    // console.log('fn aYAFR input chartDataLength/chartData/component: ', chartData.length, chartData, chartComponent);
    // console.log('fn aYAFR input min/max: ', chartData.length, chartData, chartComponent);
    if (!chartData.length) return;
    
    const minVal = typeof minX === 'number' ? minX : minX.getTime();
    const maxVal = typeof maxX === 'number' ? maxX : maxX.getTime();
    
    // Filter both datasets to the specified X range
    const filterVisible = <T extends OHLCDatum>(data: T[]): T[] => {
        return data.filter((d) => {
            const xVal = d.x instanceof Date ? d.x.getTime() : d.x;
            return xVal >= minVal && xVal <= maxVal;
        });
    };
    
    const visibleChartData = filterVisible(chartData);
    const visibleBaselineData = baselineData ? filterVisible(baselineData) : [];
    
    if (!visibleChartData.length && !visibleBaselineData.length) {
        return;
    }
    
    // Find min/max across both datasets
    const allVisibleData = [...visibleChartData, ...visibleBaselineData];
    const min = Math.min(...allVisibleData.map((d) => d.low));
    const max = Math.max(...allVisibleData.map((d) => d.high));
    
    const firstDate = allVisibleData[0]?.x;
    const lastDate = allVisibleData[allVisibleData.length - 1]?.x;
    // console.log('fn aYAFR Visible data range:', firstDate, 'to', lastDate);
    // console.log('fn aYAFR Highest high in visible data:', max);
    
    if (chartComponent?.primaryYAxis) {
        chartComponent.primaryYAxis.minimum = min;
        chartComponent.primaryYAxis.maximum = max;
        // console.log('fn aYAFR Set chartComponent.primaryYAxis.maximum:', chartComponent.primaryYAxis.maximum);
    }
    return chartComponent;
}


/**
 * Loads both QQQ and MSFT CSVs, parses them, and runs RS comparison on page load.
 */
// private loadBothCSVsAndCompare(): void {
// 	const msftUrl = '/assets/data/BATS_MSFT, 1D_0d494.csv';
// 	const qqqUrl = '/assets/data/BATS_QQQ, 1D_862dd.csv';
// 	forkJoin({
// 		msftCsv: this.http.get(msftUrl, { responseType: 'text' }).pipe(catchError(() => of(null))),
// 		qqqCsv: this.http.get(qqqUrl, { responseType: 'text' }).pipe(catchError(() => of(null))),
// 	}).subscribe({
// 		next: ({ msftCsv, qqqCsv }) => {
// 			if (!msftCsv || !qqqCsv) {
// 				this.rsComparisonSummary.set('Error: Missing or empty CSV data');
// 				return;
// 			}
// 			// Parse MSFT using utility
// 			const msftOhlc = parseOhlcCsv(msftCsv);
// 			const qqqOhlc = parseOhlcCsv(qqqCsv);
// 			// Defensive: log and validate parsed data
// 			// eslint-disable-next-line no-console
// 			console.debug('[ChartView] Parsed msftOhlc:', msftOhlc);
// 			// eslint-disable-next-line no-console
// 			console.debug('[ChartView] Parsed qqqOhlc:', qqqOhlc);
// 			if (!Array.isArray(msftOhlc) || !Array.isArray(qqqOhlc)) {
// 				this.rsComparisonSummary.set('Error: Parsed CSV data invalid');
// 				// eslint-disable-next-line no-console
// 				console.error('[ChartView] Parsed CSV data invalid:', { msftOhlc, qqqOhlc });
// 				return;
// 			}
// 			/** Use subset toggle from signal (UI-driven) */
// 			const USE_CHART_DATA_SUBSET = this.useDataSubset();
// 			const CHART_DATA_SUBSET_SIZE = 100;
// 			// Slice both MSFT and QQQ to the subset first
// 			const msftOhlcToUse = USE_CHART_DATA_SUBSET ? msftOhlc.slice(-CHART_DATA_SUBSET_SIZE) : msftOhlc;
// 			const qqqOhlcToUse = USE_CHART_DATA_SUBSET ? qqqOhlc.slice(-CHART_DATA_SUBSET_SIZE) : qqqOhlc;
// 			// --- Refactored RS color assignment to match Heatmap logic ---
// 			const heatmapColors = generateColorArray(11);
// 			// Build StockData[] from parsed CSVs for MSFT and QQQ
// 			// Convert parsed candles to StockDatum[] (date string -> close price)
// 			const msftStockData = {
// 				symbol: 'MSFT',
// 				data: msftOhlcToUse.map((candle) => ({ [candle.x.toISOString().slice(0, 10)]: candle.close })),
// 				results: [],
// 				resultsByDate: {},
// 				ranksByDate: {},
// 			};
// 			const qqqStockData = {
// 				symbol: 'QQQ',
// 				data: qqqOhlcToUse.map((candle) => ({ [candle.x.toISOString().slice(0, 10)]: candle.close })),
// 				results: [],
// 				resultsByDate: {},
// 				ranksByDate: {},
// 			};

// 			const csvStockDataArr = [msftStockData, qqqStockData];
// 			// Generate RS dataset using only CSV data, baseline QQQ
// 			const { allData } = generateRelStrTableDataSet(csvStockDataArr, 'QQQ', heatmapColors);
// 			const msftSymbol = 'MSFT';
// 			const msftRanksByDate = allData[msftSymbol]?.ranksByDate || {};

// 			// Assign rsColor to each candle in the sliced MSFT data
// 			const msftColoredOhlcToUse = msftOhlcToUse.map((candle: CandleWithRSColor) => {
// 				const dateStr = candle.x.toISOString().slice(0, 10);
// 				const rankEntry = msftRanksByDate[dateStr];
// 				let rsColor: string | undefined;
// 				if (rankEntry && typeof rankEntry.rank === 'number') {
// 					const colorIdx = Math.round(rankEntry.rank * (heatmapColors.length - 1));
// 					rsColor = heatmapColors[colorIdx];
// 				}
// 				return {
// 					...candle,
// 					rsColor,
// 					rank: rankEntry ? rankEntry.rank : undefined,
// 				};
// 			});
// 			// Set both msftData and candleData to the colored, sliced MSFT data
// 			this.msftData.set(msftColoredOhlcToUse);
// 			this.candleData.set(msftColoredOhlcToUse);

// 			// console.log('cV lBCAC candleData 0-50: ', this.candleData().slice(0, 50));
// 			// console.log('cV lBCAC candleData: ', this.candleData());

// 			this.updateVisibleCandleData();
// 			this.qqqData.set(qqqOhlcToUse);
// 			this.runRsComparison();

// 			// console.log('cV lBCAC qqqData: ', this.qqqData());
// 		},
// 		error: () => {
// 			this.rsComparisonSummary.set('Error: Failed to load CSVs');
// 		},
// 	});
// }

/**
 * Runs RS dataset comparison between QQQ and MSFT and stores a summary for the UI.
 */
// private runRsComparison(): void {
// 	const msft = this.msftData();
// 	const qqq = this.qqqData();
// 	if (!msft || !Array.isArray(msft) || !msft.length || !qqq || !Array.isArray(qqq) || !qqq.length) {
// 		this.rsComparisonSummary.set(`Error: MSFT or QQQ data missing (msft: ${msft ? msft.length : 'n/a'}, qqq: ${qqq ? qqq.length : 'n/a'})`);
// 		return;
// 	}
// 	const msftCloses = msft.map((d) => ({ [d.x.toISOString().slice(0, 10)]: d.close }));
// 	const qqqCloses = qqq.map((d) => ({ [d.x.toISOString().slice(0, 10)]: d.close }));
// 	const msftPct = generatePercentChangeData(msftCloses);
// 	const qqqPct = generatePercentChangeData(qqqCloses);
// 	const msftPctWindowed = msftPct.slice(5);
// 	const qqqPctWindowed = qqqPct.slice(5);
// 	const heatmapColors = generateColorArray(11);
// 	const result = compareRsDatasets(qqqPctWindowed, msftPctWindowed, heatmapColors);
// 	if (result.mismatches.length === 0) {
// 		this.rsComparisonSummary.set('All results match!');
// 	} else {
// 		this.rsComparisonSummary.set(`${result.mismatches.length} mismatches found`);
// 	}
// }