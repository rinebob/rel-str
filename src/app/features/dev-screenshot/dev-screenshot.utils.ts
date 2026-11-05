/**
 * Dev-page utilities for /dev/screenshot (Topic #746, task #801):
 * saved spec presets and the GCS console URL builder for stored paths.
 */
import { CaptureEvent } from '@screenshot-capture/contracts';

/** One saved form preset — selecting it fills the whole spec form so a
 *  lifecycle-event simulation is one click, not a form re-fill. */
export interface SpecPreset {
  key: string;
  label: string;
  symbol: string;
  event: CaptureEvent;
  intervalDaily: boolean;
  intervalWeekly: boolean;
  refId: string;
  visibleBars: string;
  store: boolean;
}

export const SPEC_PRESETS: readonly SpecPreset[] = [
  {
    key: 'quick-look',
    label: 'Quick look — manual, render only',
    symbol: 'GOOG',
    event: CaptureEvent.MANUAL,
    intervalDaily: true,
    intervalWeekly: true,
    refId: '',
    visibleBars: '30',
    store: false,
  },
  {
    key: 'order-placed-sim',
    label: 'Simulate order-placed (stored)',
    symbol: 'GOOG',
    event: CaptureEvent.ORDER_PLACED,
    intervalDaily: true,
    intervalWeekly: true,
    refId: 'ord-sim-001',
    visibleBars: '30',
    store: true,
  },
  {
    key: 'order-filled-sim',
    label: 'Simulate order-filled (stored)',
    symbol: 'GOOG',
    event: CaptureEvent.ORDER_FILLED,
    intervalDaily: true,
    intervalWeekly: true,
    refId: 'ord-sim-001',
    visibleBars: '30',
    store: true,
  },
  {
    key: 'position-closed-sim',
    label: 'Simulate position-closed (stored)',
    symbol: 'GOOG',
    event: CaptureEvent.POSITION_CLOSED,
    intervalDaily: true,
    intervalWeekly: true,
    refId: 'pos-sim-001',
    visibleBars: '30',
    store: true,
  }];

/** How long the "Copied" flash stays on a path row — exported so specs can
 *  advance fake timers against the same constant (POPUP_COPIED_MS pattern). */
export const COPIED_FLASH_MS = 2000;

/** Cloud-console object-detail URL for a stored artifact — opens the exact
 *  object in the bucket browser so the operator can preview/download it. */
export function gcsConsoleUrl(bucket: string, projectId: string, path: string): string {
  return `https://console.cloud.google.com/storage/browser/_details/${bucket}/${path}?project=${projectId}`;
}
