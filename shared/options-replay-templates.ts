/**
 * Selection Replay template registry (Topic #1238, Thread #1240).
 *
 * Code-curated, imported directly by FE (run-dialog picker) and BE
 * (`optionsReplayStart` validation) — no listing callable.
 *
 * Two-registry model (Thread #1270, task #1492):
 * - `REPLAY_TEMPLATE_SHAPES` — base templates: leg *structure* plus
 *   delta/DTE *bands*, no concrete values. Bands bound the FE builder
 *   dials only; the BE validates the concrete legs it receives, never
 *   band membership.
 * - `REPLAY_VARIANTS` — concrete named configurations: every option leg
 *   carries a pinned Δ/DTE. The four legacy templates (`csp-45-20`,
 *   `csp-30-30`, `lc-30-20`, `lc-45-15`) migrate verbatim as 1-leg
 *   variants — `variantId` keeps working for them.
 *
 * `REPLAY_TEMPLATES`/`getReplayTemplate` are the legacy read surface,
 * derived from `REPLAY_VARIANTS` so the v1 picker and BE validation keep
 * working until the builder dialog ships (#1507).
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import {
  legToPickDocCoordinate,
  PICK_GRID_DELTA_BAND,
  PICK_GRID_DTES,
  type ReplayTemplate,
  type ReplayVariant,
} from './options-replay-contracts';

// ==========================
// Template shapes
// ==========================

/**
 * Spread-structure vocabulary for shapes. `'custom'` is the escape hatch
 * for unmodeled structures — no seeded shape uses it. Note this is the
 * value of `TemplateShape.structure`; `ReplayVariant.structure` holds a
 * shape *id* (or 'custom'), not a member of this union.
 */
export type TemplateStructure =
  | 'single'
  | 'vertical-credit'
  | 'vertical-debit'
  | 'iron-condor'
  | 'iron-butterfly'
  | 'calendar'
  | 'diagonal'
  | 'straddle'
  | 'strangle'
  | 'covered-call'
  | 'custom';

/**
 * An option-leg slot inside a base template — structure + bounds, no
 * concrete values. Bands constrain the FE controls only (authoring
 * guidance); a variant pinned off-band but on-grid still validates
 * server-side.
 */
export interface TemplateShapeOptionLeg {
  /** Display + semantic role, e.g. 'short' | 'long'. Leg identity is
   *  array position — roles repeat within a shape (condor has two
   *  'short' legs). */
  role: string;
  kind: 'option';
  type: OptionType;
  side: TradeSide;
  /**
   * |Δ|% bounds over the 5-step grid — MAGNITUDES, not signed deltas
   * ([15,35] on a put means -0.15..-0.35, matching SA's `deltaPct`
   * grid key). Deliberately divergent from the manage domain's
   * `ManageTemplateOptionLeg.deltaMin/deltaMax`, which are signed
   * fractions (-0.35..-0.15) — copy a value across registries and it
   * is silently wrong by sign and ×100.
   */
  deltaBand: readonly [number, number];
  /** Allowed subset of `PICK_GRID_DTES`. */
  dteBand: readonly number[];
}

/** A stock-leg slot inside a base template — direction only; the stock
 *  marks at the underlying close and always resolves (no bands). */
export interface TemplateShapeStockLeg {
  role: string;
  kind: 'stock';
  side: TradeSide;
}

/** A leg slot inside a base template — kind-discriminated, mirroring
 *  `VariantLeg`: an option leg ALWAYS has bands, a stock leg NEVER does. */
export type TemplateShapeLeg = TemplateShapeOptionLeg | TemplateShapeStockLeg;

/** A base template — a reusable multi-leg shape without concrete Δ/DTE. */
export interface TemplateShape {
  /** Stable id, e.g. 'put-credit-spread'. */
  id: string;
  /** Display name, e.g. 'Put credit spread'. */
  name: string;
  description: string;
  structure: TemplateStructure;
  legs: readonly TemplateShapeLeg[];
}

const FULL_DTE_BAND: readonly number[] = PICK_GRID_DTES;
const FULL_DELTA_BAND: readonly [number, number] = PICK_GRID_DELTA_BAND;

/** DTE menu subsets — catalog band "30–60" means {30,45,60}, etc. */
const DTE_30_45: readonly number[] = [30, 45];
const DTE_30_60: readonly number[] = [30, 45, 60];
const DTE_NEAR: readonly number[] = [7, 14, 21, 30];
const DTE_FAR: readonly number[] = [45, 60, 90, 120];
const DTE_LEAP: readonly number[] = [180, 365];

function optionLeg(
  role: string,
  type: OptionType,
  side: TradeSide,
  deltaBand: readonly [number, number],
  dteBand: readonly number[],
): TemplateShapeOptionLeg {
  return { role, kind: 'option', type, side, deltaBand, dteBand };
}

function stockLeg(side: TradeSide): TemplateShapeStockLeg {
  return { role: 'stock', kind: 'stock', side };
}

/**
 * Base-template registry — the catalog's template *shapes* (leg roles with
 * delta/DTE bands). Credit/debit character derives from leg sides + delta
 * ordering (verticals) or expiry ordering (calendars/diagonals); shapes
 * carry no strikes — selection resolves contracts at run time.
 */
export const REPLAY_TEMPLATE_SHAPES: readonly TemplateShape[] = [
  // ── Single-leg family ────────────────────────────────────────────────
  {
    id: 'short-put',
    name: 'Short put (CSP)',
    description: 'One short put — the cash-secured-put ladder shape.',
    structure: 'single',
    legs: [optionLeg('short', OptionType.PUT, TradeSide.SHORT, [15, 35], DTE_30_45)],
  },
  {
    id: 'long-call',
    name: 'Long call',
    description: 'One long call — full grid; a LEAP is just a far point on it.',
    structure: 'single',
    legs: [optionLeg('long', OptionType.CALL, TradeSide.LONG, FULL_DELTA_BAND, FULL_DTE_BAND)],
  },
  {
    id: 'long-put',
    name: 'Long put',
    description: 'One long put — full grid; symmetric counterpart to long call.',
    structure: 'single',
    legs: [optionLeg('long', OptionType.PUT, TradeSide.LONG, FULL_DELTA_BAND, FULL_DTE_BAND)],
  },
  {
    id: 'short-call',
    name: 'Short call',
    description: 'One short call — naked; flagged for the deferred live-blocking mechanism.',
    structure: 'single',
    legs: [optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 30], DTE_30_45)],
  },

  // ── Vertical family — same option type, same expiry ──────────────────
  // Credit/debit derives from delta ordering: shorting the higher-|Δ| leg
  // is credit, longing it is debit.
  {
    id: 'put-credit-spread',
    name: 'Put credit spread',
    description: 'Short high-Δ put + long low-Δ put (bull put) — credit by delta ordering.',
    structure: 'vertical-credit',
    legs: [
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [15, 35], DTE_30_60),
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [5, 15], DTE_30_60),
    ],
  },
  {
    id: 'call-credit-spread',
    name: 'Call credit spread',
    description: 'Short high-Δ call + long low-Δ call (bear call) — credit by delta ordering.',
    structure: 'vertical-credit',
    legs: [
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 35], DTE_30_60),
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [5, 15], DTE_30_60),
    ],
  },
  {
    id: 'put-debit-spread',
    name: 'Put debit spread',
    description: 'Long high-Δ put + short low-Δ put — debit by delta ordering.',
    structure: 'vertical-debit',
    legs: [
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [30, 50], DTE_30_60),
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [10, 20], DTE_30_60),
    ],
  },
  {
    id: 'call-debit-spread',
    name: 'Call debit spread',
    description: 'Long high-Δ call + short low-Δ call — debit by delta ordering.',
    structure: 'vertical-debit',
    legs: [
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [30, 50], DTE_30_60),
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [10, 20], DTE_30_60),
    ],
  },

  // ── Condor family — 4 legs, one expiry ───────────────────────────────
  {
    id: 'iron-condor',
    name: 'Iron condor',
    description: 'Put credit spread + call credit spread — all-credit, two wings per side.',
    structure: 'iron-condor',
    legs: [
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [15, 25], DTE_30_45),
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [5, 10], DTE_30_45),
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 25], DTE_30_45),
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [5, 10], DTE_30_45),
    ],
  },
  {
    id: 'iron-butterfly',
    name: 'Iron butterfly',
    description: 'Short ~50Δ call + short ~50Δ put centered, long wings — all-credit.',
    structure: 'iron-butterfly',
    legs: [
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [45, 55], DTE_30_45),
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [45, 55], DTE_30_45),
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [15, 25], DTE_30_45),
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [15, 25], DTE_30_45),
    ],
  },

  // ── Calendar/diagonal family — different expiry per leg ──────────────
  // Debit structure comes from expiry, not delta ordering: long the far
  // leg, short the near leg.
  {
    id: 'call-calendar',
    name: 'Call calendar',
    description: 'Short near call + long far call at the same Δ — debit by expiry ordering.',
    structure: 'calendar',
    legs: [
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 30], DTE_NEAR),
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [15, 30], DTE_FAR),
    ],
  },
  {
    id: 'put-calendar',
    name: 'Put calendar',
    description: 'Short near put + long far put at the same Δ — debit by expiry ordering.',
    structure: 'calendar',
    legs: [
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [15, 30], DTE_NEAR),
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [15, 30], DTE_FAR),
    ],
  },
  {
    id: 'call-diagonal',
    name: 'Call diagonal',
    description: 'Long deep-Δ far call + short low-Δ near call — "poor man\'s covered call".',
    structure: 'diagonal',
    legs: [
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [60, 80], DTE_LEAP),
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 30], DTE_NEAR),
    ],
  },
  {
    id: 'put-diagonal',
    name: 'Put diagonal',
    description: 'Long deep-Δ far put + short low-Δ near put — the mirrored diagonal.',
    structure: 'diagonal',
    legs: [
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [60, 80], DTE_LEAP),
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [15, 30], DTE_NEAR),
    ],
  },

  // ── Volatility family — both option types, same expiry ───────────────
  {
    id: 'long-straddle',
    name: 'Long straddle',
    description: 'Long call + long put, both ~50Δ — pure-volatility position.',
    structure: 'straddle',
    legs: [
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [45, 55], DTE_30_60),
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [45, 55], DTE_30_60),
    ],
  },
  {
    id: 'long-strangle',
    name: 'Long strangle',
    description: 'Long OTM put + long OTM call — wider, cheaper volatility position.',
    structure: 'strangle',
    legs: [
      optionLeg('long', OptionType.PUT, TradeSide.LONG, [15, 25], DTE_30_60),
      optionLeg('long', OptionType.CALL, TradeSide.LONG, [15, 25], DTE_30_60),
    ],
  },
  {
    id: 'short-strangle',
    name: 'Short strangle',
    description: 'Short OTM put + short OTM call — naked; flagged for the deferred live-blocking mechanism.',
    structure: 'strangle',
    legs: [
      optionLeg('short', OptionType.PUT, TradeSide.SHORT, [15, 25], DTE_30_60),
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 25], DTE_30_60),
    ],
  },

  // ── Hybrid family — stock + option legs ──────────────────────────────
  {
    id: 'covered-call',
    name: 'Covered call',
    description: 'Long stock + short call — the stock leg marks at the underlying close and always resolves.',
    structure: 'covered-call',
    legs: [
      stockLeg(TradeSide.LONG),
      optionLeg('short', OptionType.CALL, TradeSide.SHORT, [15, 35], DTE_30_45),
    ],
  },
];

// ==========================
// Named variants
// ==========================

/**
 * Concrete named-variant registry — paste-ready JSON is the persistence
 * story; registry stays code-curated (no Firestore collection). Seeded
 * with the four legacy templates migrated verbatim as 1-leg variants;
 * the thread catalog's multi-leg variants land with #1495.
 */
export const REPLAY_VARIANTS: readonly ReplayVariant[] = [
  {
    id: 'csp-45-20',
    name: '45DTE 20Δ put (CSP)',
    description: 'Sell one 45DTE 20-delta put each trading day — cash-secured-put ladder.',
    structure: 'short-put',
    legs: [
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT },
    ],
  },
  {
    id: 'csp-30-30',
    name: '30DTE 30Δ put (CSP)',
    description: 'Sell one 30DTE 30-delta put each trading day — closer cash-secured-put ladder.',
    structure: 'short-put',
    legs: [
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.3, dte: 30, side: TradeSide.SHORT },
    ],
  },
  {
    id: 'lc-30-20',
    name: '30DTE 20Δ call (LC)',
    description: 'Buy one 30DTE 20-delta call each trading day — long-call ladder.',
    structure: 'long-call',
    legs: [
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.2, dte: 30, side: TradeSide.LONG },
    ],
  },
  {
    id: 'lc-45-15',
    name: '45DTE 15Δ call (LC)',
    description: 'Buy one 45DTE 15-delta call each trading day — long-call ladder.',
    structure: 'long-call',
    legs: [
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.15, dte: 45, side: TradeSide.LONG },
    ],
  },
];

// Freeze the curated registries — type-level `readonly` stops compile-time
// mutation only; `Object.freeze` closes the runtime path too, so an
// importer mutating `legs[0].targetDelta` can't rewrite every consumer's
// view of a shared recipe.
for (const s of REPLAY_TEMPLATE_SHAPES) {
  Object.freeze(s.legs);
  s.legs.forEach((l) => {
    if (l.kind === 'option') {
      Object.freeze(l.deltaBand);
      Object.freeze(l.dteBand);
    }
    Object.freeze(l);
  });
}
for (const v of REPLAY_VARIANTS) {
  Object.freeze(v.legs);
  v.legs.forEach((l) => Object.freeze(l));
}

/** Look up a named variant by id; undefined on miss. */
export function getReplayVariant(id: string): ReplayVariant | undefined {
  return REPLAY_VARIANTS.find((v) => v.id === id);
}

/** Look up a base template shape by id; undefined on miss. */
export function getTemplateShape(id: string): TemplateShape | undefined {
  return REPLAY_TEMPLATE_SHAPES.find((s) => s.id === id);
}

// ==========================
// Legacy read surface (delegating shim)
// ==========================

/**
 * Adapt a variant to the legacy `ReplayTemplate` shape — defined only for
 * variants that are exactly one option leg, since a `ReplayTemplate` is a
 * single coordinate + side. Multi-leg variants and stock-only variants
 * have no legacy form — they silently drop off `REPLAY_TEMPLATES`, which
 * is correct: no single coordinate exists to represent them.
 */
function variantToReplayTemplate(variant: ReplayVariant): ReplayTemplate | undefined {
  if (variant.legs.length !== 1) return undefined;
  const leg = variant.legs[0];
  if (leg.kind !== 'option') return undefined;
  return {
    id: variant.id,
    name: variant.name,
    description: variant.description,
    side: leg.side,
    coordinate: legToPickDocCoordinate(leg),
  };
}

/**
 * Legacy registry surface — derived from `REPLAY_VARIANTS`, not a
 * hand-curated list, so the v1 picker and `optionsReplayStart` templateId
 * validation keep working verbatim until the builder dialog lands (#1507).
 */
export const REPLAY_TEMPLATES: readonly ReplayTemplate[] = REPLAY_VARIANTS.map(
  variantToReplayTemplate,
).filter((t): t is ReplayTemplate => t !== undefined);

/** Look up a template by id; undefined on miss. */
export function getReplayTemplate(id: string): ReplayTemplate | undefined {
  return REPLAY_TEMPLATES.find((t) => t.id === id);
}
