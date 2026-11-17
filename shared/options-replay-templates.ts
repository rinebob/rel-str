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
 *
 * `validateVariantRegistry()` (#1494) is the registry drift guard — it
 * checks the curated data (id uniqueness, per-kind fields, grid/band
 * membership, sign-vs-type parity, no duplicate legs) and runs in the
 * shared spec, so a malformed edit fails the suite, not a live run.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import {
  legToPickDocCoordinate,
  PICK_GRID_DELTA_BAND,
  PICK_GRID_DELTA_STEP,
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
/** Runtime member list — `TemplateStructure` derives from this so the
 *  registry validator (#1494) can check a shape's structure literally,
 *  and adding a union member without updating the list (or vice versa)
 *  is impossible. */
const TEMPLATE_STRUCTURES = [
  'single',
  'vertical-credit',
  'vertical-debit',
  'iron-condor',
  'iron-butterfly',
  'calendar',
  'diagonal',
  'straddle',
  'strangle',
  'covered-call',
  'custom',
] as const;

export type TemplateStructure = (typeof TEMPLATE_STRUCTURES)[number];

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
// Registry validator (#1494)
// ==========================

function legWhere(owner: string, i: number): string {
  return `${owner} leg ${i}`;
}

/** |Δ| percent — e.g. -0.20 → 20. Rounding matches the wire derivation
 *  (`pickDocDeltaPct`): a leg whose |Δ|×100 rounds to a grid cell resolves
 *  to that cell, so round-then-check is the *correct* on-grid test, not a
 *  lax one. */
function deltaMagnitude(targetDelta: number): number {
  return Math.round(Math.abs(targetDelta) * 100);
}

function isOnGridDelta(targetDelta: number): boolean {
  const mag = deltaMagnitude(targetDelta);
  return (
    mag % PICK_GRID_DELTA_STEP === 0 &&
    mag >= PICK_GRID_DELTA_BAND[0] &&
    mag <= PICK_GRID_DELTA_BAND[1]
  );
}

/** Field-presence + grid checks for one concrete variant leg. `unknown`
 *  because malformed data is the entire point of the check. */
function validateVariantLeg(leg: unknown, where: string, errs: string[]): void {
  if (leg == null || typeof leg !== 'object') {
    errs.push(`${where}: leg is not an object`);
    return;
  }
  const l = leg as unknown as Record<string, unknown>;
  if (typeof l.side !== 'string' || !Object.values(TradeSide).includes(l.side as TradeSide)) {
    errs.push(`${where}: invalid side ${String(l.side)}`);
  }
  if (l.kind === 'stock') {
    for (const f of ['type', 'targetDelta', 'dte', 'role', 'deltaBand', 'dteBand'] as const) {
      if (f in l) errs.push(`${where}: stock leg carries option/shape field '${f}'`);
    }
    return;
  }
  if (l.kind !== 'option') {
    errs.push(`${where}: unknown kind ${String(l.kind)}`);
    return;
  }
  if (l.type !== OptionType.PUT && l.type !== OptionType.CALL) {
    errs.push(`${where}: invalid option type ${String(l.type)}`);
  }
  if (typeof l.targetDelta !== 'number' || !Number.isFinite(l.targetDelta)) {
    errs.push(`${where}: missing/invalid targetDelta`);
  } else {
    if (!isOnGridDelta(l.targetDelta)) {
      errs.push(
        `${where}: targetDelta ${l.targetDelta} is off-grid (rounds to ` +
          `${deltaMagnitude(l.targetDelta)}; |Δ| must be a ` +
          `${PICK_GRID_DELTA_STEP}-step multiple in ` +
          `[${PICK_GRID_DELTA_BAND[0]}, ${PICK_GRID_DELTA_BAND[1]}])`,
      );
    }
    // Sign-vs-type parity: puts carry negative Δ, calls positive.
    if (l.type === OptionType.PUT && l.targetDelta >= 0) {
      errs.push(`${where}: put leg has non-negative targetDelta ${l.targetDelta}`);
    }
    if (l.type === OptionType.CALL && l.targetDelta <= 0) {
      errs.push(`${where}: call leg has non-positive targetDelta ${l.targetDelta}`);
    }
  }
  if (typeof l.dte !== 'number' || !Number.isInteger(l.dte)) {
    errs.push(`${where}: missing/invalid dte ${String(l.dte)}`);
  } else if (!PICK_GRID_DTES.includes(l.dte)) {
    errs.push(`${where}: dte ${l.dte} is not on the pick-grid menu`);
  }
  // Shape-domain fields on a concrete leg — a pasted TemplateShapeLeg.
  for (const f of ['role', 'deltaBand', 'dteBand'] as const) {
    if (f in l) errs.push(`${where}: option leg carries shape field '${f}'`);
  }
}

/** Structural checks for one shape leg slot — bands, never values. */
function validateShapeLeg(leg: unknown, where: string, errs: string[]): void {
  if (leg == null || typeof leg !== 'object') {
    errs.push(`${where}: leg is not an object`);
    return;
  }
  const l = leg as unknown as Record<string, unknown>;
  if (typeof l.role !== 'string' || l.role.length === 0) {
    errs.push(`${where}: missing role`);
  }
  if (typeof l.side !== 'string' || !Object.values(TradeSide).includes(l.side as TradeSide)) {
    errs.push(`${where}: invalid side ${String(l.side)}`);
  }
  for (const f of ['targetDelta', 'dte'] as const) {
    if (f in l) {
      errs.push(`${where}: shape leg carries concrete '${f}' — shapes hold bands only`);
    }
  }
  if (l.kind === 'stock') {
    for (const f of ['type', 'deltaBand', 'dteBand'] as const) {
      if (f in l) errs.push(`${where}: stock leg carries option field '${f}'`);
    }
    return;
  }
  if (l.kind !== 'option') {
    errs.push(`${where}: unknown kind ${String(l.kind)}`);
    return;
  }
  if (l.type !== OptionType.PUT && l.type !== OptionType.CALL) {
    errs.push(`${where}: invalid option type ${String(l.type)}`);
  }
  const band = l.deltaBand;
  if (!Array.isArray(band) || band.length !== 2) {
    errs.push(`${where}: deltaBand must be a [lo, hi] pair`);
  } else {
    const [lo, hi] = band as number[];
    for (const bound of [lo, hi]) {
      if (
        typeof bound !== 'number' ||
        bound % PICK_GRID_DELTA_STEP !== 0 ||
        bound < PICK_GRID_DELTA_BAND[0] ||
        bound > PICK_GRID_DELTA_BAND[1]
      ) {
        errs.push(`${where}: deltaBand bound ${String(bound)} is off-grid`);
      }
    }
    if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) {
      errs.push(`${where}: deltaBand lo ${lo} exceeds hi ${hi}`);
    }
  }
  const dtes = l.dteBand;
  if (!Array.isArray(dtes) || dtes.length === 0) {
    errs.push(`${where}: dteBand must be a non-empty subset of the pick-grid menu`);
  } else {
    for (const d of dtes as number[]) {
      if (!PICK_GRID_DTES.includes(d)) {
        errs.push(`${where}: dteBand value ${String(d)} is not on the pick-grid menu`);
      }
    }
    if (new Set(dtes).size !== dtes.length) {
      errs.push(`${where}: dteBand contains duplicates`);
    }
  }
}

/** Duplicate-leg key within one variant — same pick + same side. Non-option
 *  kinds key on their actual kind so a malformed `{kind:'future'}` can't
 *  alias a real stock leg into a misleading "duplicate" violation. */
function variantLegKey(leg: unknown): string | undefined {
  const l = leg as unknown as Record<string, unknown> | null;
  if (l == null || typeof l !== 'object') return undefined;
  return `${String(l.kind)}|${String(l.type)}|${String(l.targetDelta)}|${String(l.dte)}|${String(l.side)}`;
}

/**
 * Registry drift guard (IMPL-SHARED §4). Validates the shipped registries
 * — or injected ones for tests — and returns one actionable message per
 * violation; empty when clean. The shared spec calls this against the real
 * `REPLAY_TEMPLATE_SHAPES`/`REPLAY_VARIANTS`, so a malformed registry edit
 * fails the test suite instead of a live run.
 *
 * Classes: duplicate ids (across shapes AND variants), missing/empty
 * display fields, missing legs, per-kind required/forbidden fields,
 * off-grid Δ/DTE (variants) or bands (shapes), sign-vs-type parity,
 * `structure` referential integrity (a shape's structure must be a
 * TemplateStructure member; a variant's must resolve to a shape id or be
 * 'custom'/absent), and duplicate legs within a variant.
 * Structural only — a stock-only or same-coordinate both-sides variant is
 * legal; the BE doesn't police whether a combo is a "real" spread.
 */
export function validateVariantRegistry(
  shapes: readonly TemplateShape[] = REPLAY_TEMPLATE_SHAPES,
  variants: readonly ReplayVariant[] = REPLAY_VARIANTS,
): string[] {
  const errs: string[] = [];
  if (!Array.isArray(shapes)) errs.push('shapes argument is not an array');
  if (!Array.isArray(variants)) errs.push('variants argument is not an array');
  const shapeList: readonly TemplateShape[] = Array.isArray(shapes) ? shapes : [];
  const variantList: readonly ReplayVariant[] = Array.isArray(variants) ? variants : [];

  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const displayFields = (kind: string, id: unknown, e: { name?: unknown; description?: unknown }): void => {
    if (!nonEmpty(e?.name)) errs.push(`${kind} '${String(id)}': missing/empty name`);
    if (!nonEmpty(e?.description)) errs.push(`${kind} '${String(id)}': missing/empty description`);
  };

  // Unique ids across both registries — one shared namespace.
  const idOwners = new Map<string, string>();
  const claimId = (kind: string, id: unknown, index: number): void => {
    if (!nonEmpty(id)) {
      errs.push(`${kind}[${index}] has a missing/empty id`);
      return;
    }
    const prior = idOwners.get(id);
    if (prior !== undefined) {
      errs.push(`duplicate id '${id}' (${prior} + ${kind}[${index}])`);
    } else {
      idOwners.set(id, `${kind}[${index}]`);
    }
  };

  for (const [si, s] of shapeList.entries()) {
    const owner = `shape '${s?.id}'`;
    claimId('shape', s?.id, si);
    displayFields('shape', s?.id, s ?? {});
    if (
      typeof s?.structure !== 'string' ||
      !(TEMPLATE_STRUCTURES as readonly string[]).includes(s.structure)
    ) {
      errs.push(`${owner}: structure ${String(s?.structure)} is not a TemplateStructure`);
    }
    if (!Array.isArray(s?.legs) || s.legs.length === 0) {
      errs.push(`${owner}: must declare ≥1 leg`);
      continue;
    }
    s.legs.forEach((leg, i) => validateShapeLeg(leg, legWhere(owner, i), errs));
  }

  // Variant `structure` is a provenance hint pointing at a shape id — a
  // typo'd id is a data bug (the spec treats it as FAIL-worthy), not an
  // ignorable annotation.
  const shapeIds = new Set(idOwners.keys());
  for (const [vi, v] of variantList.entries()) {
    const owner = `variant '${v?.id}'`;
    claimId('variant', v?.id, vi);
    displayFields('variant', v?.id, v ?? {});
    if (
      v?.structure !== undefined &&
      v.structure !== 'custom' &&
      (typeof v.structure !== 'string' || !shapeIds.has(v.structure))
    ) {
      errs.push(`${owner}: structure '${String(v.structure)}' resolves to no shape`);
    }
    if (!Array.isArray(v?.legs) || v.legs.length === 0) {
      errs.push(`${owner}: must declare ≥1 leg`);
      continue;
    }
    v.legs.forEach((leg, i) => validateVariantLeg(leg, legWhere(owner, i), errs));
    const seen = new Map<string, number>();
    v.legs.forEach((leg, i) => {
      const key = variantLegKey(leg);
      if (key === undefined) return;
      const prior = seen.get(key);
      if (prior !== undefined) {
        errs.push(`${legWhere(owner, i)}: duplicate of leg ${prior}`);
      } else {
        seen.set(key, i);
      }
    });
  }

  return errs;
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
