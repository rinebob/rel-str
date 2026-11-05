/// <reference types="jest" />
/**
 * Tests for the dev-screenshot utilities — saved spec presets and the
 * GCS console URL builder (Topic #746, task #801).
 */
import { CaptureEvent } from '@screenshot-capture/contracts';
import { gcsConsoleUrl, SPEC_PRESETS } from './dev-screenshot.utils';

describe('dev-screenshot.utils (#801)', () => {
  describe('SPEC_PRESETS', () => {
    it('ships at least two presets with unique keys', () => {
      expect(SPEC_PRESETS.length).toBeGreaterThanOrEqual(2);
      const keys = SPEC_PRESETS.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('every preset carries a non-empty label and symbol', () => {
      for (const p of SPEC_PRESETS) {
        expect(p.label.trim()).not.toBe('');
        expect(p.symbol.trim()).not.toBe('');
      }
    });

    it('lifecycle-sim presets cover order-placed/order-filled/position-closed', () => {
      const events = new Set(SPEC_PRESETS.map((p) => p.event));
      expect(events).toContain(CaptureEvent.ORDER_PLACED);
      expect(events).toContain(CaptureEvent.ORDER_FILLED);
      expect(events).toContain(CaptureEvent.POSITION_CLOSED);
    });
  });

  describe('gcsConsoleUrl', () => {
    it('builds the object-detail link for a stored artifact path', () => {
      expect(gcsConsoleUrl('rel-str.appspot.com', 'rel-str', 'st-trade-screenshots/GOOG/x.svg'))
        .toBe('https://console.cloud.google.com/storage/browser/_details/rel-str.appspot.com/st-trade-screenshots/GOOG/x.svg?project=rel-str');
    });
  });
});
