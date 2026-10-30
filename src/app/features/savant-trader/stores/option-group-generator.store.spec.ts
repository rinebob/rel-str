import { TestBed } from '@angular/core/testing';
import { from, of, throwError } from 'rxjs';

import type {
  ContractAvailabilityEntry,
  ContractAvailabilityResponse,
} from '@options-contract/contracts';
import { ContractAvailabilityService } from '../services/contract-availability.service';
import { OptionGroupGeneratorStore } from './option-group-generator.store';
import {
  GENERATOR_SETTINGS_PREFIX,
  GENERATOR_SETTINGS_VERSION,
  clearGeneratorSettings,
  readGeneratorSettings,
} from '../utils/option-generator-settings';

const entry = (
  contractId: string,
  expiration: string,
  strike: number,
  type: 'call' | 'put',
  firstObserved = '2026-01-01',
  lastObserved = '2026-06-30',
): ContractAvailabilityEntry => ({ contractId, expiration, strike, type, firstObserved, lastObserved });

const A = entry('QQQ260619C00500000', '2026-06-19', 500, 'call');
const B = entry('QQQ260619P00500000', '2026-06-19', 500, 'put');
const C = entry('QQQ260918C00550000', '2026-09-18', 550, 'call');

const response = (contracts: ContractAvailabilityEntry[], extra?: Partial<ContractAvailabilityResponse>): ContractAvailabilityResponse => ({
  ok: true,
  symbol: 'QQQ',
  count: contracts.length,
  truncated: false,
  contracts,
  corpusDates: ['2026-01-01', '2026-02-01'],
  corpusDateCount: 2,
  ...extra,
});

describe('OptionGroupGeneratorStore', () => {
  let store: InstanceType<typeof OptionGroupGeneratorStore>;
  let queryContractAvailability$: jest.Mock;

  const setup = () => {
    queryContractAvailability$ = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        OptionGroupGeneratorStore,
        { provide: ContractAvailabilityService, useValue: { queryContractAvailability$ } },
      ],
    });
    store = TestBed.inject(OptionGroupGeneratorStore);
  };

  afterEach(() => {
    clearGeneratorSettings('QQQ');
    clearGeneratorSettings('SPY');
    TestBed.resetTestingModule();
  });

  describe('run', () => {
    beforeEach(setup);

    it('fetches via the service and populates records/status/truncated/corpusDates', async () => {
      queryContractAvailability$.mockReturnValue(of(response([A, B], { truncated: true })));
      store.setSymbol('qqq');
      await store.run();
      expect(queryContractAvailability$).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'QQQ' }));
      expect(store.records()).toEqual([A, B]);
      expect(store.status()).toBe('idle');
      expect(store.truncated()).toBe(true);
      expect(store.corpusDates()).toEqual(['2026-01-01', '2026-02-01']);
    });

    it('passes the assembled availability request (query state -> wire)', async () => {
      queryContractAvailability$.mockReturnValue(of(response([])));
      store.setSymbol('QQQ');
      store.setQuery({ expirations: ['2026-06-19'], expirationGte: '2026-01-01' });
      await store.run();
      const req = queryContractAvailability$.mock.calls[0][0];
      expect(req.expirations).toEqual(['2026-06-19']);
      expect(req.expirationGte).toBeUndefined();
    });

    it('lands in error state when the service rejects', async () => {
      queryContractAvailability$.mockReturnValue(throwError(() => new Error('boom')));
      store.setSymbol('QQQ');
      await store.run();
      expect(store.status()).toBe('error');
      expect(store.error()).toBe('boom');
      expect(store.records()).toEqual([]);
    });
  });

  describe('refine + filtered', () => {
    beforeEach(setup);

    it('narrows filtered records without refetching', async () => {
      queryContractAvailability$.mockReturnValue(of(response([A, B, C])));
      store.setSymbol('QQQ');
      await store.run();
      store.setRefine({ type: 'put' });
      expect(store.filtered().map((c) => c.contractId)).toEqual([B.contractId]);
      expect(queryContractAvailability$).toHaveBeenCalledTimes(1);
    });

    it('applyRange writes the alive-across-range bound', async () => {
      queryContractAvailability$.mockReturnValue(of(response([A, C])));
      store.setSymbol('QQQ');
      await store.run();
      store.applyRange({ start: '2026-02-01', end: '2026-03-01' });
      expect(store.refine().aliveRange).toEqual({ start: '2026-02-01', end: '2026-03-01' });
      expect(store.filtered().map((c) => c.contractId)).toEqual([A.contractId, C.contractId]);
      store.applyRange({ start: '2026-02-01', end: '2026-12-01' });
      expect(store.filtered()).toEqual([]);
    });

    it('applyRange fills openDate only when useRangeAsOpenDate is on', () => {
      store.setSymbol('QQQ');
      store.applyRange({ start: '2026-02-01', end: '2026-03-01' });
      expect(store.openDate()).toBeNull();
      store.setUseRangeAsOpenDate(true);
      store.applyRange({ start: '2026-04-01', end: '2026-05-01' });
      expect(store.openDate()).toBe('2026-04-01');
    });

    it('applyRange(null) clears the bound', async () => {
      queryContractAvailability$.mockReturnValue(of(response([A])));
      store.setSymbol('QQQ');
      await store.run();
      store.applyRange({ start: '2026-02-01', end: '2026-03-01' });
      store.applyRange(null);
      expect(store.refine().aliveRange).toBeUndefined();
    });

    it('ignores an inverted range', () => {
      store.setSymbol('QQQ');
      store.applyRange({ start: '2026-05-01', end: '2026-03-01' });
      expect(store.refine().aliveRange).toBeUndefined();
      expect(store.openDate()).toBeNull();
    });

    it('rejects empty/whitespace bounds and stores a trimmed copy', () => {
      store.setSymbol('QQQ');
      store.applyRange({ start: '  ', end: '2026-03-01' });
      expect(store.refine().aliveRange).toBeUndefined();
      const caller = { start: ' 2026-02-01 ', end: '2026-03-01' };
      store.applyRange(caller);
      expect(store.refine().aliveRange).toEqual({ start: '2026-02-01', end: '2026-03-01' });
      expect(store.refine().aliveRange).not.toBe(caller);
    });

    it('turning the toggle ON with an active range backfills openDate', () => {
      store.setSymbol('QQQ');
      store.applyRange({ start: '2026-02-01', end: '2026-03-01' });
      expect(store.openDate()).toBeNull();
      store.setUseRangeAsOpenDate(true);
      expect(store.openDate()).toBe('2026-02-01');
    });
  });

  describe('emit', () => {
    beforeEach(setup);

    it('produces sorted pair lines for the page handoff', async () => {
      queryContractAvailability$.mockReturnValue(of(response([C, A])));
      store.setSymbol('QQQ');
      await store.run();
      store.setOpenDate('2026-02-01');
      const lines = store.emit();
      expect(lines).toEqual([
        `2026-02-01,${A.contractId}`,
        `2026-02-01,${C.contractId}`,
      ]);
      expect(store.lastEmitted()).toEqual(lines);
    });

    it('emits bare ids when no open date is set', async () => {
      queryContractAvailability$.mockReturnValue(of(response([B, A])));
      store.setSymbol('QQQ');
      await store.run();
      expect(store.emit()).toEqual([A.contractId, B.contractId]);
    });

    it('emits an empty list over an empty filtered set', () => {
      store.setSymbol('QQQ');
      expect(store.emit()).toEqual([]);
    });
  });

  describe('persistence', () => {
    beforeEach(setup);

    it('run persists query/refine/toggle under rs-optgen:{SYMBOL}', async () => {
      queryContractAvailability$.mockReturnValue(of(response([A])));
      store.setSymbol('QQQ');
      store.setQuery({ strikeGte: 500 });
      store.setRefine({ type: 'call' });
      store.setUseRangeAsOpenDate(true);
      await store.run();
      const blob = readGeneratorSettings('QQQ');
      expect(blob.query.strikeGte).toBe(500);
      expect(blob.refine.type).toBe('call');
      expect(blob.useRangeAsOpenDate).toBe(true);
    });

    it("setSymbol loads that symbol's blob; symbols are isolated", () => {
      localStorage.setItem(`${GENERATOR_SETTINGS_PREFIX}SPY`, JSON.stringify({
        version: GENERATOR_SETTINGS_VERSION,
        query: { type: 'P', strikeLte: 300 },
        refine: {},
        useRangeAsOpenDate: false,
      }));
      store.setSymbol('QQQ');
      store.setQuery({ strikeGte: 500 });
      store.setSymbol('SPY');
      expect(store.query().strikeLte).toBe(300);
      expect(store.query().strikeGte).toBeUndefined();
      expect(store.query().type).toBe('P');
    });

    it('clear resets state to defaults and persists the reset', async () => {
      queryContractAvailability$.mockReturnValue(of(response([A])));
      store.setSymbol('QQQ');
      store.setQuery({ strikeGte: 500 });
      await store.run();
      store.clear();
      expect(store.query()).toEqual({ type: 'BOTH' });
      expect(store.records()).toEqual([]);
      expect(store.status()).toBe('idle');
      expect(localStorage.getItem(`${GENERATOR_SETTINGS_PREFIX}QQQ`)).toBeNull();
      expect(readGeneratorSettings('QQQ').query).toEqual({ type: 'BOTH' });
    });

    it('restores openDate from a persisted toggle+range', () => {
      localStorage.setItem(`${GENERATOR_SETTINGS_PREFIX}QQQ`, JSON.stringify({
        version: GENERATOR_SETTINGS_VERSION,
        query: { type: 'BOTH' },
        refine: { aliveRange: { start: '2026-02-01', end: '2026-03-01' } },
        useRangeAsOpenDate: true,
      }));
      store.setSymbol('QQQ');
      expect(store.openDate()).toBe('2026-02-01');
    });
  });

  describe('stale-response guard', () => {
    beforeEach(setup);

    it('discards a response when the symbol changed mid-fetch', async () => {
      let resolveFetch!: (v: ContractAvailabilityResponse) => void;
      queryContractAvailability$.mockImplementation(() => from(new Promise<ContractAvailabilityResponse>((res) => { resolveFetch = res; })));
      store.setSymbol('QQQ');
      const pending = store.run();
      store.setSymbol('SPY');
      resolveFetch(response([A]));
      await pending;
      expect(store.records()).toEqual([]);
      expect(store.symbol()).toBe('SPY');
      expect(store.status()).toBe('idle');
    });

    it('clear() during an in-flight run discards the late response', async () => {
      let resolveFetch!: (v: ContractAvailabilityResponse) => void;
      queryContractAvailability$.mockImplementation(() => from(new Promise<ContractAvailabilityResponse>((res) => { resolveFetch = res; })));
      store.setSymbol('QQQ');
      const pending = store.run();
      store.clear();
      resolveFetch(response([A]));
      await pending;
      expect(store.records()).toEqual([]);
      expect(store.status()).toBe('idle');
      expect(store.hasRun()).toBe(false);
    });

    it('a second run() supersedes the first — last run wins', async () => {
      const resolvers: ((v: ContractAvailabilityResponse) => void)[] = [];
      queryContractAvailability$.mockImplementation(() =>
        from(new Promise<ContractAvailabilityResponse>((res) => resolvers.push(res))),
      );
      store.setSymbol('QQQ');
      const first = store.run();
      const second = store.run();
      resolvers[0](response([A]));
      resolvers[1](response([B, C]));
      await Promise.all([first, second]);
      expect(store.records()).toEqual([B, C]);
    });
  });
});
