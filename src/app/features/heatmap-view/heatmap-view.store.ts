import { signalStore } from '@ngrx/signals';
import { withHeatmapViewStore } from './heatmap-view.feature';

export const HeatmapViewStore = signalStore(
  { providedIn: 'root' },
  withHeatmapViewStore(),
);