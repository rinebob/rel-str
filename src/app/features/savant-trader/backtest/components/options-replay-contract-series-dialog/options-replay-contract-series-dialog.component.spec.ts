import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';

import { OptionsReplayContractSeriesDialogComponent, ContractSeriesDialogData } from './options-replay-contract-series-dialog.component';
import { OptionsContractService } from '../../../services/options-contract.service';
import type { PartnerHistoricalOptionsContractV2Response } from '@options-contract/contracts';

const DATA: ContractSeriesDialogData = {
  symbol: 'SPY',
  contractId: 'SPY260220P00550000',
  entryDate: '2026-01-05',
};

function makeResponse(marks: (string | undefined)[]): PartnerHistoricalOptionsContractV2Response {
  return {
    ok: true,
    symbol: 'SPY',
    contractID: 'SPY260220P00550000',
    expiration: '2026-02-20',
    type: 'put',
    strike: '550',
    startDate: '2025-12-01',
    endDate: '2026-02-20',
    series: marks.map((mark, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, mark })),
  };
}

describe('OptionsReplayContractSeriesDialogComponent', () => {
  async function setup(service: { getHistoricalOptionsContract$: jest.Mock }) {
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: OptionsContractService, useValue: service },
        { provide: MAT_DIALOG_DATA, useValue: DATA },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayContractSeriesDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('fetches exactly the row contractId + symbol on open', async () => {
    const service = { getHistoricalOptionsContract$: jest.fn(() => of(makeResponse(['4.85']))) };
    await setup(service);
    expect(service.getHistoricalOptionsContract$).toHaveBeenCalledWith('SPY', 'SPY260220P00550000');
  });

  it('shows loading until the series arrives, then renders the mark line', async () => {
    const subject = new Subject<PartnerHistoricalOptionsContractV2Response>();
    const service = { getHistoricalOptionsContract$: jest.fn(() => subject.asObservable()) };
    const fixture = await setup(service);

    expect(fixture.componentInstance.state()).toBe('loading');
    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();

    subject.next(makeResponse(['4.00', '4.50', '4.85', '4.20']));
    fixture.detectChanges();

    expect(fixture.componentInstance.state()).toBe('loaded');
    const polyline = fixture.nativeElement.querySelector('.mark-line');
    expect(polyline).toBeTruthy();
    expect(polyline.getAttribute('points').split(' ').length).toBe(4);
    expect(fixture.nativeElement.textContent).toContain('4 observations');
  });

  it('renders a single-observation series as a dot, not a polyline', async () => {
    const service = { getHistoricalOptionsContract$: jest.fn(() => of(makeResponse(['4.85']))) };
    const fixture = await setup(service);
    expect(fixture.componentInstance.state()).toBe('loaded');
    expect(fixture.nativeElement.querySelector('.mark-line')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mark-dot')).toBeTruthy();
  });

  it('drops observations with missing/non-numeric marks', async () => {
    const service = {
      getHistoricalOptionsContract$: jest.fn(() => of(makeResponse(['4.00', undefined, 'x', '4.85']))),
    };
    const fixture = await setup(service);
    expect(fixture.componentInstance.series().length).toBe(2);
  });

  it('renders the empty state when the series is empty', async () => {
    const service = { getHistoricalOptionsContract$: jest.fn(() => of(makeResponse([]))) };
    const fixture = await setup(service);
    expect(fixture.componentInstance.state()).toBe('empty');
    expect(fixture.nativeElement.textContent).toContain('No mark series');
    expect(fixture.nativeElement.textContent).toContain('SPY260220P00550000');
  });

  it('renders the error state naming the contractId', async () => {
    const service = {
      getHistoricalOptionsContract$: jest.fn(() => throwError(() => new Error('upstream 500'))),
    };
    const fixture = await setup(service);
    expect(fixture.componentInstance.state()).toBe('error');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Failed to load series');
    expect(text).toContain('SPY260220P00550000');
    expect(text).toContain('upstream 500');
  });
});
