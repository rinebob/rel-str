/**
 * Chart Viewport Store
 *
 * Per-instance NgRx Signal Store for a single FlexChartComponent.
 * Holds crosshair state, hover state, Y-axis viewport, and lifecycle state.
 *
 * The store is provided at the component level so each chart instance has
 * isolated state, while a page-level coordinator can still synchronize
 * crosshair values across chart instances.
 */

import { computed } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';

/** Lifecycle of the Syncfusion chart wrapper */
export type ChartLifecycleState = 'initializing' | 'ready';

/** Y-axis viewport descriptor produced by the active scale strategy */
export interface ChartYAxisViewport {
  /** Syncfusion axis value type */
  valueType: 'Logarithmic' | 'Double';
  /** Suggested minimum */
  min: number;
  /** Suggested maximum */
  max: number;
  /** Optional zoom factor for auto-ranged axes (logarithmic mode) */
  zoomFactor?: number;
  /** Optional zoom position for auto-ranged axes (logarithmic mode) */
  zoomPosition?: number;
}

/** State shape for the chart viewport store */
export interface ChartViewportState {
  /** Whether the mouse is currently over this chart */
  hovered: boolean;
  /** Crosshair date (from the chart under the mouse or a synced value) */
  crosshairDate: Date | null;
  /** Crosshair price (from the chart under the mouse or a synced value) */
  crosshairPrice: number | null;
  /** Current Y-axis viewport computed from the visible bars */
  yAxisViewport: ChartYAxisViewport | null;
  /** Current lifecycle state of the Syncfusion wrapper */
  lifecycle: ChartLifecycleState;
  /** Last recorded mouse Y pixel position for the hovered price overlay */
  hoveredPriceTop: number | null;
}

const initialState: ChartViewportState = {
  hovered: false,
  crosshairDate: null,
  crosshairPrice: null,
  yAxisViewport: null,
  lifecycle: 'initializing',
  hoveredPriceTop: null,
};

export const ChartViewportStore = signalStore(
  withState(initialState),

  withComputed((state) => ({
    /** Formatted crosshair date string for the overlay label */
    crosshairDateLabel: computed(() => {
      const date = state.crosshairDate();
      if (!date) return null;
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }),

    /** Formatted crosshair price string for the overlay label */
    crosshairPriceLabel: computed(() => {
      const price = state.crosshairPrice();
      if (price === null) return null;
      return `$${Math.round(price).toLocaleString('en-US')}`;
    }),
  })),

  withMethods((state) => ({
    /** Mark whether the mouse is over this chart instance */
    setHovered(hovered: boolean): void {
      patchState(state, { hovered });
    },

    /** Set both crosshair values together (e.g., from a mouse move or sync event) */
    setCrosshair(date: Date | null, price: number | null): void {
      patchState(state, { crosshairDate: date, crosshairPrice: price });
    },

    /** Set only the crosshair date */
    setCrosshairDate(date: Date | null): void {
      patchState(state, { crosshairDate: date });
    },

    /** Set only the crosshair price */
    setCrosshairPrice(price: number | null): void {
      patchState(state, { crosshairPrice: price });
    },

    /** Clear the crosshair */
    clearCrosshair(): void {
      patchState(state, { crosshairDate: null, crosshairPrice: null });
    },

    /** Set the Y-axis viewport computed from the active scale strategy */
    setYAxisViewport(viewport: ChartYAxisViewport | null): void {
      patchState(state, { yAxisViewport: viewport });
    },

    /** Update the lifecycle state of the chart wrapper */
    setLifecycle(lifecycle: ChartLifecycleState): void {
      patchState(state, { lifecycle });
    },

    /** Set the last recorded mouse Y pixel position */
    setHoveredPriceTop(pixel: number | null): void {
      patchState(state, { hoveredPriceTop: pixel });
    },

    /** Reset all viewport state (e.g., when the chart data changes) */
    resetViewport(): void {
      patchState(state, {
        hovered: false,
        crosshairDate: null,
        crosshairPrice: null,
        yAxisViewport: null,
        lifecycle: 'initializing',
        hoveredPriceTop: null,
      });
    },
  }))
);

export type ChartViewportStore = InstanceType<typeof ChartViewportStore>;
