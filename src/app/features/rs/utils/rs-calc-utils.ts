import { BASELINE_EQUITY_SYMBOLS, COMPARISON_MATRICES } from "../common/constants-rs";
import { BaselineTargetRankDatum, CalculationData, CalculationResult, Company, DataSet, DatumWithColor, RanksByDate, RanksDataWithColors, RelStrStockList, RelStrTableData, StockData, StockDatum, StringNumberObject } from "../common/interfaces-rs";

/////////////////// START 7/10/24 ////////////////////////

// generates an object with date and rank for a baseline/symbol pair
export function generatePairData(baselineData: StockDatum[], targetData: StockDatum[], heatmapColors: string[] ) {

    const baselinePercentChangeData = generatePercentChangeData(baselineData);
    const targetPercentChangeData = generatePercentChangeData(targetData);
    const targetRanksData = generateTargetRanksData(baselinePercentChangeData, targetPercentChangeData, heatmapColors);

    // console.log('rsCU gPD baseline/target pct chg data: ', baselinePercentChangeData, targetPercentChangeData);
    // console.log('rsCU gPD target ranks data: ', targetRanksData);

    return targetRanksData;

}

function generatePercentChangeData(stockData: StockDatum[]): StringNumberObject[] {
    // console.log('rsCU gPCD symbol: ');

    const percentChangeData: StringNumberObject[] = [];
    let yestVal = 0;
    let todayVal = 0;
    let value = 0;

    for (const datum of stockData) {
        const date = Object.keys(datum)[0];
        todayVal = Object.values(datum)[0];
        if (yestVal !== 0) {
            value = ((todayVal - yestVal) / yestVal) * 100;
            const datum: StringNumberObject = {
                date,
                value,
            }
            percentChangeData.push(datum);
        }

        // console.log('rsCU gPCD yestVal/todayVal/pctChange: ', date, yestVal, todayVal, value);

        yestVal = todayVal;
    }

    return percentChangeData;
    

}

function generateTargetRanksData(baseline: StringNumberObject[], target: StringNumberObject[], heatmapColors: string[]) {
    // console.log(`======== CALCULATE RANKS ================`);
    // console.log('rSUtil cRs input baseline/target: ', baseline, target);

    const targetRanks: StringNumberObject[] = [];
    const targetRanksWithColors: BaselineTargetRankDatum[] = [];
    
    for (let i = 5; i < Object.keys(target).length; i ++) {
        // console.log('rsCU gTRD i/O.k(target)[i]: ', i, Object.keys(target)[i]);
        const date = target[i].date;
        // console.log(`-------- date: ${date} ------------`);
        let targetPctChgs = [];
        let baselinePctChgs = [];

        for (let j = 0; j <= 4; j++) {
            // console.log(`-------- i: ${i} / j: ${j} ------------`);
            // console.log('baseline[i-j]: ', baseline[i-j]);
            // console.log('O.v(baseline[i-j]: 'Object.values);

            const baselinePctChange = Object.values(baseline)[i - j]
            const targetPctChange = Object.values(target)[i - j]
            // console.log('baselinePctChg/targetPctChg: ', baselinePctChange, targetPctChange);

            targetPctChgs.push(targetPctChange);
            baselinePctChgs.push(baselinePctChange);
        }
        // console.log('pctChgs target/baseline: ', targetPctChgs, baselinePctChgs);
        const rank = calculateRsRank(targetPctChgs, baselinePctChgs);
        const targetRank: StringNumberObject = {date, value: rank}
        targetRanks.push(targetRank);
        // console.log('targetRank: ', targetRank);
        const targetRankWithColor: BaselineTargetRankDatum = addColorToRank(targetRank, heatmapColors);
        targetRanksWithColors.push(targetRankWithColor);
        
        
    }
    
    
    // console.log('final targetRanks: ', targetRanks);
    // console.log('final targetRanksWithColors: ', targetRanksWithColors);

    // return targetRanks;
    return targetRanksWithColors;

}

function calculateRsRank(target: StringNumberObject[], baseline: StringNumberObject[]): number {
    // console.log('rSUtil cR input pctChgs target/baseling: ', target, baseline);
    let rank = 0;

    let outcomesByMatrix: { [key: string]: number } = {};
    for (let i = 0; i <= COMPARISON_MATRICES.length - 1; i++) {
        let changes = [];
        const matrix = COMPARISON_MATRICES[i][0];
        const matrixEls = matrix.split('');

        for (let i = 0; i < matrixEls.length; i++) {
            const el = matrixEls[i];
            const val = el === '1' ? target[i].value : baseline[i].value;
            changes.push(val);
        }

        const pctChg = Number(changes.reduce((accumulator, currentValue) => accumulator + currentValue, changes[0]).toFixed(4));

        outcomesByMatrix[matrix] = pctChg;
    }

    // console.log('rSUtil cR final outcomesByMatrix: ', outcomesByMatrix);
    // console.log('rSUtil cR O.v(outcomesByMatrix): ', Object.values(outcomesByMatrix));
    // console.log('rSUtil cR O.e(outcomesByMatrix): ', Object.entries(outcomesByMatrix));

    const outcomes = Object.entries(outcomesByMatrix);
    outcomes.sort(compare);
    // console.log('rSUtil cR sorted outcomes/length: ', outcomes, outcomes.length);

    const index = outcomes.findIndex((el) => el[0] === '11111') + 1;
    rank = index / COMPARISON_MATRICES.length;
    // console.log('rSUtil cR 11111 index/rank: ', index, rank);

    return rank;
}

function addColorToRank(targetRank: StringNumberObject, heatmapColors: string[]): BaselineTargetRankDatum {

    const value = Math.round(targetRank.value * 100);
    const index = Math.round((Number((value * .10).toFixed(2))));
    const color = heatmapColors[index];
    const datum: BaselineTargetRankDatum = {...targetRank, index, color};

    return datum;
}

export function getPairsForList(list: RelStrStockList) {
    // console.log('sLFeat gHD get pairs for list: ', list);
    const baseline = list.baseline;
    let pairs: string[] = [];
    for (const symbol of list.symbols) {
        const pair = `${baseline}_${symbol.symbol}`;
        pairs.push(pair);
    }
    // console.log('sLFeat gHD baseline/pairs: ', baseline, pairs);

    return pairs;

}

export function resolveExistingRanksData(list: RelStrStockList, symbols: Company[]): RanksDataWithColors {
    // console.log('sLF hSL existing list: ', {...list});

    const baseline = list.baseline;
    let pairsToSave: RanksDataWithColors = {};

    const existingPairs = {...list.ranksDataWithColors};
    // console.log('sLF hSL existing pairs: ', {...existingPairs});

    for (const symbol of symbols) {
        const pair = `${baseline}_${symbol.symbol}`;
        // console.log('sLF hSL pair to save: ', pair);
        if (!!existingPairs[pair]) {
            // console.log('sLF hSL pair exists - add to list');
            pairsToSave[pair] = existingPairs[pair];
        } else {
            // console.log('sLF hSL pair doesnt exist');
        }
    }
    // console.log('sLF hSL pairs to save: ', pairsToSave);
    return pairsToSave;
}
////////////////////////////////////////////////////////

/////////////// INITIAL IMPLEMENTATIONS ///////////////////////////

export function generateRelStrTableDataSet(data: StockData[], baseline: string, heatmapColors: string[]) {
    let allData = createDataObject(data);
    allData = generatePercentChangesAndRanks(baseline, allData);
    allData = generateFinalDataSet(allData);
    const relStrTableData = generateTableData(allData, heatmapColors);
    // console.log('rSU gRSTDS final allData object: ', allData);
    // console.log('rSU gRSTDS final relStrTableData object: ', relStrTableData);

    return {allData, relStrTableData};
}

// Create an initial data object key = stock symbol value = DataSet object for the symbol
// only the properties 'symbol' and 'data' are populated
function createDataObject(data: StockData[]): DataSet {
    // console.log('********** RS CALC UTILS createDataObject ************');
    const allData: DataSet = {};
    for (const stock of Object.values(data)) {
        const data: StockData = {
            symbol: stock.symbol,
            data: stock.data,
            results: [],
            resultsByDate: {},
            ranksByDate: {},
        };
        allData[stock.symbol] = data;
    }

    // console.log('rSU cDO final data object: ', allData);

    return allData;
}

// Update the same data object with daily percent change and relative strength ranks
function generatePercentChangesAndRanks(baseline: string, allData: DataSet): DataSet {
    // console.log('********** RS CALC UTILS populateResultsData ************');
    const stockSymbols = Object.keys(allData);
    // console.log('rSU gR input symbols/allData: ', stockSymbols, allData);

    // Generate the CalculationData objects and percent change data for each symbol
    for (const symbol of stockSymbols) {
        // console.log(`-------- percentChange for ${symbol} ----------------`);
        const stockData = allData[symbol];
        // console.log('rSU gR symbol/stockData: ', symbol, allData[symbol]);
        const emptyPercentChangesAndRanks = generateEmptyResultsObjects(stockData.data)
        const percentChanges = calculatePercentChange(emptyPercentChangesAndRanks);
        // console.log('rSU gR percentChanges: ', percentChanges);
        stockData.results = percentChanges;
    }
    // console.log('rSU gR allData with percentChanges: ', allData);
    
    // Calculate ranks for each symbol vs. baseline
    for (const symbol of stockSymbols) {
        // console.log(`-------- ranks for ${symbol} ----------------`);
        allData[symbol] = calculateRanks(allData[baseline], allData[symbol]);
    }
    // console.log('rSU gR allData with percentChanges and ranks: ', allData);


    return allData;
}

function generateFinalDataSet(allData: DataSet): DataSet {
    // console.log('********** RS CALC UTILS generateFinalDataSet ************');

    for (const stock of Object.values(allData)) {
        // console.log('rSUtil gFDS stock: ', stock);

        let calculationResult: CalculationResult = {};
        let ranksByDate: RanksByDate = {};
        for (const result of stock.results) {
            if (result.rank !== 0) {
                calculationResult[result.date] = result;
                ranksByDate[result.date] = { rank: result.rank };
            }
        }

        stock.resultsByDate = calculationResult;
        stock.ranksByDate = ranksByDate;
    }


    return allData;
}

// Generate the data set used in the UI to render the RelStr Heat Map
// Output is a ResStrTableData object with properties
// symbols: array of stock symbol strings
// dates: array of dates corresponding to the dates of each stock price in the data set
// data: Array of arrays.  Inner array is an array of numbers corresponding to the rank 
// for each day for that symbol.  Outer array has elements of the inner array for each symbol
// 7-2-24 - adding color value to the inner array
// use interface DatumWithColor {datum: number, color: string} 
function generateTableData(allData: DataSet, heatmapColors: string[]): RelStrTableData {
    let symbols: string[] = [];

    // console.log('rSUtil gDT input allData: ', allData);
    // console.log('rSUtil gDT input heatmap colors: ', heatmapColors);

    for (const symbol of Object.keys(allData)) {
        if (!BASELINE_EQUITY_SYMBOLS.includes(symbol)) {
            symbols.push(symbol);
        }
    }

    const datesData = allData[symbols[0]];
    // console.log('rSUtil gDT datesData: ', datesData);
    const dates = Object.keys(datesData.ranksByDate);
    // console.log('rSUtil gDT dates: ', dates);

    let tableData = [];
    // const colorArray = generateColorArray(11);
    for (const symbol of symbols) {
        // console.log(`------ ${symbol} ---------------`);
        // let rowData: number[] = [];
        let rowData: DatumWithColor[] = [];
        for (const date of dates) {
            // console.log('rSUtil gDT date: ', date);
            // console.log('rSUtil gDT allData[symbol].ranksByDate[date]: ', allData[symbol].ranksByDate[date]);
            // const value = allData[symbol].ranksByDate[date].rank;
            const value = Math.round(allData[symbol].ranksByDate[date].rank * 100);
            // rowData.push(value);
            const index = Math.round((Number((value * .10).toFixed(2))));
            const color = heatmapColors[index];
            const datum: DatumWithColor = {value, color, index};
            // console.log('rank/index/color/datum: ', value, index, color, datum);
            rowData.push(datum);
        }
        tableData.push(rowData);
    }
    // console.log('rSUtil gDT tableData: ', tableData);

    const relStrTableData: RelStrTableData = {
        symbols,
        dates,
        data: tableData,
    };

    // console.log('rSUtil gDT relStrTableData: ', relStrTableData);

    return relStrTableData;


}

function generateEmptyResultsObjects(stockData: StockDatum[]): CalculationData[] {
    let emptyPercentChangesAndRanks: CalculationData[] = [];
    for (const datum of Object.values(stockData)) {
        // console.log('rSU gR date/close: ', Object.keys(datum)[0], Object.values(datum)[0]);
        const result: CalculationData = {
            date: Object.keys(datum)[0],
            close: Object.values(datum)[0],
            percentChange: 0,
            rank: 0,
        };
        emptyPercentChangesAndRanks.push(result);
    }

    return emptyPercentChangesAndRanks;
}

function calculatePercentChange(results: CalculationData[]): CalculationData[] {
    // console.log('********** RS CALC UTILS calculatePercentChange ************');
    // console.log('rSUtil cPC input results.length/results: ', results.length, results);
    for (let i = 1; i < results.length; i++) {
        // console.log('results[i]: ', results[i])
        // const date = results[i].date
        const pctChg = ((results[i].close - results[i - 1].close) / results[i].close) * 100;
        // console.log('rSUtil CPC date/close/pctChg: ', results[i].date, results[i].close, pctChg)
        results[i].percentChange = Number(pctChg.toFixed(4));
    }

    return results;
}

function calculateRanks(baseline: StockData, subject: StockData): StockData {
    // console.log(`======== CALCULATE RANKS ================`);
    // console.log('rSUtil cRs input baseline/target: ', baseline/subject);

    let subjectPctChgs = [];
    let baselinePctChgs = [];

    for (let i = 5; i < subject.results.length; i++) {
        const day = subject.results[i];
        //   console.log('rSUtil cRs i/day data: ', i, day.date, day.close, day.percentChange);

        subjectPctChgs = [];
        baselinePctChgs = [];
        for (let j = 0; j <= 4; j++) {
            subjectPctChgs.push(subject.results[i - j].percentChange);
            baselinePctChgs.push(baseline.results[i - j].percentChange);
        }
        day.rank = calculateRank(subjectPctChgs, baselinePctChgs);

        subject.results[i] = { ...day };
    }

    // console.log('rSUtil cRs final subject: ', subject);
    return subject;
}

function calculateRank(subject: number[], baseline: number[]): number {
    // console.log('rSUtil cR input pctChgs subject/baseling: ', subject, baseline);
    let rank = 0;

    let outcomesByMatrix: { [key: string]: number } = {};
    for (let i = 0; i <= COMPARISON_MATRICES.length - 1; i++) {
        let changes = [];
        const matrix = COMPARISON_MATRICES[i][0];
        const matrixEls = matrix.split('');

        for (let i = 0; i < matrixEls.length; i++) {
            const el = matrixEls[i];
            const val = el === '1' ? subject[i] : baseline[i];
            changes.push(val);
        }

        const pctChg = Number(changes.reduce((accumulator, currentValue) => accumulator + currentValue, changes[0]).toFixed(4));

        outcomesByMatrix[matrix] = pctChg;
    }

    // console.log('rSUtil cR final outcomesByMatrix: ', outcomesByMatrix);
    // console.log('rSUtil cR O.v(outcomesByMatrix): ', Object.values(outcomesByMatrix));
    // console.log('rSUtil cR O.e(outcomesByMatrix): ', Object.entries(outcomesByMatrix));

    const outcomes = Object.entries(outcomesByMatrix);
    outcomes.sort(compare);
    // console.log('rSUtil cR sorted outcomes/length: ', outcomes, outcomes.length);

    const index = outcomes.findIndex((el) => el[0] === '11111') + 1;
    rank = index / COMPARISON_MATRICES.length;
    // console.log('rSUtil cR 11111 index/rank: ', index, rank);

    return rank;
}

function compare(a: [string, number], b: [string, number]) {
	if (a[1] > b[1]) {
		return 1;
	} else if (a[1] < b[1]) {
		return -1;
	} else return 0;
}
