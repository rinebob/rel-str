import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { TriageStore } from './triage.store';
import { TriageService } from '../services/triage.service';
import { ReviewDecision } from '../common/constants';

describe('TriageStore', () => {
  let store: InstanceType<typeof TriageStore>;
  let triageService: any;
  let snackBar: any;

  beforeEach(() => {
    triageService = {
      setReviewFlag: jasmine.createSpy('setReviewFlag'),
      clearReviewFlag: jasmine.createSpy('clearReviewFlag'),
      setReviewFlagsBatch: jasmine.createSpy('setReviewFlagsBatch'),
      loadReviewFlags: jasmine.createSpy('loadReviewFlags').and.returnValue(of([])),
    };

    snackBar = { open: jasmine.createSpy('open') };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TriageService, useValue: triageService },
        { provide: MatSnackBar, useValue: snackBar },
        TriageStore,
      ],
    });

    store = TestBed.inject(TriageStore);
  });

  describe('markForReview', () => {
    it('optimistically flags the symbol and calls triageService.setReviewFlag', () => {
      triageService.setReviewFlag.and.returnValue(of(undefined));
      store.markForReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBe(true);
      expect(triageService.setReviewFlag).toHaveBeenCalledWith('AAPL');
    });

    it('reverts the flag and shows snackbar on error', () => {
      triageService.setReviewFlag.and.returnValue(throwError(() => new Error('network')));
      store.markForReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBeUndefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('unmarkFromReview', () => {
    beforeEach(() => {
      triageService.setReviewFlag.and.returnValue(of(undefined));
      store.markForReview('AAPL');
    });

    it('optimistically unflags the symbol and calls triageService.clearReviewFlag', () => {
      triageService.clearReviewFlag.and.returnValue(of(undefined));
      store.unmarkFromReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBeUndefined();
      expect(triageService.clearReviewFlag).toHaveBeenCalledWith('AAPL');
    });

    it('reverts the flag and shows snackbar on error', () => {
      triageService.clearReviewFlag.and.returnValue(throwError(() => new Error('network')));
      store.unmarkFromReview('AAPL');
      expect(store.reviewFlags()['AAPL']).toBe(true);
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('markGroupForReview', () => {
    it('optimistically flags all symbols and calls triageService.setReviewFlagsBatch with true', () => {
      triageService.setReviewFlagsBatch.and.returnValue(of(undefined));
      store.markGroupForReview(['AAPL', 'MSFT', 'GOOG']);
      expect(store.reviewFlags()['AAPL']).toBe(true);
      expect(store.reviewFlags()['MSFT']).toBe(true);
      expect(store.reviewFlags()['GOOG']).toBe(true);
      expect(triageService.setReviewFlagsBatch).toHaveBeenCalledWith(['AAPL', 'MSFT', 'GOOG'], true);
    });

    it('reverts all flags and shows snackbar on error', () => {
      triageService.setReviewFlagsBatch.and.returnValue(throwError(() => new Error('network')));
      store.markGroupForReview(['AAPL', 'MSFT']);
      expect(store.reviewFlags()['AAPL']).toBeUndefined();
      expect(store.reviewFlags()['MSFT']).toBeUndefined();
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('clearReviewFlags', () => {
    beforeEach(() => {
      triageService.setReviewFlag.and.returnValue(of(undefined));
      store.markForReview('AAPL');
      store.markForReview('MSFT');
    });

    it('optimistically clears all flags and calls triageService.setReviewFlagsBatch with false', () => {
      triageService.setReviewFlagsBatch.and.returnValue(of(undefined));
      store.clearReviewFlags();
      expect(Object.keys(store.reviewFlags()).length).toBe(0);
      expect(triageService.setReviewFlagsBatch).toHaveBeenCalledWith(['AAPL', 'MSFT'], false);
    });

    it('reverts flags and shows snackbar on error', () => {
      triageService.setReviewFlagsBatch.and.returnValue(throwError(() => new Error('network')));
      store.clearReviewFlags();
      expect(store.reviewFlags()['AAPL']).toBe(true);
      expect(store.reviewFlags()['MSFT']).toBe(true);
      expect(snackBar.open).toHaveBeenCalled();
    });
  });

  describe('reviewFlagsLoading', () => {
    it('initializes with loading false after load completes', () => {
      expect(store.loading()).toBe(false);
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

    it('resetForRun clears both review flags and screening statuses', () => {
      store.setScreeningStatus('AAPL', ReviewDecision.CONSIDER);
      store.resetForRun();
      expect(store.screeningStatuses()).toEqual({});
      expect(store.reviewFlags()).toEqual({});
    });
  });
});
