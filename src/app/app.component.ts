import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CalculationData, CalculationResult, DataSet, RanksByDate, RelStrTableData, ResultsDataSet, StockData, StockDatum, StockRanks, StockResults } from './interfaces';
import * as stockData from '../assets/data/stocks';
import { BASELINE_EQUITY_SYMBOLS, COMPARISON_MATRICES } from './constants';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'rel-str';

  allData = signal<DataSet>({});

  relStrTableData = signal<RelStrTableData>({symbols: [], dates: [], data: [[]]});

  ngOnInit() {
    this.createDataObject();
    this.generateResults('QQQ');    // param = baseline symbol
    this.generateFinalDataSet();
    this.generateDataTable();

  }

  createDataObject() {
    // console.log('======== CREATE DATA OBJECT ================');
    const allData: DataSet = {};
    for (const stock of Object.values(stockData)) {
      const data: StockData = {symbol: stock.symbol, data: stock.data, results: [], resultsByDate: {}, ranksByDate: {}};
      allData[stock.symbol] = data;
    }

    // console.log('a cDO final data object: ', allData);
    this.allData.set(allData);
  }

  generateResults(baseline: string) {
    // console.log('======== GENERATE RESULTS ================');
    // console.log('a gR input data set: ', this.allData());
    const allData = this.allData();
    
    const stockSymbols = Object.keys(allData);
    // console.log('stockSymbols: ', stockSymbols);

    // Genereate percent change values for all stocks
    for (const symbol of stockSymbols) {
      // console.log(`-------- ${symbol} ----------------`);
      const stock = allData[symbol]
      // console.log('a gR symbol/stock: ', symbol, allData[symbol]);
      const stockData = Object.values(stock.data);
      // console.log('a gR stockData: ', stockData);
      let results: CalculationData[] = [];
      
      for (const stock of Object.values(stockData)) {
        // console.log('a gR date/close: ', Object.keys(stock)[0], Object.values(stock)[0]);
        const result: CalculationData = {
          date: Object.keys(stock)[0],
          close: Object.values(stock)[0],
          percentChange: 0,
          rank: 0,
        }
        
        results.push(result);
        
      }
      results = this.calculatePercentChange(results);
      stock.results = results;
      // console.log('a gR final stock/results: ', symbol, results);

    }

    this.allData.update(data => ({
      ...data,
      ...allData
    }));
    // console.log('a gR final data set: ', allData);
    
    // Generate ranks
    let newSubjects: {[key: string]: StockData} = {};
    for (const symbol of stockSymbols) {
      // console.log('a gR generate ranks for symbol: ', symbol);
      let subject = {...allData[symbol]};
      const baselineStock = {...allData[baseline]};
      if (!BASELINE_EQUITY_SYMBOLS.includes(symbol)) {
        subject = this.calculateRanks(subject, baselineStock);
        newSubjects[symbol] = subject;
      }
    }

    this.allData.update(data => ({
      ...data,
      ...newSubjects
    }));

    // console.log('a gR final data set: ', this.allData());

  }

  calculatePercentChange(results: CalculationData[]): CalculationData[] {
    // console.log('a cPC input results.length/results: ', results.length, results);
    for (let i = 1; i < results.length; i++ ) {
      // console.log('results[i]: ', results[i])
      // const date = results[i].date
      const pctChg = ((results[i].close - results[i - 1].close) / results[i].close) * 100;
      // console.log('a CPC date/close/pctChg: ', results[i].date, results[i].close, pctChg)
      results[i].percentChange = Number(pctChg.toFixed(4));
    }

    return results;
  }

  calculateRanks(subject: StockData, baseline: StockData): StockData {
    // console.log(`======== CALCULATE RANKS FOR ${subject.symbol} ================`);
    // console.log('a cRs input subject/baseline: ', subject, baseline);

    let subjectPctChgs = [];
    let baselinePctChgs = [];
    
    for (let i = 5; i < subject.results.length; i++) {
      const day = subject.results[i]
      // console.log('a cRs i/day data: ', i, day.date, day.close, day.percentChange);

      subjectPctChgs = [];
      baselinePctChgs = [];
      for (let j = 0; j <= 4; j++) {
        subjectPctChgs.push(subject.results[i - j].percentChange)
        baselinePctChgs.push(baseline.results[i - j].percentChange)
      }
      day.rank = this.calculateRank(subjectPctChgs, baselinePctChgs);

      subject.results[i] = {...day};
    }
    
    // console.log('a cRs final subject: ', subject);
    return subject;
  }

  calculateRank(subject: number[], baseline: number[]): number {
    // console.log('a cR input pctChgs subject/baseling: ', subject, baseline);
    let rank = 0;

    let outcomesByMatrix: {[key: string]: number} = {};
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

      outcomesByMatrix[matrix] = pctChg
    }

    // console.log('a cR final outcomesByMatrix: ', outcomesByMatrix);
    // console.log('a cR O.v(outcomesByMatrix): ', Object.values(outcomesByMatrix));
    // console.log('a cR O.e(outcomesByMatrix): ', Object.entries(outcomesByMatrix));
    
    const outcomes = Object.entries(outcomesByMatrix);
    outcomes.sort(compare)
    // console.log('a cR sorted outcomes/length: ', outcomes, outcomes.length);
    
    const index = (outcomes.findIndex(el => el[0] === '11111') + 1);
    rank = index / COMPARISON_MATRICES.length;
    // console.log('a cR 11111 index/rank: ', index, rank);

    return rank;
  }

  generateFinalDataSet() {
    // console.log('======== GENERATE FINAL DATA SET ================');
    let allData = {...this.allData()};
    // console.log('a gFDS input data set: ', allData);
    for (const stock of Object.values(allData)) {
      // console.log('a gFDS stock: ', stock);

      let calculationResult: CalculationResult = {}
      let ranksByDate: RanksByDate = {};
      for (const result of stock.results) {
        if (result.rank !== 0) {

          calculationResult[result.date] = result;
          ranksByDate[result.date] = {rank: result.rank};
        }
      }

      stock.resultsByDate = calculationResult;
      stock.ranksByDate = ranksByDate;
    }

    // console.log('a gFDS final data set: ', allData);
    this.allData.update(data => ({
      ...data,
      ...allData
    }));

    let dataSet: ResultsDataSet = {}
    // console.log('a gFDS O.v(dataSet): ', Object.values(dataSet));
    const stocks = Object.values(dataSet);
    for (const stock of stocks) {
      const finalData: StockResults = {
        symbol: stock.symbol,
        resultsByDate: stock.resultsByDate,
      }
      dataSet[finalData.symbol] = finalData;
      
    }

    // console.log('a gFDS final allData: ', allData);
    // console.log('a gFDS final O.e(allData): ', Object.entries(allData));
    this.allData.update(data => ({
      ...data,
      ...allData
    }));

  }

  generateDataTable() {
    // console.log('======== GENERATE DATA TABLE ================');
    const allData = this.allData();
    // console.log('a gDT input allData: ', allData);
    
    let symbols: string[] = [];

    for (const symbol of Object.keys(allData)) {
      if (!BASELINE_EQUITY_SYMBOLS.includes(symbol)) {
        symbols.push(symbol);
      }
    };

    // console.log('a gDT symbols: ', symbols);
    
    const aaplData = allData[symbols[0]];
    // console.log('a gDT aaplData: ', aaplData);
    const dates = Object.keys(aaplData.ranksByDate);
    // console.log('a gDT dates: ', dates);
    
    let tableData = [];
    for (const symbol of symbols) {
      // console.log(`------ ${symbol} ---------------`);
      let rowData: number[] = [];
      for (const date of dates) {
        const value = allData[symbol].ranksByDate[date].rank;
        rowData.push(value)

      }
      tableData.push(rowData);
    }
    // console.log('a gDT tableData: ', tableData);

    const relStrTableData: RelStrTableData = {
      symbols,
      dates,
      data: tableData,
    }

    // console.log('a gDT relStrTableData: ', relStrTableData);
    
    this.relStrTableData.set(relStrTableData);
    
    // console.log('a gDT t.relStrTableData(): ', this.relStrTableData());
  }
}

function compare(a: [string, number], b: [string, number]) {
  if (a[1] > b[1]) {
    return 1;
  } else if (a[1] < b[1]) {
    return -1;
  } else return 0;
}
