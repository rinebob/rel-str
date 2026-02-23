import Gradient from 'javascript-color-gradient';
import {
    CLASSIC_RED_YELLOW_GREEN_STOPS,
    WARM_COLD_DIVERGING_STOPS,
    HALF_WARM_HALF_COOL_STOPS,
} from './heatmap-base-palettes';

export function generateColorArray(midpoints: number) {
    const colors = new Gradient()
        // classic red -> yellow -> green
        .setColorGradient(...CLASSIC_RED_YELLOW_GREEN_STOPS.stops)
        .setMidpoint(midpoints)
        .getColors();

    // console.log('cUtil gCFP gradient colors: ', colors);
    return colors;
}

/**
 * Generates a warm/cold diverging color array for the heatmap.
 *
 * Negative values trend toward cool blues, positive values toward warm
 * oranges/reds, and zero is a light neutral. This is intended to make
 * positive moves as visually prominent as negative moves while avoiding
 * the red/green blending around the midpoint.
 */
export function generateWarmColdColorArray(midpoints: number) {
    const colors = new Gradient()
        // cool blue -> cyan -> light neutral -> warm orange -> red
        .setColorGradient(...WARM_COLD_DIVERGING_STOPS.stops)
        .setMidpoint(midpoints)
        .getColors();

    return colors;
}

export function generateHalfWarmHalfCoolColorArray(midpoints: number) {
    const colors = new Gradient()
        // strong cool blue at 0, light neutral around 0.5, warm orange/red toward 1
        .setColorGradient(...HALF_WARM_HALF_COOL_STOPS.stops)
        .setMidpoint(midpoints)
        .getColors();

    return colors;
}

// Strict two-color palette: index 0 = cold/down (red), index 1 = warm/up (blue).
// With the existing index calculation (metric >= 0.5 ? 1 : 0 for 2 colors),
// any value < 0.5 maps to index 0 (red), and >= 0.5 maps to index 1 (blue).
export function generateTwoColorWarmCoolArray(): string[] {
    return [
        '#d7191c', // cold/down red for lower half of values
        '#2c7bb6', // warm/up blue for upper half of values
    ];
}
