export interface DiscreteLnsPalette {
  readonly id: string;
  readonly label: string;
  readonly colors: readonly [string, string, string]; // [SHORT, NEUTRAL, LONG]
}

export interface GradientStopsPalette {
  readonly id: string;
  readonly label: string;
  readonly stops: readonly string[];
}

// Long blue / short red / neutral mid.
// Index convention matches LnsState -> index mapping in lns-thresholds.ts
// (0 = SHORT, 1 = NEUTRAL, 2 = LONG).
export const LNS_LONG_BLUE_SHORT_RED: DiscreteLnsPalette = {
  id: 'lnsLongBlueShortRed',
  label: 'Long Blue / Short Red',
  colors: [
    '#d7191c', // SHORT (red)
    '#f7f7f7', // NEUTRAL
    '#2c7bb6', // LONG (blue)
  ],
};

// Classic red -> yellow -> green gradient stops used by generateColorArray.
export const CLASSIC_RED_YELLOW_GREEN_STOPS: GradientStopsPalette = {
  id: 'classicRedYellowGreen',
  label: 'Classic Red / Yellow / Green',
  stops: ['#ff0000', '#ffff00', '#00ff00'],
};

// Warm/cold diverging gradient stops used by generateWarmColdColorArray.
export const WARM_COLD_DIVERGING_STOPS: GradientStopsPalette = {
  id: 'warmColdDiverging',
  label: 'Warm / Cold Diverging',
  stops: ['#2c7bb6', '#a6cee3', '#f7f7f7', '#fdae61', '#d7191c'],
};

// Half warm / half cool gradient stops used by generateHalfWarmHalfCoolColorArray.
export const HALF_WARM_HALF_COOL_STOPS: GradientStopsPalette = {
  id: 'halfWarmHalfCool',
  label: 'Half Warm / Half Cool',
  stops: ['#2166ac', '#a6cee3', '#f7f7f7', '#fdae61', '#b2182b'],
};
