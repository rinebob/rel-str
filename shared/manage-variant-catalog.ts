/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1541 — SHARED: Variant catalog module (seed registry + loaders)
 *
 * Manage-domain template/variant registry (see CONTEXT.md — Manage
 * Template / Manage Variant). Code-curated, imported directly by FE
 * (Create New Instance pickers) and BE (instance-create variant
 * resolution) — no listing callable. Mirrors the external JSON artifact
 * 1:1: when the bulk-authored catalog lands it replaces these seed
 * entries without a shape change.
 *
 * Same precedent as `options-replay-templates.ts` — a `.ts` registry
 * over raw JSON for typing + unit tests.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import type {
  ManageTemplate,
  ManageVariant,
} from './manage-variant-contracts';

/**
 * `templateId` value for ad hoc variants composed freeform (Create New
 * Strategy without picking a template). Sentinel, like
 * `MANAGE_ADHOC_VARIANT_REF` on the instance side: it NEVER resolves via
 * `getManageTemplate` — callers resolving `variant.templateId` must check
 * for this value first.
 */
export const MANAGE_CUSTOM_TEMPLATE_ID = 'custom';

// ==========================
// Template registry (shape)
// ==========================

/**
 * Seeded Manage Templates — spread shapes (leg roles + Δ/DTE bands).
 * Bands are per-leg authoring bounds, NOT the spread-classification rule:
 * debit/credit character comes from cross-leg delta ordering — e.g., a
 * call debit spread requires |Δ|long > |Δ|short, and bands may overlap
 * (0.35–0.45 here). Variant authors (external artifact, Create New
 * Strategy) must preserve the template's ordering semantics; the seeded
 * specs assert it for the entries below.
 */
export const MANAGE_TEMPLATES: readonly ManageTemplate[] = [
  {
    id: 'cds',
    name: 'Call Debit Spread',
    code: 'CDS',
    legs: [
      {
        kind: 'option',
        role: 'long',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        deltaMin: 0.35,
        deltaMax: 0.55,
        dteMin: 25,
        dteMax: 45,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        deltaMin: 0.25,
        deltaMax: 0.45,
        dteMin: 25,
        dteMax: 45,
      },
    ],
  },
];

// ==========================
// Variant registry (concrete)
// ==========================

/**
 * Seeded Manage Variants — concrete per-leg Δ/DTE bound to a template,
 * named per the PRD's convention ('call debit spread {Δlong}-{Δshort}
 * {dte}'). Leg order follows the template's leg order (long-then-short)
 * so the instance ID's ΔLEGS segment enumerates deterministically.
 */
export const MANAGE_VARIANTS: readonly ManageVariant[] = [
  {
    id: 'cds-30-50-40',
    name: 'call debit spread 50-40 30',
    templateId: 'cds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.5,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.4,
        dte: 30,
      },
    ],
  },
  {
    id: 'cds-45-40-30',
    name: 'call debit spread 40-30 45',
    templateId: 'cds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.4,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.3,
        dte: 45,
      },
    ],
  },
];

// Freeze the curated registries — type-level `readonly` stops compile-time
// mutation only; `Object.freeze` closes the runtime path too, so an
// importer mutating `legs[0].targetDelta` can't rewrite every consumer's
// view of a shared recipe (BE embeds variant snapshots into instances).
// Same precedent as options-replay-templates.ts.
for (const t of MANAGE_TEMPLATES) {
  Object.freeze(t.legs);
  t.legs.forEach((l) => Object.freeze(l));
  Object.freeze(t);
}
for (const v of MANAGE_VARIANTS) {
  Object.freeze(v.legs);
  v.legs.forEach((l) => Object.freeze(l));
  Object.freeze(v);
}
// The outer arrays too — otherwise an importer can still push()
// unvetted entries that every consumer then reads as curated seeds.
Object.freeze(MANAGE_TEMPLATES);
Object.freeze(MANAGE_VARIANTS);

// ==========================
// Lookups
// ==========================

/** Look up a Manage Template by id; undefined on miss (never 'custom'). */
export function getManageTemplate(id: string): ManageTemplate | undefined {
  return MANAGE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Look up a Manage Template by its ALL-CAPS `code` — the segment the
 * instance ID's SPREAD position carries (#1542 resolves template-from-ID
 * through this, not by id).
 */
export function getManageTemplateByCode(
  code: string,
): ManageTemplate | undefined {
  return MANAGE_TEMPLATES.find((t) => t.code === code);
}

/** Look up a Manage Variant by registry id; undefined on miss. */
export function getManageVariant(id: string): ManageVariant | undefined {
  return MANAGE_VARIANTS.find((v) => v.id === id);
}

// ==========================
// Conformance
// ==========================

/**
 * Whether a variant's concrete legs satisfy a template's slots
 * positionally: same leg count, matching `kind`, and for option legs
 * matching `type`/`side` with `targetDelta`/`dte` inside the slot's
 * bands. The single implementation the spec, verify script, and BE
 * instance-create path share — do not reimplement.
 *
 * `= variantMatchesTemplateShape + band membership`. The two layers are
 * deliberately separable: shape is identity (the ID generator gates on
 * it so a `CDS` SPREAD code can't mislabel a put spread), while bands
 * are authoring policy — seed curation here, Create-dialog/BE validation
 * upstream — that ad hoc variants composed from a template may exceed.
 *
 * Two documented gaps by design:
 *  - Does NOT validate the denormalized `variant.dte` against the legs
 *    (the ID's {DTE} segment could disagree with every leg). #1542
 *    derives/validates it — see ManageVariant.dte.
 *  - Does NOT check `variant.templateId === template.id` — the caller
 *    resolves the template via `variant.templateId` first.
 * Spread character (debit/credit ordering) is a template-level semantic
 * the model can't yet see — a band-passing variant can still invert a
 * debit spread's delta ordering (see the MANAGE_TEMPLATES doc note).
 * Tightening that needs a machine-readable structure field — deferred
 * to the artifact-schema workstream.
 */
export function variantMatchesTemplate(
  variant: ManageVariant,
  template: ManageTemplate,
): boolean {
  if (!variantMatchesTemplateShape(variant, template)) return false;
  return variant.legs.every((leg, i) => {
    const slot = template.legs[i];
    if (slot.kind === 'option' && leg.kind === 'option') {
      return (
        leg.targetDelta >= slot.deltaMin &&
        leg.targetDelta <= slot.deltaMax &&
        leg.dte >= slot.dteMin &&
        leg.dte <= slot.dteMax
      );
    }
    return true;
  });
}

/**
 * Positional STRUCTURE conformance — leg count, `kind`, option-leg
 * `type`/`side` — with NO band checks. This is what the instance-ID
 * generator gates on: the `SPREAD` code names the shape, so legs must
 * match it positionally, but delta/DTE bands are authoring policy (seed
 * curation + the Create-dialog/BE validation), not identity — an
 * out-of-band ad hoc variant under a named template still mints a
 * unique, truthful id.
 */
export function variantMatchesTemplateShape(
  variant: ManageVariant,
  template: ManageTemplate,
): boolean {
  if (!Array.isArray(variant.legs)) return false;
  if (variant.legs.length !== template.legs.length) return false;
  return variant.legs.every((leg, i) => {
    const slot = template.legs[i];
    if (leg.kind !== slot.kind) return false;
    if (slot.kind === 'option' && leg.kind === 'option') {
      return leg.type === slot.type && leg.side === slot.side;
    }
    return leg.side === slot.side;
  });
}
