/**
 * ContractListChooserComponent specs (#1361).
 *
 * Doc-selection dialog for the picker session: recent list docs sorted
 * symbol asc → generatedAt desc, default-filtered to the page's symbol
 * with an All-symbols widen toggle; a row select closes with the doc —
 * already converted, so the page loads it without a second fetch.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { of } from 'rxjs';

import { OptionType } from '@options/common';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { ContractListService } from '../../services/contract-list.service';
import { ContractListChooserComponent } from './contract-list-chooser.component';

const doc = (over: Partial<OptionsContractListUi> = {}): OptionsContractListUi => ({
  listId: 'r1_QQQ',
  runId: 'r1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: [],
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: 10,
    missCount: 2,
    firstDate: '2026-06-01',
    lastDate: '2026-06-15',
  },
  generatedAtIso: '2026-06-16T10:00:00Z',
  ...over,
});

describe('ContractListChooserComponent', () => {
  let recentLists$: jest.Mock;
  let close: jest.Mock;

  const make = (lists: OptionsContractListUi[], symbol = 'QQQ') => {
    recentLists$ = jest.fn(() => of(lists));
    close = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ContractListService, useValue: { recentLists$ } },
        { provide: DS_DIALOG_DATA, useValue: { symbol } },
        { provide: DsDialogRef, useValue: { close } },
      ],
    });
    return TestBed.runInInjectionContext(() => new ContractListChooserComponent());
  };

  it('defaults to the page symbol and sorts symbol asc → generatedAt desc', () => {
    const cmp = make([
      doc({ listId: 'q-new', symbol: 'QQQ', generatedAtIso: '2026-06-16T10:00:00Z' }),
      doc({ listId: 's-1', symbol: 'SPY', generatedAtIso: '2026-06-16T12:00:00Z' }),
      doc({ listId: 'q-old', symbol: 'QQQ', generatedAtIso: '2026-06-15T10:00:00Z' }),
    ]);

    // Default filter: only QQQ docs.
    expect(cmp.visibleLists().map((l) => l.listId)).toEqual(['q-new', 'q-old']);

    // Widen → all symbols, symbol asc then date desc inside each symbol.
    cmp.showAll.set(true);
    expect(cmp.visibleLists().map((l) => l.listId)).toEqual(['q-new', 'q-old', 's-1']);
  });

  it('toggling All symbols off re-applies the symbol filter', () => {
    const cmp = make([doc({ listId: 's-1', symbol: 'SPY' }), doc({ listId: 'q-1' })]);
    cmp.showAll.set(true);
    expect(cmp.visibleLists()).toHaveLength(2);
    cmp.showAll.set(false);
    expect(cmp.visibleLists().map((l) => l.listId)).toEqual(['q-1']);
  });

  it('selecting a doc closes the dialog with the converted doc (no refetch needed)', () => {
    const cmp = make([doc({ listId: 'r1_QQQ' })]);
    const picked = cmp.visibleLists()[0];
    cmp.select(picked);
    expect(close).toHaveBeenCalledWith(picked);
  });

  it('renders the doc id on each row so ?list= ids are discoverable in the UI', async () => {
    make([doc({ listId: 'r1_QQQ' })]);
    const fixture = TestBed.createComponent(ContractListChooserComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const rowId = fixture.nativeElement.querySelector('.row-id');
    expect(rowId?.textContent?.trim()).toBe('r1_QQQ');
  });
});
