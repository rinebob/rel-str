/**
 * Variant-builder composition helpers (#1504) — pure functions the
 * builder dialog and its store share. Bands are |Δ|% magnitudes over the
 * pick-doc grid; composed legs carry SIGNED deltas (put → negative,
 * call → positive) matching the SA convention in `OptionLeg`.
 */
import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import {
  PICK_GRID_DELTA_BAND,
  PICK_GRID_DELTA_STEP,
  type ReplayVariant,
  type VariantLeg,
} from '@options-replay/contracts';
import type {
  TemplateShape,
  TemplateShapeOptionLeg,
} from '@options-replay/templates';

/** One dialed option-slot pick — magnitude Δ% + DTE cell. */
export interface DialedLeg {
  deltaMag: number;
  dte: number;
}

/** A from-scratch leg row — `type`/`deltaMag`/`dte` apply only to option
 *  rows but stay populated for a stable row model. */
export interface ScratchLeg {
  kind: 'option' | 'stock';
  type: OptionType;
  side: TradeSide;
  deltaMag: number;
  dte: number;
}

/** The inline-composition member of `VariantBuilderResult` — concrete
 *  legs plus an optional display name. */
export interface VariantLegsResult {
  legs: readonly VariantLeg[];
  variantName?: string;
}

/** Dialog close payload — the caller maps it to its own request shape
 *  (`{variantId}` run form vs `{legs, variantName}` inline form, or form
 *  fields on the strategy surface). */
export type VariantBuilderResult = { variantId: string } | VariantLegsResult;

/** Grid Δ magnitudes inside a shape leg's band — the picker's options. */
export function deltaOptionsForBand(band: readonly [number, number]): number[] {
  const out: number[] = [];
  for (let m = PICK_GRID_DELTA_BAND[0]; m <= PICK_GRID_DELTA_BAND[1]; m += PICK_GRID_DELTA_STEP) {
    if (m >= band[0] && m <= band[1]) out.push(m);
  }
  return out;
}

/** Sign a |Δ|% magnitude by option type — SA convention: puts negative. */
export function signedTargetDelta(type: OptionType, magnitudePct: number): number {
  const mag = magnitudePct / 100;
  return type === OptionType.PUT ? -mag : mag;
}

/** Default pick for a band — the grid value nearest the band midpoint
 *  (ties go down), so a fresh dial lands mid-band, not at an edge. */
export function defaultDeltaForBand(band: readonly [number, number]): number {
  const options = deltaOptionsForBand(band);
  const mid = (band[0] + band[1]) / 2;
  return options.reduce((best, m) => (Math.abs(m - mid) < Math.abs(best - mid) ? m : best), options[0] ?? band[0]);
}

/** Parallel-to-`shape.legs` dialed picks: null for stock slots, seeded
 *  defaults for option slots (default Δ, band's first DTE). */
export function defaultDialedForShape(shape: TemplateShape): readonly (DialedLeg | null)[] {
  return shape.legs.map((leg) =>
    leg.kind === 'option'
      ? { deltaMag: defaultDeltaForBand(leg.deltaBand), dte: leg.dteBand[0] }
      : null,
  );
}

function optionSlotToLeg(slot: TemplateShapeOptionLeg, pick: DialedLeg): VariantLeg {
  return {
    kind: 'option',
    type: slot.type,
    targetDelta: signedTargetDelta(slot.type, pick.deltaMag),
    dte: pick.dte,
    side: slot.side,
  };
}

/** Resolve a dialed shape to concrete legs — `dialed` is parallel to
 *  `shape.legs`; a null/absent slot falls back to that leg's default. */
export function composeShapeLegs(
  shape: TemplateShape,
  dialed: readonly (DialedLeg | null)[],
): VariantLeg[] {
  const fallback = defaultDialedForShape(shape);
  return shape.legs.map((leg, i) =>
    leg.kind === 'stock'
      ? { kind: 'stock', side: leg.side }
      : optionSlotToLeg(leg, dialed[i] ?? fallback[i]!),
  );
}

/** Resolve scratch rows — same mapping, no shape behind it. */
export function composeScratchLegs(rows: readonly ScratchLeg[]): VariantLeg[] {
  return rows.map((row) =>
    row.kind === 'stock'
      ? { kind: 'stock', side: row.side }
      : {
          kind: 'option',
          type: row.type,
          targetDelta: signedTargetDelta(row.type, row.deltaMag),
          dte: row.dte,
          side: row.side,
        },
  );
}

/** The default row added by Add-leg — the catalog's most common pick. */
export const DEFAULT_SCRATCH_LEG: ScratchLeg = {
  kind: 'option',
  type: OptionType.PUT,
  side: TradeSide.SHORT,
  deltaMag: 20,
  dte: 45,
};

/** Request-boundary cap — `optionsReplayStart` rejects `legs.length > 8`
 *  (`functions/src/options-replay/start.ts`); mirrored so the builder can
 *  never compose a run the server refuses. */
export const MAX_VARIANT_LEGS = 8;

/** Paste-ready registry block for a composition worth keeping —
 *  `structure` carries the source shape id, or 'custom' for scratch. */
export function variantToJsonBlock(input: {
  id: string;
  name: string;
  description: string;
  structure: string;
  legs: readonly VariantLeg[];
}): ReplayVariant {
  return {
    id: input.id.trim(),
    name: input.name,
    description: input.description,
    structure: input.structure,
    legs: input.legs,
  };
}
