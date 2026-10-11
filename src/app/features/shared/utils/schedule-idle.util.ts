/**
 * Idle-callback scheduling with a setTimeout fallback for jsdom and older
 * browsers. Shared by pages that warm caches after first paint (the signal
 * gallery and the portfolio gallery both schedule bar prefetch this way).
 */

const HAS_IDLE_CALLBACK =
  typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function';

export function scheduleIdle(cb: () => void): number {
  return HAS_IDLE_CALLBACK ? requestIdleCallback(cb) : window.setTimeout(cb, 0);
}

export function cancelIdle(id: number): void {
  if (HAS_IDLE_CALLBACK) cancelIdleCallback(id); else clearTimeout(id);
}
