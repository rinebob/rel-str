import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { TriageStore } from './triage.store';
import { ReviewDecision } from '../common/constants';

/**
 * #1016 — review-list persistence was removed (TriageService deleted).
 * Flags are session-local only; these specs pin the in-memory behavior
 * that remains until the review pages are repurposed.
 */
describe('TriageStore', () => {
  let store: InstanceType<typeof TriageStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), TriageStore],
    });

    store = TestBed.inject(TriageStore);
  });

  describe('markForReview', () => {
    it('flags the symbol in memory', () => {
      store.markForReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBe(true);
    });

    it('does not write a screening status — that map is CONSIDER/WATCH only (#1016)', () => {
      store.markForReview('AAPL');
      expect(store.screeningStatuses()['AAPL']).toBeUndefined();
    });
  });

  describe('unmarkFromReview', () => {
    beforeEach(() => {
      store.markForReview('AAPL');
    });

    it('unflags the symbol in memory', () => {
      store.unmarkFromReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBeUndefined();
    });

    it('leaves screening statuses untouched', () => {
      store.setScreeningStatus('AAPL', ReviewDecision.CONSIDER);
      store.unmarkFromReview('AAPL');
      expect(store.screeningStatuses()['AAPL']).toBe(ReviewDecision.CONSIDER);
    });
  });

  describe('markGroupForReview', () => {
    it('flags all symbols in memory', () => {
      store.markGroupForReview(['AAPL', 'MSFT', 'GOOG']);
      expect(store.reviewFlags()['AAPL']).toBe(true);
      expect(store.reviewFlags()['MSFT']).toBe(true);
      expect(store.reviewFlags()['GOOG']).toBe(true);
    });
  });

  describe('clearReviewFlags', () => {
    beforeEach(() => {
      store.markForReview('AAPL');
      store.markForReview('MSFT');
    });

    it('clears all flags in memory', () => {
      store.clearReviewFlags();
      expect(Object.keys(store.reviewFlags()).length).toBe(0);
    });
  });

  describe('screeningStatuses', () => {
    it('initializes empty', () => {
      expect(store.screeningStatuses()).toEqual({});
    });

    it('setScreeningStatus sets CONSIDER for a symbol', () => {
      store.setScreeningStatus('AAPL', ReviewDecision.CONSIDER);
      expect(store.screeningStatuses()['AAPL']).toBe(ReviewDecision.CONSIDER);
    });

    it('setScreeningStatus sets WATCH for a symbol', () => {
      store.setScreeningStatus('MSFT', ReviewDecision.WATCH);
      expect(store.screeningStatuses()['MSFT']).toBe(ReviewDecision.WATCH);
    });

    it('clearScreeningStatuses removes all screening statuses', () => {
      store.setScreeningStatus('AAPL', ReviewDecision.CONSIDER);
      store.setScreeningStatus('MSFT', ReviewDecision.WATCH);
      store.clearScreeningStatuses();
      expect(store.screeningStatuses()).toEqual({});
    });

    it('resetForRun clears screening statuses but review flags survive run switches', () => {
      store.markForReview('MSFT');
      store.setScreeningStatus('AAPL', ReviewDecision.CONSIDER);
      store.resetForRun();
      expect(store.screeningStatuses()).toEqual({});
      expect(store.reviewFlags()['MSFT']).toBe(true);
    });
  });
});
