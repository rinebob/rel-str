import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';

import { HEATMAP_PALETTES, HeatmapPaletteId, HeatmapPaletteMeta, getHeatmapPaletteMeta } from '../utils/heatmap-color-registry';

interface HeatmapPaletteState {
  selectedPaletteId: HeatmapPaletteId;
}

const DEFAULT_PALETTE_ID: HeatmapPaletteId = 'twoColorRedBlue';

const initialState: HeatmapPaletteState = {
  selectedPaletteId: DEFAULT_PALETTE_ID,
};

export const HeatmapPaletteStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    /** Return all available palette metadata entries. */
    getPalettes(): readonly HeatmapPaletteMeta[] {
      return HEATMAP_PALETTES;
    },

    /** Return metadata for the currently selected palette (or default). */
    getSelectedPaletteMeta(): HeatmapPaletteMeta | undefined {
      return (
        getHeatmapPaletteMeta(store.selectedPaletteId()) ??
        getHeatmapPaletteMeta(DEFAULT_PALETTE_ID) ??
        undefined
      );
    },

    /** Compute the concrete colors for the currently selected palette. */
    getSelectedPaletteColors(): string[] {
      const meta = this.getSelectedPaletteMeta();
      return meta ? meta.createColors() : [];
    },

    /** Update the selected palette id. */
    setPalette(id: HeatmapPaletteId): void {
      const meta = getHeatmapPaletteMeta(id) ?? getHeatmapPaletteMeta(DEFAULT_PALETTE_ID);
      if (!meta) {
        return;
      }
      patchState(store, { selectedPaletteId: meta.id });
    },
  })),
);
