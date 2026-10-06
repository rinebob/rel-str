/**
 * Unit tests for ScreenshotService — verifies httpsCallable wiring with the
 * correct callable name, spec pass-through, and res.data unwrapping.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { lastValueFrom } from 'rxjs';

import { ScreenshotService } from './screenshot.service';
import { CallableName } from '../../core/common/constants';
import {
  CaptureChartResult,
  CaptureChartSpec,
  CaptureEvent,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';

const SPEC: CaptureChartSpec = {
  symbol: 'GOOG',
  event: CaptureEvent.MANUAL,
  positionType: PositionType.STOCK,
  intervals: [ChartInterval.DAILY, ChartInterval.WEEKLY],
};

describe('ScreenshotService', () => {
  let service: ScreenshotService;
  let mockCallable: jest.Mock;

  beforeEach(() => {
    mockCallable = jest.fn().mockResolvedValue({ data: { svg: '<svg/>', paths: [], artifacts: [] } });
    (httpsCallable as jest.Mock).mockReturnValue(mockCallable);

    TestBed.configureTestingModule({
      providers: [
        ScreenshotService,
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(ScreenshotService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('captureChartSnapshot$ calls the right callable and unwraps res.data', async () => {
    const res = await lastValueFrom(service.captureChartSnapshot$(SPEC));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.CAPTURE_CHART_SNAPSHOT);
    expect(mockCallable).toHaveBeenCalledWith(SPEC);
    expect(res.svg).toBe('<svg/>');
  });

  it('propagates callable errors (typed codes reach the caller)', async () => {
    const err = Object.assign(new Error('nope'), { code: 'functions/failed-precondition' });
    mockCallable.mockRejectedValue(err);

    await expect(lastValueFrom(service.captureChartSnapshot$(SPEC))).rejects.toMatchObject({
      code: 'functions/failed-precondition',
    });
  });

  it('forwards optional spec fields unchanged', async () => {
    const spec: CaptureChartSpec = {
      ...SPEC,
      refId: 'ord-9',
      width: 400,
      height: 280,
      visibleBars: 'all',
    };
    await lastValueFrom(service.captureChartSnapshot$(spec));
    expect(mockCallable).toHaveBeenCalledWith(spec);
  });
});
