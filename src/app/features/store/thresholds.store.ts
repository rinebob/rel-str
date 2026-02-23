import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export type LnsState = 'LONG' | 'NEUTRAL' | 'SHORT';

export interface ThresholdConfig {
  neutralToLong: number;
  longToNeutral: number;
  neutralToShort: number;
  shortToNeutral: number;
}

// Default threshold values for long/neutral/short hysteresis in normalized RS space [0, 1].
export const DEFAULT_NEUTRAL_TO_LONG = 0.6;
export const DEFAULT_LONG_TO_NEUTRAL = 0.55;
export const DEFAULT_NEUTRAL_TO_SHORT = 0.4;
export const DEFAULT_SHORT_TO_NEUTRAL = 0.45;

export interface ThresholdsState {
  readonly config: ThresholdConfig;
}

const initialState: ThresholdsState = {
  config: {
    neutralToLong: DEFAULT_NEUTRAL_TO_LONG,
    longToNeutral: DEFAULT_LONG_TO_NEUTRAL,
    neutralToShort: DEFAULT_NEUTRAL_TO_SHORT,
    shortToNeutral: DEFAULT_SHORT_TO_NEUTRAL,
  },
};

export const ThresholdsStore = signalStore(
  { providedIn: 'root' },
  withState<ThresholdsState>(initialState),
  withMethods((store) => ({
    /** Get the current threshold configuration. */
    getConfig(): ThresholdConfig {
      return store.config();
    },

    /** Replace the entire threshold configuration. */
    setConfig(config: ThresholdConfig): void {
      patchState(store, { config });
    },

    /**
     * Partially update the threshold configuration.
     * Useful for binding individual form controls in the UI.
     */
    patchConfig(partial: Partial<ThresholdConfig>): void {
      patchState(store, { config: { ...store.config(), ...partial } });
    },
  })),
);
