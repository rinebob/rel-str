import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { TriageStore } from './triage.store';

/**
 * #1016 — review-list persistence was removed (TriageService deleted).
 * Flags are session-local only; these specs pin the in-memory behavior
 * that remains until the review pages are repurposed.
 * #1017 — the ACR workflow is gone; the ephemeral CONSIDER/WATCH
 * screening-status state was removed with it.
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
  });

  describe('unmarkFromReview', () => {
    beforeEach(() => {
      store.markForReview('AAPL');
    });

    it('unflags the symbol in memory', () => {
      store.unmarkFromReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBeUndefined();
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

  describe('resetForRun', () => {
    it('is a no-op seam — review flags survive run switches (#1017)', () => {
      store.markForReview('MSFT');
      store.resetForRun();
      expect(store.reviewFlags()['MSFT']).toBe(true);
    });
  });
});
