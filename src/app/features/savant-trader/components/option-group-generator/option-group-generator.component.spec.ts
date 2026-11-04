/// <reference types="jest" />
/**
 * Drawer component specs — highest seam per TEST-FE: the real
 * OptionGroupGeneratorStore + a stubbed ContractAvailabilityService, driven
 * through the DOM. Covers query → preview → emit handoff, refine narrowing
 * without refetch, state surfaces (loading/error/empty/truncated), the
 * alive-range bound, and the open-date toggle.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';

import { OptionGroupGeneratorComponent } from './option-group-generator.component';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { ContractAvailabilityService } from '../../services/contract-availability.service';
import type {
  ContractAvailabilityEntry,
  ContractAvailabilityResponse,
} from '@options-contract/contracts';

const PUT_470 = 'QQQ260619P00470000';
const CALL_475 = 'QQQ260619C00475000';
const PUT_480 = 'QQQ260619P00480000';

function entry(contractId: string, overrides: Partial<ContractAvailabilityEntry> = {}): ContractAvailabilityEntry {
  return {
    contractId,
    expiration: '2026-06-19',
    strike: 470,
    type: 'put',
    firstObserved: '2026-01-05',
    lastObserved: '2026-06-12',
    ...overrides,
  };
}

function availabilityResponse(
  contracts: ContractAvailabilityEntry[],
  overrides: Partial<ContractAvailabilityResponse> = {},
): ContractAvailabilityResponse {
  return {
    ok: true,
    symbol: 'QQQ',
    count: contracts.length,
    truncated: false,
    contracts,
    corpusDates: ['2026-01-05', '2026-03-20', '2026-06-12'],
    ...overrides,
  };
}

interface Setup {
  fixture: ComponentFixture<OptionGroupGeneratorComponent>;
  component: OptionGroupGeneratorComponent;
  store: InstanceType<typeof OptionGroupGeneratorStore>;
  query$: jest.Mock;
  el: HTMLElement;
}

/** NgModel's control setup is microtask-deferred — without a flush, the
 *  first input/blur dispatch after detectChanges commits the stale model
 *  value instead of the typed one. setup() awaits one flush so every test
 *  interacts with fully-wired form controls. */
async function setup(queryResult?: jest.Mock): Promise<Setup> {
  const query$ =
    queryResult ??
    jest.fn(() =>
      of(
        availabilityResponse([
          entry(PUT_470),
          entry(CALL_475, { strike: 475, type: 'call' }),
          entry(PUT_480, { strike: 480 }),
        ]),
      ),
    );

  TestBed.configureTestingModule({
    imports: [OptionGroupGeneratorComponent],
    providers: [
      provideZonelessChangeDetection(),
      OptionGroupGeneratorStore,
      { provide: ContractAvailabilityService, useValue: { queryContractAvailability$: query$ } },
    ],
  });

  const fixture = TestBed.createComponent(OptionGroupGeneratorComponent);
  const store = TestBed.inject(OptionGroupGeneratorStore);
  store.setSymbol('QQQ');
  fixture.detectChanges();
  await new Promise<void>((r) => setTimeout(r, 0));
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    store,
    query$,
    el: fixture.nativeElement as HTMLElement,
  };
}

async function flush(fixture: ComponentFixture<OptionGroupGeneratorComponent>): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
  fixture.detectChanges();
}

/** Text/number fields commit on blur (updateOn:'blur'); datepicker inputs
 *  parse on 'change'. Dispatch input → change → blur to cover both. */
function setInput(el: HTMLElement, label: string, value: string): void {
  const fields = Array.from(el.querySelectorAll('mat-form-field'));
  const field = fields.find((f) => f.textContent?.includes(label));
  const input = field?.querySelector('input');
  if (!input) throw new Error(`no input for label "${label}"`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('change'));
  input.dispatchEvent(new Event('blur'));
}

function text(el: HTMLElement, selector: string): string {
  return el.querySelector(selector)?.textContent?.trim() ?? '';
}

describe('OptionGroupGeneratorComponent', () => {
  beforeEach(() => localStorage.clear());

  it('query inputs write into the store axes', async () => {
    const { fixture, store, el } = await setup();
    setInput(el, 'Strike From', '450');
    setInput(el, 'Strike To', '500');
    setInput(el, 'Step', '5');
    setInput(el, 'Exp From', '2026-06-01');
    setInput(el, 'Exp To', '2026-12-31');
    fixture.detectChanges();

    expect(store.query().strikeGte).toBe(450);
    expect(store.query().strikeLte).toBe(500);
    expect(store.query().strikeStep).toBe(5);
    expect(store.query().expirationGte).toBe('2026-06-01');
    expect(store.query().expirationLte).toBe('2026-12-31');
  });

  it('empty inputs clear the axis bound instead of writing a falsy value', async () => {
    const { fixture, store, el } = await setup();
    setInput(el, 'Strike From', '450');
    setInput(el, 'Strike From', '');
    fixture.detectChanges();

    expect(store.query().strikeGte).toBeUndefined();
  });

  it('commits decimal strikes on blur — no mid-type clobber', async () => {
    const { fixture, store, el } = await setup();
    setInput(el, 'Strike From', '472.5');
    fixture.detectChanges();

    expect(store.query().strikeGte).toBe(472.5);
  });

  it('type toggle writes C/P/BOTH to the query', async () => {
    const { fixture, store, el } = await setup();
    const calls = el.querySelector<HTMLElement>('.gen-type-toggle .pill')!;
    calls.click();
    fixture.detectChanges();

    expect(store.query().type).toBe('C');
  });

  it('refine type toggle clears the bound on ALL', async () => {
    const { fixture, store, el } = await setup();
    const refineGroup = el.querySelectorAll<HTMLElement>('.gen-type-toggle')[1];
    refineGroup.querySelectorAll<HTMLElement>('.pill')[2]!.click();
    fixture.detectChanges();
    expect(store.refine().type).toBe('put');

    refineGroup.querySelectorAll<HTMLElement>('.pill')[0]!.click();
    fixture.detectChanges();
    expect(store.refine().type).toBeUndefined();
  });

  it('Run fetches and the preview renders the returned contracts', async () => {
    const { fixture, store, el, query$ } = await setup();
    el.querySelector<HTMLElement>('.gen-run')!.click();
    await flush(fixture);

    expect(query$).toHaveBeenCalledTimes(1);
    expect(store.records()).toHaveLength(3);
    expect(text(el, '.gen-count')).toContain('3 contracts');
    expect(el.querySelectorAll('.gen-table tbody tr')).toHaveLength(3);
    expect(text(el, '.gen-table')).toContain(PUT_470);
  });

  it('refine narrows the preview without another fetch', async () => {
    const { fixture, store, el, query$ } = await setup();
    store.setSymbol('QQQ');
    await store.run();
    await flush(fixture);
    expect(query$).toHaveBeenCalledTimes(1);

    setInput(el, 'Strike Min', '475');
    fixture.detectChanges();

    expect(query$).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('.gen-table tbody tr')).toHaveLength(2);
    expect(text(el, '.gen-count')).toContain('2 contracts');
    expect(text(el, '.gen-count')).toContain('of 3');
  });

  it('truncated response surfaces the narrowing warning', async () => {
    const query$ = jest.fn(() =>
      of(availabilityResponse([entry(PUT_470)], { truncated: true, count: 2000 })),
    );
    const { fixture, store, el } = await setup(query$);
    await store.run();
    await flush(fixture);

    expect(text(el, '.gen-truncated')).toContain('Truncated');
    expect(text(el, '.gen-truncated')).toContain('narrow filters');
  });

  it('endpoint error shows the error state and Retry reruns', async () => {
    let calls = 0;
    const query$ = jest.fn(() => {
      calls++;
      return calls === 1
        ? throwError(() => new Error('endpoint down'))
        : of(availabilityResponse([entry(PUT_470)]));
    });
    const { fixture, store, el } = await setup(query$);
    await store.run();
    await flush(fixture);

    expect(store.status()).toBe('error');
    expect(text(el, '.gen-error')).toContain('endpoint down');

    el.querySelector<HTMLElement>('.gen-retry')!.click();
    await flush(fixture);

    expect(query$).toHaveBeenCalledTimes(2);
    expect(store.status()).toBe('idle');
    expect(el.querySelectorAll('.gen-table tbody tr')).toHaveLength(1);
  });

  it('shows the loading state and disables Run while the query is in flight', async () => {
    const pending = new Subject<ContractAvailabilityResponse>();
    const query$ = jest.fn(() => pending.asObservable());
    const { fixture, store, el } = await setup(query$);

    const runPromise = store.run();
    fixture.detectChanges();

    expect(store.status()).toBe('loading');
    expect(el.querySelector('.gen-status')).not.toBeNull();
    expect(el.querySelector('.gen-empty')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('.gen-run')!.disabled).toBe(true);

    pending.next(availabilityResponse([entry(PUT_470)]));
    pending.complete();
    await runPromise;
    await flush(fixture);

    expect(store.status()).toBe('idle');
    expect(el.querySelector('.gen-status')).toBeNull();
    expect(el.querySelectorAll('.gen-table tbody tr')).toHaveLength(1);
  });

  it('distinguishes never-ran, ran-empty, and refined-to-zero', async () => {
    const { fixture, store, el, query$ } = await setup();
    expect(text(el, '.gen-empty')).toContain('press Run');

    // Run returning zero contracts
    query$.mockReturnValueOnce(of(availabilityResponse([])));
    await store.run();
    await flush(fixture);
    expect(text(el, '.gen-empty')).toContain('no contracts');

    // Refine narrows a non-empty result to zero — different message
    await store.run();
    await flush(fixture);
    store.setRefine({ strikeGte: 9999 });
    fixture.detectChanges();
    expect(text(el, '.gen-empty')).toContain('filtered out');
  });

  it('alive-range bound displays read-only and clears through applyRange(null)', async () => {
    const { fixture, store, el } = await setup();
    store.applyRange({ start: '2026-01-05', end: '2026-03-20' });
    fixture.detectChanges();

    expect(text(el, '.gen-alive-range')).toContain('2026-01-05');
    expect(text(el, '.gen-alive-range')).toContain('2026-03-20');

    el.querySelector<HTMLElement>('.gen-alive-clear')!.click();
    fixture.detectChanges();
    expect(store.refine().aliveRange).toBeUndefined();
    expect(el.querySelector('.gen-alive-range')).toBeNull();
  });

  it('open-date toggle links the range start and shows the derived date', async () => {
    const { fixture, store, el } = await setup();
    store.applyRange({ start: '2026-01-05', end: '2026-03-20' });
    store.setUseRangeAsOpenDate(true);
    fixture.detectChanges();
    await flush(fixture);

    expect(store.openDate()).toBe('2026-01-05');
    // The derived date is displayed (locale-formatted by the datepicker).
    const openDateField = Array.from(el.querySelectorAll('mat-form-field'))
      .find((f) => f.textContent?.includes('Open date'));
    expect(openDateField?.querySelector('input')?.value).toBe('1/5/2026');
  });

  it('date projections return stable Date instances across CD passes', async () => {
    // Regression: a fresh Date per pass keeps ngModel permanently dirty —
    // infinite change-detection loop on page init with persisted dates.
    const { fixture, component, store } = await setup();
    store.setQuery({ expirationGte: '2026-06-01' });
    store.applyRange({ start: '2026-01-05', end: '2026-03-20' });
    store.setUseRangeAsOpenDate(true);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(component.queryExpGteDate()).toBe(component.queryExpGteDate());
    expect(component.refineExpGteDate()).toBe(component.refineExpGteDate());
    expect(component.openDateDate()).toBe(component.openDateDate());
    expect(component.queryExpGteDate()!.toISOString().startsWith('2026-06-01')).toBe(true);
  });

  it('Send emits date,id pair lines for the filtered set', async () => {
    const { fixture, store, component, el } = await setup();
    await store.run();
    await flush(fixture);
    store.setOpenDate('2026-02-02');
    store.setRefine({ type: 'put' });
    fixture.detectChanges();

    let emitted: string[] | undefined;
    component.send.subscribe((lines) => (emitted = lines));
    el.querySelector<HTMLElement>('.gen-send')!.click();

    expect(emitted).toEqual([`2026-02-02,${PUT_470}`, `2026-02-02,${PUT_480}`]);
    expect(text(el, '.gen-send')).toContain('Send 2');
  });

  it('view lines reveals the emitted pair lines without sending', async () => {
    const { fixture, store, el } = await setup();
    await store.run();
    store.setOpenDate('2026-02-02');
    await flush(fixture);

    el.querySelector<HTMLElement>('.gen-lines-toggle')!.click();
    fixture.detectChanges();

    const pre = el.querySelector('.gen-lines');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('2026-02-02,QQQ260619C00475000');
    expect(pre!.textContent).toContain('2026-02-02,QQQ260619P00470000');

    el.querySelector<HTMLElement>('.gen-lines-toggle')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.gen-lines')).toBeNull();
  });

  it('Send stays disabled on an empty filtered set', async () => {
    const { fixture, store, component, el } = await setup();
    const sendSpy = jest.fn();
    component.send.subscribe(sendSpy);

    const btn = el.querySelector<HTMLButtonElement>('.gen-send')!;
    expect(btn.disabled).toBe(true);
    expect(text(el, '.gen-send-hint')).toContain('non-empty');

    await store.run();
    await flush(fixture);
    store.setRefine({ strikeGte: 9999 });
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('.gen-send')!.disabled).toBe(true);
  });

  it('symbol swap re-seeds the free-text expiry fields from the saved blob', async () => {
    const { fixture, store, component } = await setup();
    component.onAxisExpiries('query', '2026-06-19, 2026-07-17');
    fixture.detectChanges();
    expect(component.queryExpiryText()).toBe('2026-06-19, 2026-07-17');

    // SPY has no blob — fields clear.
    store.setSymbol('SPY');
    fixture.detectChanges();
    expect(component.queryExpiryText()).toBe('');

    // Back to QQQ — the persisted list re-seeds the text.
    store.setSymbol('QQQ');
    fixture.detectChanges();
    expect(component.queryExpiryText()).toBe('2026-06-19, 2026-07-17');
  });
});
