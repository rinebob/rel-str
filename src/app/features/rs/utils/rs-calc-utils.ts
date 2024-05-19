import { BASELINE_EQUITY_SYMBOLS, COMPARISON_MATRICES } from "../common/constants-rs";
import { CalculationData, CalculationResult, DataSet, RanksByDate, RelStrTableData, StockData, StockDatum } from "../common/interfaces-rs";

export function generateRelStrTableDataSet(data: StockData[], baseline: string) {
    let allData = createDataObject(data);
    allData = generatePercentChangesAndRanks(baseline, allData);
    allData = generateFinalDataSet(allData);
    const relStrTableData = generateTableData(allData);
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
        // console.log('a gFDS stock: ', stock);

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
function generateTableData(allData: DataSet): RelStrTableData {
    let symbols: string[] = [];

    for (const symbol of Object.keys(allData)) {
        if (!BASELINE_EQUITY_SYMBOLS.includes(symbol)) {
            symbols.push(symbol);
        }
    }

    const datesData = allData[symbols[0]];
    // console.log('a gDT datesData: ', datesData);
    const dates = Object.keys(datesData.ranksByDate);
    // console.log('a gDT dates: ', dates);

    let tableData = [];
    for (const symbol of symbols) {
        // console.log(`------ ${symbol} ---------------`);
        let rowData: number[] = [];
        for (const date of dates) {
            const value = allData[symbol].ranksByDate[date].rank;
            rowData.push(value);
        }
        tableData.push(rowData);
    }
    // console.log('a gDT tableData: ', tableData);

    const relStrTableData: RelStrTableData = {
        symbols,
        dates,
        data: tableData,
    };

    // console.log('a gDT relStrTableData: ', relStrTableData);

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
    // console.log('a cPC input results.length/results: ', results.length, results);
    for (let i = 1; i < results.length; i++) {
        // console.log('results[i]: ', results[i])
        // const date = results[i].date
        const pctChg = ((results[i].close - results[i - 1].close) / results[i].close) * 100;
        // console.log('a CPC date/close/pctChg: ', results[i].date, results[i].close, pctChg)
        results[i].percentChange = Number(pctChg.toFixed(4));
    }

    return results;
}

function calculateRanks(baseline: StockData, subject: StockData): StockData {
    // console.log(`======== CALCULATE RANKS ================`);
    // console.log('a cRs input results: ', results);

    let subjectPctChgs = [];
    let baselinePctChgs = [];

    for (let i = 5; i < subject.results.length; i++) {
        const day = subject.results[i];
        //   console.log('a cRs i/day data: ', i, day.date, day.close, day.percentChange);

        subjectPctChgs = [];
        baselinePctChgs = [];
        for (let j = 0; j <= 4; j++) {
            subjectPctChgs.push(subject.results[i - j].percentChange);
            baselinePctChgs.push(baseline.results[i - j].percentChange);
        }
        day.rank = calculateRank(subjectPctChgs, baselinePctChgs);

        subject.results[i] = { ...day };
    }

    // console.log('a cRs final subject: ', subject);
    return subject;
}

function calculateRank(subject: number[], baseline: number[]): number {
    // console.log('a cR input pctChgs subject/baseling: ', subject, baseline);
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

    // console.log('a cR final outcomesByMatrix: ', outcomesByMatrix);
    // console.log('a cR O.v(outcomesByMatrix): ', Object.values(outcomesByMatrix));
    // console.log('a cR O.e(outcomesByMatrix): ', Object.entries(outcomesByMatrix));

    const outcomes = Object.entries(outcomesByMatrix);
    outcomes.sort(compare);
    // console.log('a cR sorted outcomes/length: ', outcomes, outcomes.length);

    const index = outcomes.findIndex((el) => el[0] === '11111') + 1;
    rank = index / COMPARISON_MATRICES.length;
    // console.log('a cR 11111 index/rank: ', index, rank);

    return rank;
}

function compare(a: [string, number], b: [string, number]) {
	if (a[1] > b[1]) {
		return 1;
	} else if (a[1] < b[1]) {
		return -1;
	} else return 0;
}
