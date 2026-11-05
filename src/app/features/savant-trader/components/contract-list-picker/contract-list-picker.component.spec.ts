/**
 * ContractListPickerComponent specs (#1362 — rows tab + lines preview;
 * #1363 — chunks tab: stepper live-drive, timeline, add-chunk).
 *
 * The full picker over the page-scoped session store: provenance header,
 * rows tab (checkboxes, toolbar ops, no-selection markers, repeat badges),
 * and a lines preview that mirrors `store.emittedLines()` exactly. Send
 * emits through `store.sendSelected()` + the page's `onSend` callback —
 * the dialog stays open; `lastEmitted` records the emit for observability.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { NEVER, of } from 'rxjs';

import { TradeSide } from '@common';
import type { ContractListNoSelectionRow, ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import { OptionType } from '@options/common';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { ContractListService } from '../../services/contract-list.service';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ContractListPickerComponent, type ContractListPickerData } from './contract-list-picker.component';

const pick = (
  entryDate: string,
  contractId: string,
  over: Partial<ContractListPickRow> = {},
): ContractListPickRow => ({
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
  ...over,
});

const noSel = (entryDate: string, reason: ContractListNoSelectionRow['reason'] = 'miss'): ContractListNoSelectionRow => ({
  kind: 'no-selection',
  entryDate,
  reason,
});

/** 13 rows / 12 picks: one no-selection marker mid-list, one repeatsPrevious
 *  flag on the second BBB pick (still a distinct dated position entry). */
const mkRows = (): ContractListRow[] => [
  pick('2026-06-01', 'AAA'),
  pick('2026-06-02', 'BBB'),
  noSel('2026-06-03'),
  pick('2026-06-04', 'BBB', { repeatsPrevious: true }),
  ...Array.from({ length: 9 }, (_, i) => pick(`2026-06-${String(i + 5).padStart(2, '0')}`, `CCC${i}`)),
];

const listDoc = (over: Partial<OptionsContractListUi> = {}): OptionsContractListUi => ({
  listId: 'run-1_QQQ',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: mkRows(),
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 3,
    pickCount: 12,
    missCount: 1,
    firstDate: '2026-06-01',
    lastDate: '2026-06-13',
  },
  generatedAtIso: '2026-06-16T10:00:00Z',
  ...over,
});

describe('ContractListPickerComponent', () => {
  let store: InstanceType<typeof ContractListSessionStore>;
  let close: jest.Mock;
  let getList$: jest.Mock;
  let dialogData: ContractListPickerData | undefined;

  beforeEach(() => localStorage.clear());

  const setup = async (doc: OptionsContractListUi | null = listDoc()) => {
    close = jest.fn();
    dialogData = undefined;
    getList$ = jest.fn(() => (doc ? of(doc) : NEVER));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ContractListSessionStore,
        { provide: ContractListService, useValue: { getList$ } },
        { provide: DsDialogRef, useValue: { close } },
        { provide: DS_DIALOG_DATA, useFactory: () => dialogData },
      ],
    });
    store = TestBed.inject(ContractListSessionStore);
    store.setSymbol('QQQ');
    if (doc) await store.loadList(doc.listId);
  };

  const render = async (): Promise<ComponentFixture<ContractListPickerComponent>> => {
    const fixture = TestBed.createComponent(ContractListPickerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  const el = (fixture: ComponentFixture<ContractListPickerComponent>) =>
    fixture.nativeElement as HTMLElement;
  const checked = (fixture: ComponentFixture<ContractListPickerComponent>) =>
    el(fixture).querySelectorAll<HTMLInputElement>('.rows-table input[type=checkbox]:checked').length;
  const ctrl = (fixture: ComponentFixture<ContractListPickerComponent>, sel: string) =>
    el(fixture).querySelector<HTMLElement>(sel)!;

  it('renders the provenance line from the active doc', async () => {
    await setup();
    const fixture = await render();

    const text = ctrl(fixture, '.provenance').textContent!;
    expect(text).toContain('csp-45-20');
    expect(text).toContain('QQQ');
    expect(text).toContain('12 picks');
    expect(text).toContain('1 misses');
    expect(text).toContain('2026-06-01');
    expect(text).toContain('grid v3');
  });

  it('opens with the first 10 pick rows checked (marker row excluded)', async () => {
    await setup();
    const fixture = await render();

    expect(checked(fixture)).toBe(10);
    expect(store.selectedRows()).toHaveLength(10);
  });

  it('a checkbox toggle updates the store selection and the live readout', async () => {
    await setup();
    const fixture = await render();

    const box = el(fixture).querySelector<HTMLInputElement>(
      '.pick-row input[type=checkbox]',
    )!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(store.selectedRows()).toHaveLength(9);
    expect(ctrl(fixture, '.readout').textContent).toContain('9 rows selected');
    expect(ctrl(fixture, '.readout').textContent).toContain('8 unique contracts');
  });

  it('the readout counts distinct contract ids (two BBB picks → 1 unique)', async () => {
    await setup();
    store.selectDateRange('2026-06-02', '2026-06-04');
    const fixture = await render();

    expect(store.selectedRows()).toHaveLength(2);
    expect(ctrl(fixture, '.readout').textContent).toContain('2 rows selected');
    expect(ctrl(fixture, '.readout').textContent).toContain('1 unique contracts');
  });

  it('toolbar All / None / Invert drive the store selection', async () => {
    await setup();
    const fixture = await render();
    const btn = (label: string) =>
      Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.toolbar .ds-btn'))
        .find((b) => b.textContent!.trim() === label)!;

    btn('None').click();
    fixture.detectChanges();
    expect(checked(fixture)).toBe(0);

    btn('All').click();
    fixture.detectChanges();
    expect(checked(fixture)).toBe(12);

    btn('Invert').click();
    fixture.detectChanges();
    expect(checked(fixture)).toBe(0);
  });

  it('stride selects every kth pick row', async () => {
    await setup();
    const fixture = await render();

    const select = ctrl(fixture, '.stride-select') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    ctrl(fixture, '.stride-apply').dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(store.selectedRows().map((r) => r.entryDate)).toEqual([
      '2026-06-01', '2026-06-05', '2026-06-08', '2026-06-11',
    ]);
  });

  it('random N selects N rows and composes with a manual uncheck', async () => {
    await setup();
    const fixture = await render();

    const input = ctrl(fixture, '.random-input') as HTMLInputElement;
    input.value = '4';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ctrl(fixture, '.random-apply').dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(store.selectedRows()).toHaveLength(4);

    const box = el(fixture).querySelector<HTMLInputElement>(
      '.pick-row input[type=checkbox]:checked',
    )!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(store.selectedRows()).toHaveLength(3);
  });

  it('date range selects the inclusive pick rows in [from, to]', async () => {
    await setup();
    const fixture = await render();

    const from = ctrl(fixture, '.range-from') as HTMLInputElement;
    const to = ctrl(fixture, '.range-to') as HTMLInputElement;
    from.value = '2026-06-02';
    to.value = '2026-06-05';
    from.dispatchEvent(new Event('input'));
    to.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ctrl(fixture, '.range-apply').dispatchEvent(new Event('click'));
    fixture.detectChanges();

    // 06-03 is a no-selection marker — not a pick row, never selected.
    expect(store.selectedRows().map((r) => r.entryDate)).toEqual([
      '2026-06-02', '2026-06-04', '2026-06-05',
    ]);
  });

  it('text filter selects rows whose contractId contains the text', async () => {
    await setup();
    const fixture = await render();

    const input = ctrl(fixture, '.text-filter') as HTMLInputElement;
    input.value = 'CCC';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    ctrl(fixture, '.filter-apply').dispatchEvent(new Event('click'));
    fixture.detectChanges();

    expect(store.selectedRows()).toHaveLength(9);
    expect(store.selectedRows().every((r) => r.contractId.includes('CCC'))).toBe(true);
  });

  it('renders the no-selection row disabled with its reason, never emittable', async () => {
    await setup();
    const fixture = await render();

    const marker = ctrl(fixture, '.no-selection-row');
    expect(marker.querySelector('input')!.disabled).toBe(true);
    expect(marker.textContent).toContain('2026-06-03');
    expect(marker.textContent).toContain('miss');

    store.selectAll();
    expect(store.emittedLines().some((l) => l.startsWith('2026-06-03'))).toBe(false);
  });

  it('renders the ↻ repeat badge only on repeatsPrevious rows', async () => {
    await setup();
    const fixture = await render();

    const badges = el(fixture).querySelectorAll('.repeat-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('tr')!.textContent).toContain('2026-06-04');
  });

  it('the lines preview equals the emit output, duplicates preserved', async () => {
    await setup();
    const fixture = await render();

    store.selectDateRange('2026-06-02', '2026-06-04');
    fixture.componentInstance.activeTab.set('lines');
    fixture.detectChanges();

    const expected = store.emittedLines().join('\n');
    expect(ctrl(fixture, '.lines-preview').textContent).toBe(expected);
    expect(expected).toContain('2026-06-02,BBB');
    expect(expected).toContain('2026-06-04,BBB');
  });

  it('Copy writes the emitted lines to the clipboard', async () => {
    await setup();
    // Restore unconditionally — a failing expect must not leak the mock,
    // and an originally-absent navigator.clipboard must be deleted again.
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const fixture = await render();

      fixture.componentInstance.activeTab.set('lines');
      fixture.detectChanges();
      ctrl(fixture, '.copy-btn').dispatchEvent(new Event('click'));

      expect(writeText).toHaveBeenCalledWith(store.emittedLines().join('\n'));
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('the lines tab shows an empty note when nothing is selected', async () => {
    await setup();
    const fixture = await render();

    store.selectNone();
    fixture.componentInstance.activeTab.set('lines');
    fixture.detectChanges();

    expect(el(fixture).querySelector('.lines-preview')).toBeNull();
    expect(ctrl(fixture, '.empty-note').textContent).toContain('No rows selected');
  });

  it.each([
    ['gap', 'market data gap'],
    ['out-of-range', 'outside the doc window'],
  ] as const)('renders the %s no-selection reason', async (reason, label) => {
    await setup(listDoc({ rows: [pick('2026-06-01', 'AAA'), noSel('2026-06-02', reason)] }));
    const fixture = await render();

    const marker = ctrl(fixture, '.no-selection-row');
    expect(marker.textContent).toContain(label);
  });

  it('Send emits through the store and keeps the dialog open', async () => {
    await setup();
    const fixture = await render();

    fixture.componentInstance.send();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(store.lastEmitted()).toEqual(store.emittedLines());
    expect(store.lastEmitted().length).toBe(10);
  });

  it('Send forwards the emitted lines to the page onSend callback', async () => {
    await setup();
    const onSend = jest.fn();
    dialogData = { onSend };
    const fixture = await render();

    fixture.componentInstance.send();

    expect(onSend).toHaveBeenCalledWith(store.emittedLines());
    expect(close).not.toHaveBeenCalled();
  });

  it('Send is disabled on an empty selection', async () => {
    await setup();
    const fixture = await render();

    store.selectNone();
    fixture.detectChanges();

    const sendBtn = ctrl(fixture, '.send-btn') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fixture.componentInstance.send();
    expect(store.lastEmitted()).toEqual([]);
  });

  it('renders a distinct error state', async () => {
    await setup(null);
    getList$.mockReturnValue(of({ ...listDoc(), status: 'failed', error: 'boom' }));
    await store.loadList('run-1_QQQ');
    const fixture = await render();

    expect(ctrl(fixture, '.error-state').textContent).toContain('failed');
    expect(el(fixture).querySelector('.rows-table')).toBeNull();
  });

  it('renders a distinct loading state', async () => {
    await setup(null);
    void store.loadList('run-1_QQQ'); // getList$ = NEVER → stays loading
    const fixture = await render();

    expect(ctrl(fixture, '.loading-state').textContent).toContain('Loading');
  });

  it('renders a distinct empty state with no active list', async () => {
    await setup(null);
    const fixture = await render();

    expect(ctrl(fixture, '.empty-state').textContent).toContain('No active list');
  });

  describe('chunks tab', () => {
    /** 12 picks at size 10 → chunk 1 = first 10 days (9 unique: BBB repeats),
     *  chunk 2 = last 2 days. */
    it('renders the stepper readout with i/n, days, and unique counts', async () => {
      await setup();
      const fixture = await render();
      fixture.componentInstance.activeTab.set('chunks');
      fixture.detectChanges();

      const info = ctrl(fixture, '.chunk-info').textContent!;
      expect(info).toContain('1/2');
      expect(info).toContain('10 days');
      expect(info).toContain('9 unique');
    });

    it('disables ◀ on the first chunk; ▶ steps the cursor and live-drives through onSend', async () => {
      await setup();
      dialogData = { onSend: jest.fn() };
      const fixture = await render();
      fixture.componentInstance.activeTab.set('chunks');
      fixture.detectChanges();

      const prev = ctrl(fixture, '.chunk-prev') as HTMLButtonElement;
      const next = ctrl(fixture, '.chunk-next') as HTMLButtonElement;
      expect(prev.disabled).toBe(true);
      expect(next.disabled).toBe(false);

      next.dispatchEvent(new Event('click'));
      fixture.detectChanges();

      expect(store.chunkCursor()).toBe(1);
      // Literal chunk-2 lines — not the SUT's own currentChunk() output.
      expect(dialogData.onSend).toHaveBeenCalledWith([
        '2026-06-12,CCC7',
        '2026-06-13,CCC8',
      ]);
      expect(ctrl(fixture, '.chunk-info').textContent).toContain('2/2');
      expect(next.disabled).toBe(true);
    });

    it('renders a timeline tick per pick day and highlights the current chunk span', async () => {
      await setup();
      const fixture = await render();
      fixture.componentInstance.activeTab.set('chunks');
      fixture.detectChanges();

      const ticks = el(fixture).querySelectorAll('.timeline-tick');
      expect(ticks).toHaveLength(12); // picks only — the no-selection marker is not a tick
      expect(el(fixture).querySelectorAll('.timeline-tick.in-chunk')).toHaveLength(10);
      expect(el(fixture).querySelector('.timeline-chunk')).not.toBeNull();
    });

    it('clicking a timeline tick jumps the cursor to that chunk and emits it', async () => {
      await setup();
      dialogData = { onSend: jest.fn() };
      const fixture = await render();
      fixture.componentInstance.activeTab.set('chunks');
      fixture.detectChanges();

      const ticks = el(fixture).querySelectorAll<HTMLButtonElement>('.timeline-tick');
      ticks[11].dispatchEvent(new Event('click')); // last pick day → chunk 2
      fixture.detectChanges();

      expect(store.chunkCursor()).toBe(1);
      expect(dialogData.onSend).toHaveBeenCalledWith([
        '2026-06-12,CCC7',
        '2026-06-13,CCC8',
      ]);
    });

    it('Add chunk to selection unions the chunk days without disturbing others', async () => {
      await setup();
      const fixture = await render();
      fixture.componentInstance.activeTab.set('chunks');
      fixture.detectChanges();

      // Pre-check a day outside chunk 1 — accumulation must keep it.
      store.selectNone();
      store.toggleRow('2026-06-13', true);
      ctrl(fixture, '.chunk-add').dispatchEvent(new Event('click'));

      expect(store.selection().size).toBe(11); // chunk 1's 10 days + 06-13
      expect(store.selection().has('2026-06-13')).toBe(true);
      expect(store.chunkCursor()).toBe(0); // selection add does not move the cursor
    });

    it('the size stepper repartitions the list', async () => {
      await setup();
      const fixture = await render();
      fixture.componentInstance.activeTab.set('chunks');
      fixture.detectChanges();

      const sel = ctrl(fixture, '.chunk-size') as HTMLSelectElement;
      sel.value = '50';
      sel.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(store.chunkSize()).toBe(50);
      expect(store.chunks().length).toBe(1);
      expect(ctrl(fixture, '.chunk-info').textContent).toContain('1/1');
    });
  });
});
