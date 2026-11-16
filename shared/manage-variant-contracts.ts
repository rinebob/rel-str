/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1538 — SHARED: Manage instance + variant contracts
 *
 * Manage-domain template/variant contracts for the Strategy Manage page
 * (`options/strategy/manage`). Vocabulary per CONTEXT.md:
 *
 * - **Manage Template** — the spread *shape*: named leg roles carrying
 *   delta/DTE bands plus order side, with no concrete coordinate pinned
 *   (e.g., "call debit spread: long leg 35–55Δ, short leg 25–45Δ, 25–45 DTE").
 * - **Manage Variant** — the concrete instantiation: a template plus a
 *   pinned Δ/DTE per leg, given a descriptive name (e.g., "call debit
 *   spread 50-40 30" = long 50Δ, short 40Δ, 30 DTE).
 *
 * Most variants are authored in bulk outside the app and arrive via the
 * catalog artifact (#1541); ad hoc variants are composed in-app via
 * Create New Strategy and exported to the registry JSON (#1548).
 * Instantiating a variant binds it to symbol + mode + stopType — see
 * `manage-instance-contracts.ts`.
 *
 * Concrete legs reuse the canonical `VariantLeg` union from
 * `options-replay-contracts.ts` (Thread #1270) — one leg model for
 * historical replay and live/paper execution.
 *
 * Pure types; importable by both the Angular frontend and Firebase functions.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import type { VariantLeg } from './options-replay-contracts';

// ==========================
// Canonical-name aliases
// ==========================
//
// The PRD/task AC names these `StrategyTemplate` / `NamedVariant` /
// `VariantLeg`. The `Manage*` names above are the primary exports (CONTEXT.md
// flags "template"/"variant" as overloaded nouns across domains), and
// `VariantLeg` is the canonical concrete-leg union — re-exported here so all
// three AC names resolve from this module.
export type { VariantLeg } from './options-replay-contracts';
/** Alias for {@link ManageTemplate} — the AC/vocabulary name. */
export type StrategyTemplate = ManageTemplate;
/** Alias for {@link ManageVariant} — the AC/vocabulary name. */
export type NamedVariant = ManageVariant;

// ==========================
// Manage Template (shape)
// ==========================

/**
 * An option leg slot in a Manage Template — structure only. The bands bound
 * what a variant may pin; the leg carries no concrete `targetDelta`/`dte`
 * (those live on `OptionLeg` once a variant instantiates the template).
 *
 * Deltas are signed per SA convention (puts negative, calls positive).
 *
 * Note: `TemplateShapeLeg` (the replay domain's banded-leg counterpart,
 * specced for #1492) hasn't landed yet — when it does, these two shape-leg
 * models should converge or document the deliberate divergence.
 */
export interface ManageTemplateOptionLeg {
  kind: 'option';
  /** Role label within the spread, e.g. 'long', 'short', 'wing-lower'. */
  role: string;
  type: OptionType;
  side: TradeSide;
  /** Signed-delta band, e.g. -0.35..-0.15 for a short put leg. */
  deltaMin: number;
  deltaMax: number;
  /** DTE band in calendar days. */
  dteMin: number;
  dteMax: number;
}

/** A stock leg slot — direction only; marks at the underlying close. */
export interface ManageTemplateStockLeg {
  kind: 'stock';
  /** Role label within the structure, e.g. 'shares' for a covered call. */
  role: string;
  side: TradeSide;
}

/** One leg slot of a Manage Template — option slot or stock slot. */
export type ManageTemplateLeg = ManageTemplateOptionLeg | ManageTemplateStockLeg;

/**
 * A spread shape — the "what" with nothing pinned (e.g., call debit spread,
 * iron condor, covered call). `code` is the ALL-CAPS segment used in the
 * manage instance ID's SPREAD position (`QQQ-CDS-…`).
 */
export interface ManageTemplate {
  /** Stable id, e.g. 'cds', 'ic'. */
  id: string;
  /** Display name, e.g. 'Call Debit Spread'. */
  name: string;
  /** ALL-CAPS instance-ID spread segment, e.g. 'CDS', 'IC'. */
  code: string;
  /**
   * Leg slots in template-defined order — the order the ID's ΔLEGS segment
   * enumerates (e.g., CDS long-then-short → '50-40').
   */
  legs: ManageTemplateLeg[];
}

// ==========================
// Manage Variant (concrete)
// ==========================

/**
 * A Manage Template bound to concrete per-leg Δ/DTE — the unit the Create
 * New Instance dialog picks and the instance doc embeds. Leg order follows
 * the template's leg order so the ID's ΔLEGS segment is deterministic.
 */
export interface ManageVariant {
  /**
   * Registry id for catalog variants, e.g. 'cds-30-50-40'. For ad hoc
   * variants never saved to the registry this is a client-generated label —
   * the instance embeds the full snapshot either way.
   */
  id: string;
  /** Descriptive display name, e.g. 'call debit spread 50-40 30'. */
  name: string;
  /**
   * Back-reference to `ManageTemplate.id` the variant was composed from.
   * Ad hoc variants still pick a template in the Create New Strategy
   * dialog — this holds that template's id, or the
   * `MANAGE_CUSTOM_TEMPLATE_ID` sentinel ('custom', in
   * manage-variant-catalog.ts) if ever composed freeform without one.
   * The sentinel never resolves via `getManageTemplate` — callers must
   * check for it before dereferencing.
   */
  templateId: string;
  /**
   * Primary DTE — the instance ID's DTE segment. For same-expiry spreads
   * every option leg carries this value; for calendars/diagonals it is the
   * near leg's DTE. Denormalized: the ID builder (#1542) must derive or
   * validate it against the legs rather than trust both independently.
   */
  dte: number;
  /** Concrete legs — every option leg has Δ/DTE pinned. */
  legs: VariantLeg[];
}
