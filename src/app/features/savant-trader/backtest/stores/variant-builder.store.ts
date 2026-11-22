/**
 * Variant Builder Store — dialog-scoped composition state for the shared
 * variant builder (#1504). Three modes compose to concrete `legs[]`:
 * a registry named variant (legs read-only), a base-template dial
 * (Δ/DTE picks bounded by each leg's bands), or from-scratch rows.
 *
 * Provided at the dialog component so each open gets a fresh compose
 * state; the component stays a dumb view over these signals.
 */
import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';

import {
  REPLAY_TEMPLATE_SHAPES,
  REPLAY_VARIANTS,
  getReplayVariant,
  getTemplateShape,
  validateVariantLegs,
} from '@options-replay/templates';
import type { VariantLeg } from '@options-replay/contracts';

import {
  DEFAULT_SCRATCH_LEG,
  MAX_VARIANT_LEGS,
  composeScratchLegs,
  composeShapeLegs,
  defaultDialedForShape,
  deltaOptionsForBand,
  variantToJsonBlock,
  type DialedLeg,
  type ScratchLeg,
  type VariantBuilderResult,
} from '../utils/variant-builder.utils';
import { TradeSide } from '@common';
import type { OptionType } from '@options/common';

export type VariantBuilderMode = 'named' | 'shape' | 'scratch';

export interface VariantBuilderState {
  mode: VariantBuilderMode;
  /** Selected named-variant id (`REPLAY_VARIANTS` member). */
  variantId: string;
  /** Selected base-template shape id (`REPLAY_TEMPLATE_SHAPES` member). */
  shapeId: string;
  /** Dialed picks parallel to the selected shape's legs — null slots are
   *  stock legs. Re-seeded whenever the shape changes. */
  dialed: readonly (DialedLeg | null)[];
  /** From-scratch rows. */
  scratchLegs: readonly ScratchLeg[];
  /** Optional run label — stamped as variantName on legs submissions. */
  variantName: string;
  /** Registry id for the Copy JSON export block. */
  exportId: string;
}

// Shared across store instances — safe only because every method writes
// immutably (map/filter/spread); a mutating method would leak state
// across dialog opens.
const initialState: VariantBuilderState = {
  mode: 'named',
  variantId: REPLAY_VARIANTS[0]?.id ?? '',
  shapeId: REPLAY_TEMPLATE_SHAPES[0]?.id ?? '',
  dialed: REPLAY_TEMPLATE_SHAPES[0] ? defaultDialedForShape(REPLAY_TEMPLATE_SHAPES[0]) : [],
  scratchLegs: [{ ...DEFAULT_SCRATCH_LEG }],
  variantName: '',
  exportId: '',
};

/** One rendered leg row in the shape section — stock rows have no
 *  options and display as fixed. */
export interface ShapeLegControl {
  index: number;
  role: string;
  kind: 'option' | 'stock';
  type: OptionType | null;
  side: TradeSide;
  deltaOptions: readonly number[];
  dteOptions: readonly number[];
  pick: DialedLeg | null;
}

export const VariantBuilderStore = signalStore(
  withState(initialState),
  withComputed((store) => ({
    /** Row model for the base-template section — one control per shape
     *  leg; stock rows carry empty options and a null pick. */
    shapeLegControls: computed<readonly ShapeLegControl[]>(() => {
      const shape = getTemplateShape(store.shapeId());
      if (!shape) return [];
      const dialed = store.dialed();
      return shape.legs.map((leg, index) =>
        leg.kind === 'stock'
          ? { index, role: leg.role, kind: 'stock' as const, type: null, side: leg.side, deltaOptions: [], dteOptions: [], pick: null }
          : {
              index,
              role: leg.role,
              kind: 'option' as const,
              type: leg.type,
              side: leg.side,
              deltaOptions: deltaOptionsForBand(leg.deltaBand),
              dteOptions: leg.dteBand,
              pick: dialed[index] ?? null,
            },
      );
    }),
    /** The composition the preview shows — named variants expose their
     *  registry legs; shape/scratch compose from current state. */
    composedLegs: computed<readonly VariantLeg[]>(() => {
      switch (store.mode()) {
        case 'named':
          return getReplayVariant(store.variantId())?.legs ?? [];
        case 'shape': {
          const shape = getTemplateShape(store.shapeId());
          return shape ? composeShapeLegs(shape, store.dialed()) : [];
        }
        case 'scratch':
          return composeScratchLegs(store.scratchLegs());
      }
    }),
  })),
  withComputed((store) => ({
    /** Validator verdict on the current composition — named variants are
     *  pre-validated registry entries; shape/scratch must produce a
     *  non-empty valid leg set within the request boundary's leg cap. */
    legErrors: computed<readonly string[]>(() => {
      if (store.mode() === 'named') return [];
      const legs = store.composedLegs();
      const errs = validateVariantLegs(legs);
      if (legs.length === 0) return ['compose at least one leg', ...errs];
      return legs.length > MAX_VARIANT_LEGS ? [`at most ${MAX_VARIANT_LEGS} legs`, ...errs] : errs;
    }),
  })),
  withComputed((store) => ({
    canSubmit: computed(() => {
      if (store.mode() === 'named') return getReplayVariant(store.variantId()) !== undefined;
      return store.legErrors().length === 0;
    }),
    /** Close payload — named → `{variantId}`; dialed/scratch →
     *  `{legs, variantName?}`. Null while invalid. */
    submitResult: computed<VariantBuilderResult | null>(() => {
      if (store.mode() === 'named') {
        return getReplayVariant(store.variantId()) ? { variantId: store.variantId() } : null;
      }
      if (store.legErrors().length > 0) return null;
      const name = store.variantName().trim();
      return { legs: store.composedLegs(), ...(name ? { variantName: name } : {}) };
    }),
    /** Paste-ready registry block (pretty JSON) for the composition —
     *  empty while there's no id, the id is reserved/already claimed, or
     *  the legs wouldn't survive a paste into the registry spec. */
    exportJson: computed<string>(() => {
      const id = store.exportId().trim();
      const legs = store.composedLegs();
      // 'custom' is the reserved legs-form sentinel; an id already in the
      // registry would collide on paste — fail at the copy, not the spec.
      if (!id || id === 'custom' || getReplayVariant(id) || getTemplateShape(id)) return '';
      if (legs.length === 0 || store.legErrors().length > 0) return '';
      const name = store.variantName().trim();
      const structure =
        store.mode() === 'scratch'
          ? 'custom'
          : store.mode() === 'named'
            ? (getReplayVariant(store.variantId())?.structure ?? 'custom')
            : store.shapeId();
      return JSON.stringify(
        variantToJsonBlock({ id, name: name || id, description: name || id, structure, legs }),
        null,
        2,
      );
    }),
  })),
  withMethods((store) => ({
    setMode(mode: VariantBuilderMode): void {
      patchState(store, { mode });
    },
    selectVariant(variantId: string): void {
      patchState(store, { variantId });
    },
    /** Shape change re-seeds the dialed picks — stale picks for the old
     *  shape's leg count/types can't leak into the new composition. */
    selectShape(shapeId: string): void {
      const shape = getTemplateShape(shapeId);
      patchState(store, { shapeId, dialed: shape ? defaultDialedForShape(shape) : [] });
    },
    setDialed(index: number, patch: Partial<DialedLeg>): void {
      const dialed = store.dialed().map((d, i) => (i === index && d ? { ...d, ...patch } : d));
      patchState(store, { dialed });
    },
    /** Capped at the request boundary's leg limit — a 9-leg composition
     *  would pass local validation but be rejected by the callable. */
    addScratchLeg(): void {
      if (store.scratchLegs().length >= MAX_VARIANT_LEGS) return;
      patchState(store, { scratchLegs: [...store.scratchLegs(), { ...DEFAULT_SCRATCH_LEG }] });
    },
    removeScratchLeg(index: number): void {
      patchState(store, { scratchLegs: store.scratchLegs().filter((_, i) => i !== index) });
    },
    updateScratchLeg(index: number, patch: Partial<ScratchLeg>): void {
      const scratchLegs = store.scratchLegs().map((l, i) => (i === index ? { ...l, ...patch } : l));
      patchState(store, { scratchLegs });
    },
    setVariantName(variantName: string): void {
      patchState(store, { variantName });
    },
    setExportId(exportId: string): void {
      patchState(store, { exportId });
    },
  })),
);
