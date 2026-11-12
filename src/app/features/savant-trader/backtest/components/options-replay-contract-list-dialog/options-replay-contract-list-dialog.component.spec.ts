import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DS_DIALOG_DATA, DsDialogRef, DsDialogService } from '../../../../../shared/ds/ds-dialog';

import {
  OptionsReplayContractListDialogComponent,
  ContractListDialogData,
} from './options-replay-contract-list-dialog.component';
import { OptionsReplayContractSeriesDialogComponent } from '../options-replay-contract-series-dialog/options-replay-contract-series-dialog.component';
import { TradeSide } from '@common';
import type { OptionsContractListUi } from '../../common/options-replay.types';
import type { ContractListPickRow } from '@options-replay/contracts';

function makePick(overrides: Partial<ContractListPickRow> = {}): ContractListPickRow {
  return {
    kind: 'pick',
    entryDate: '2026-01-05',
    contractId: 'SPY260220P00550000',
    side: TradeSide.SHORT,
    expiration: '2026-02-20',
    dte: 46,
    strike: 550,
    delta: -0.21,
    iv: 0.19,
    mark: 4.85,
    bid: 4.8,
    ask: 4.9,
    volume: 1200,
    openInterest: 5400,
    underlyingClose: 598.12,
    repeatsPrevious: false,
    ...overrides,
  };
}

function makeList(overrides: Partial<OptionsContractListUi> = {}): OptionsContractListUi {
  return {
    listId: 'run-1_SPY',
    runId: 'run-1_SPY',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    status: 'success',
    rows: [makePick()],
    ...overrides,
  };
}

const DATA: ContractListDialogData = { list: makeList() };

describe('OptionsReplayContractListDialogComponent', () => {
  async function setup(data: ContractListDialogData = DATA) {
    const dialog = { open: jest.fn() };
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DS_DIALOG_DATA, useValue: data },
        { provide: DsDialogRef, useValue: { close: jest.fn() } },
        { provide: DsDialogService, useValue: dialog },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayContractListDialogComponent);
    fixture.detectChanges();
    return { fixture, dialog };
  }

  it('renders the symbol, status, and row count in the header', async () => {
    const { fixture } = await setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('SPY');
    expect(el.textContent).toContain('success');
    expect(el.textContent).toContain('1 row');
  });

  it('renders the contract-list table rows', async () => {
    const { fixture } = await setup();
    expect(fixture.nativeElement.textContent).toContain('SPY260220P00550000');
  });

  it('forwards a row inspect to the contract-series dialog with the list symbol', async () => {
    const { fixture, dialog } = await setup();

    fixture.componentInstance.openSeriesDialog(makePick());

    expect(dialog.open).toHaveBeenCalledWith(
      OptionsReplayContractSeriesDialogComponent,
      expect.objectContaining({
        data: { symbol: 'SPY', contractId: 'SPY260220P00550000', entryDate: '2026-01-05' },
      })
    );
  });

  it('shows the error text and empty state on a failed list', async () => {
    const { fixture } = await setup({
      list: makeList({ status: 'failed', rows: [], error: 'pick doc missing' }),
    });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('pick doc missing');
    expect(el.textContent).toContain('No contract rows');
  });
});
