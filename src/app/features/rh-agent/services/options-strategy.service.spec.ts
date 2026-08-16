/**
 * Unit tests for OptionsStrategyService — verifies callable invocation
 * with correct request shapes and response mapping.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { OptionsStrategyService } from './options-strategy.service';
import {
  OptionsPositionStatus,
  type StrategyPositionsResponse,
  type StrategyEquityCurveResponse,
} from './options-strategy.types';

describe('OptionsStrategyService', () => {
  let service: OptionsStrategyService;
  let mockCallable: jest.Mock;

  beforeEach(() => {
    mockCallable = jest.fn();
    (httpsCallable as jest.Mock).mockReturnValue(mockCallable);

    TestBed.configureTestingModule({
      providers: [
        OptionsStrategyService,
        { provide: Functions, useValue: new (Functions as any)() },
      ],
    });
    service = TestBed.inject(OptionsStrategyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listStrategyPositions$', () => {
    it('calls the listStrategyPositions callable with empty request by default', (done) => {
      const response: StrategyPositionsResponse = { openPositions: [], closedPositions: [] };
      mockCallable.mockResolvedValue({ data: response });

      service.listStrategyPositions$().subscribe({
        next: (result) => {
          expect(result).toEqual(response);
          expect(mockCallable).toHaveBeenCalledWith({});
          done();
        },
        error: done.fail,
      });
    });

    it('passes instanceId and status through to the callable', (done) => {
      const response: StrategyPositionsResponse = { openPositions: [], closedPositions: [] };
      mockCallable.mockResolvedValue({ data: response });

      service.listStrategyPositions$({ instanceId: 'QQQM-WHEEL', status: OptionsPositionStatus.OPEN }).subscribe({
        next: () => {
          expect(mockCallable).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL', status: OptionsPositionStatus.OPEN });
          done();
        },
        error: done.fail,
      });
    });
  });

  describe('getStrategyEquityCurve$', () => {
    it('calls the getStrategyEquityCurve callable with empty request by default (ALL scope)', (done) => {
      const response: StrategyEquityCurveResponse = { points: [], stats: null };
      mockCallable.mockResolvedValue({ data: response });

      service.getStrategyEquityCurve$().subscribe({
        next: (result) => {
          expect(result).toEqual(response);
          expect(mockCallable).toHaveBeenCalledWith({});
          done();
        },
        error: done.fail,
      });
    });

    it('passes instanceId through to the callable for per-symbol scope', (done) => {
      const response: StrategyEquityCurveResponse = { points: [], stats: null };
      mockCallable.mockResolvedValue({ data: response });

      service.getStrategyEquityCurve$({ instanceId: 'QQQM-WHEEL' }).subscribe({
        next: () => {
          expect(mockCallable).toHaveBeenCalledWith({ instanceId: 'QQQM-WHEEL' });
          done();
        },
        error: done.fail,
      });
    });
  });
});
