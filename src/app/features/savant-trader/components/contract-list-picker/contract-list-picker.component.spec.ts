/**
 * ContractListPickerComponent specs (#1361 — minimal shell).
 *
 * The FE-2 shell: provenance header + selection readout + Send, which
 * closes the dialog with the session's emitted `date,id` lines. The full
 * rows/stepper/lines tabs land in FE-3 (#1362) on top of this file.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { of } from 'rxjs';

import { TradeSide } from '@common';
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import { OptionType } from '@options/common';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { ContractListService } from '../../services/contract-list.service';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ContractListPickerComponent } from './contract-list-picker.component';

const pick = (entryDate: string, contractId: string): ContractListPickRow => ({
  kind: 'pick',
  entryDate,
  contractId,
  side: TradeSide.LONG,
  repeatsPrevious: false,
  underlyingClose: 500,
  expiration: '2026-06-19',
  dte: 9,
  strike: 500,
  delta: 0.5,
  iv: 0.2,
  mark: 5,
  bid: 4.9,
  ask: 5.1,
  volume: 100,
  openInterest: 1000,
});

const rows: ContractListRow[] = Array.from({ length: 3 }, (_, i) =>
  pick(`2026-06-0${i + 1}`, `QQQ260619C005${i}0000`),
);

const listDoc: OptionsContractListUi = {
  listId: 'run-1_QQQ',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows,
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: 3,
    missCount: 0,
    firstDate: '2026-06-01',
    lastDate: '2026-06-03',
  },
  generatedAtIso: '2026-06-16T10:00:00Z',
};

describe('ContractListPickerComponent (shell)', () => {
  let store: InstanceType<typeof ContractListSessionStore>;
  let close: jest.Mock;
  let cmp: ContractListPickerComponent;

  beforeEach(async () => {
    close = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ContractListSessionStore,
        { provide: ContractListService, useValue: { getList$: jest.fn(() => of(listDoc)) } },
        { provide: DsDialogRef, useValue: { close } },
      ],
    });
    store = TestBed.inject(ContractListSessionStore);
    store.setSymbol('QQQ');
    await store.loadList('run-1_QQQ');
    cmp = TestBed.runInInjectionContext(() => new ContractListPickerComponent());
  });

  it('exposes the list provenance and selection readout from the session', () => {
    expect(cmp.store.activeList()?.templateId).toBe('csp-45-20');
    expect(cmp.store.pickRows()).toHaveLength(3);
    expect(cmp.store.uniqueCount()).toBe(3);
  });

  it('Send closes the dialog with the emitted date,id lines', () => {
    cmp.send();
    expect(close).toHaveBeenCalledWith([
      '2026-06-01,QQQ260619C00500000',
      '2026-06-02,QQQ260619C00510000',
      '2026-06-03,QQQ260619C00520000',
    ]);
  });

  it('an empty selection cannot send', () => {
    store.selectNone();
    expect(cmp.canSend()).toBe(false);
    cmp.send();
    expect(close).not.toHaveBeenCalled();
  });
});
