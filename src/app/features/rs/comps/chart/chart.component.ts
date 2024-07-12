import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { StockData, StockDatum } from '../../common/interfaces-rs';

@Component({
  selector: 'rs-chart',
  standalone: true,
  imports: [ReactiveFormsModule, MatFormFieldModule, MatButtonModule, MatInputModule],
  templateUrl: './chart.component.html',
  styleUrl: './chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChartComponent extends RelStrBaseComponent implements OnInit {

    stockData = signal<StockDatum[]>([]);

    symbolControl = new FormControl('');

    symbolForm = new FormGroup({
        'symbolControl': this.symbolControl,
    });

    ngOnInit() {
        this.rsAppStore.getSupportedSymbolsList();
    }

    handleGetData() {
        this.getDataForSymbol();
    }

    handleClear() {
        this.symbolForm.reset();
    }

    getDataForSymbol() {
        const symbol = this.symbolForm.controls['symbolControl'].value?.toUpperCase();
        if (symbol) {
            // console.log('c gDFS get data for symbol: ', symbol);
            const data = this.rsAppStore.getHistoricalDataForSymbol(symbol);
            // console.log('c gDFS data: ', data);
            this.stockData.set(data);
        }
    }

    getDate(datum: StockDatum) {
        return Object.keys(datum)[0];
    }
    
    getPrice(datum: StockDatum) {
        return Object.values(datum)[0];
    }
}
