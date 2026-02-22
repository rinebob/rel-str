import { NUM_HEATMAP_MIDPOINTS } from '../../core/common/constants';
import {
    generateColorArray,
    generateHalfWarmHalfCoolColorArray,
    generateTwoColorWarmCoolArray,
    generateWarmColdColorArray,
} from './color-utils';

export type HeatmapPaletteId =
    | 'classicRedGreen'
    | 'warmCoolDiverging'
    | 'halfWarmHalfCool'
    | 'twoColorRedBlue';

export interface HeatmapPaletteMeta {
    readonly id: HeatmapPaletteId;
    readonly label: string;
    readonly description: string;
    readonly kind: 'gradient' | 'binary';
    readonly createColors: () => string[];
}

const PALETTES_INTERNAL: HeatmapPaletteMeta[] = [
    {
        id: 'classicRedGreen',
        label: 'Classic (Red/Green)',
        description: 'Original red → yellow → green gradient used in v2.',
        kind: 'gradient',
        createColors: () => generateColorArray(NUM_HEATMAP_MIDPOINTS),
    },
    {
        id: 'warmCoolDiverging',
        label: 'Warm/Cool Gradient',
        description: 'Blue ↔ red diverging gradient with neutral midpoint.',
        kind: 'gradient',
        createColors: () => generateWarmColdColorArray(NUM_HEATMAP_MIDPOINTS),
    },
    {
        id: 'halfWarmHalfCool',
        label: 'Half Warm / Half Cool',
        description: 'Gradient with cooler lower half and warmer upper half.',
        kind: 'gradient',
        createColors: () => generateHalfWarmHalfCoolColorArray(NUM_HEATMAP_MIDPOINTS),
    },
    {
        id: 'twoColorRedBlue',
        label: 'Binary (Red/Blue 0.5 Split)',
        description: 'Two-color scheme: red below 0.5, blue at or above 0.5.',
        kind: 'binary',
        createColors: () => generateTwoColorWarmCoolArray(),
    },
];

export const HEATMAP_PALETTES: readonly HeatmapPaletteMeta[] = PALETTES_INTERNAL;

export function getHeatmapPaletteMeta(id: HeatmapPaletteId): HeatmapPaletteMeta | undefined {
    return PALETTES_INTERNAL.find((p) => p.id === id);
}
