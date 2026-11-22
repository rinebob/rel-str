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
import type { OptionLeg } from './options-replay-contracts';

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
 * Seeded Manage Templates — spread shapes (leg roles + optional Δ/DTE
 * bands). Bands are per-leg authoring bounds, NOT the
 * spread-classification rule: debit/credit character comes from
 * cross-leg delta ordering — a call debit spread requires
 * |Δ|long > |Δ|short, now machine-enforced via the template's
 * `direction` field. Debit templates carry no bands — any
 * |long|>|short| pair is a valid instance of the shape (.9/.8 as much
 * as .2/.1); credit templates typically keep them.
 */
export const MANAGE_TEMPLATES: readonly ManageTemplate[] = [
  {
    id: 'cds',
    name: 'Call Debit Spread',
    code: 'CDS',
    uniformDte: true,
    direction: 'debit',
    legs: [
      {
        kind: 'option',
        role: 'long',
        type: OptionType.CALL,
        side: TradeSide.LONG,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
      },
    ],
  },
  {
    id: 'pds',
    name: 'Put Debit Spread',
    code: 'PDS',
    uniformDte: true,
    direction: 'debit',
    legs: [
      {
        kind: 'option',
        role: 'long',
        type: OptionType.PUT,
        side: TradeSide.LONG,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
      },
    ],
  },
  {
    id: 'ccs',
    name: 'Call Credit Spread',
    code: 'CCS',
    uniformDte: true,
    direction: 'credit',
    legs: [
      {
        kind: 'option',
        role: 'long',
        type: OptionType.CALL,
        side: TradeSide.LONG,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
      },
    ],
  },
  {
    id: 'pcs',
    name: 'Put Credit Spread',
    code: 'PCS',
    uniformDte: true,
    direction: 'credit',
    legs: [
      {
        kind: 'option',
        role: 'long',
        type: OptionType.PUT,
        side: TradeSide.LONG,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
      },
    ],
  },
  {
    id: 'ns',
    name: 'Naked Strangle',
    code: 'NS',
    uniformDte: true,
    // No direction — both legs are shorts; there is no long/short pair
    // to order. |Δ|s are unconstrained beyond (0,1].
    legs: [
      {
        kind: 'option',
        role: 'short',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
      },
    ],
  },
  {
    id: 'ic',
    name: 'Iron Condor',
    code: 'IC',
    uniformDte: true,
    direction: 'credit',
    // Wing→body→body→wing: the ΔLEGS segment reads outer-to-inner
    // (e.g. ic-30-10-20-20-10). Global 'credit' holds — every body
    // short is strictly closer to the money than every wing long, so
    // min(|shorts|) > max(|longs|) is the IC definition itself.
    legs: [
      {
        kind: 'option',
        role: 'long',
        type: OptionType.PUT,
        side: TradeSide.LONG,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
      },
      {
        kind: 'option',
        role: 'short',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
      },
      {
        kind: 'option',
        role: 'long',
        type: OptionType.CALL,
        side: TradeSide.LONG,
      },
    ],
  },
];

// ==========================
// Variant registry (concrete)
// ==========================

/**
 * Seeded Manage Variants — concrete per-leg Δ/DTE bound to a template,
 * named per the convention '{name} {dte} {Δlong}-{Δshort}' ('call debit
 * spread 30 50-40') — the same dte-first segment order as the variant
 * and instance ids. Leg order follows the template's leg order
 * (long-then-short) so the instance ID's ΔLEGS segment enumerates
 * deterministically.
 */
export const MANAGE_VARIANTS: readonly ManageVariant[] = [
  {
    id: 'cds-30-50-40',
    name: 'call debit spread 30 50-40',
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
    name: 'call debit spread 45 40-30',
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
  {
    id: 'cds-30-40-30',
    name: 'call debit spread 30 40-30',
    templateId: 'cds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.4,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.3,
        dte: 30,
      },
    ],
  },
  {
    id: 'cds-30-60-50',
    name: 'call debit spread 30 60-50',
    templateId: 'cds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.6,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.5,
        dte: 30,
      },
    ],
  },
  {
    id: 'cds-30-70-60',
    name: 'call debit spread 30 70-60',
    templateId: 'cds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.7,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.6,
        dte: 30,
      },
    ],
  },
  {
    id: 'cds-45-50-40',
    name: 'call debit spread 45 50-40',
    templateId: 'cds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.5,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.4,
        dte: 45,
      },
    ],
  },
  {
    id: 'cds-45-60-50',
    name: 'call debit spread 45 60-50',
    templateId: 'cds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.6,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.5,
        dte: 45,
      },
    ],
  },
  {
    id: 'cds-45-70-60',
    name: 'call debit spread 45 70-60',
    templateId: 'cds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.7,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.6,
        dte: 45,
      },
    ],
  },
  {
    id: 'pds-30-40-30',
    name: 'put debit spread 30 40-30',
    templateId: 'pds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.4,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.3,
        dte: 30,
      },
    ],
  },
  {
    id: 'pds-30-50-40',
    name: 'put debit spread 30 50-40',
    templateId: 'pds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.5,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.4,
        dte: 30,
      },
    ],
  },
  {
    id: 'pds-30-60-50',
    name: 'put debit spread 30 60-50',
    templateId: 'pds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.6,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.5,
        dte: 30,
      },
    ],
  },
  {
    id: 'pds-30-70-60',
    name: 'put debit spread 30 70-60',
    templateId: 'pds',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.7,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.6,
        dte: 30,
      },
    ],
  },
  {
    id: 'pds-45-40-30',
    name: 'put debit spread 45 40-30',
    templateId: 'pds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.4,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.3,
        dte: 45,
      },
    ],
  },
  {
    id: 'pds-45-50-40',
    name: 'put debit spread 45 50-40',
    templateId: 'pds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.5,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.4,
        dte: 45,
      },
    ],
  },
  {
    id: 'pds-45-60-50',
    name: 'put debit spread 45 60-50',
    templateId: 'pds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.6,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.5,
        dte: 45,
      },
    ],
  },
  {
    id: 'pds-45-70-60',
    name: 'put debit spread 45 70-60',
    templateId: 'pds',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.7,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.6,
        dte: 45,
      },
    ],
  },
  {
    id: 'ccs-30-10-20',
    name: 'call credit spread 30 10-20',
    templateId: 'ccs',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.1,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dte: 30,
      },
    ],
  },
  {
    id: 'ccs-30-15-25',
    name: 'call credit spread 30 15-25',
    templateId: 'ccs',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.15,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.25,
        dte: 30,
      },
    ],
  },
  {
    id: 'ccs-30-20-30',
    name: 'call credit spread 30 20-30',
    templateId: 'ccs',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.2,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.3,
        dte: 30,
      },
    ],
  },
  {
    id: 'ccs-45-10-20',
    name: 'call credit spread 45 10-20',
    templateId: 'ccs',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.1,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dte: 45,
      },
    ],
  },
  {
    id: 'ccs-45-15-25',
    name: 'call credit spread 45 15-25',
    templateId: 'ccs',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.15,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.25,
        dte: 45,
      },
    ],
  },
  {
    id: 'ccs-45-20-30',
    name: 'call credit spread 45 20-30',
    templateId: 'ccs',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.2,
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
  {
    id: 'pcs-30-10-20',
    name: 'put credit spread 30 10-20',
    templateId: 'pcs',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.1,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.2,
        dte: 30,
      },
    ],
  },
  {
    id: 'pcs-30-15-25',
    name: 'put credit spread 30 15-25',
    templateId: 'pcs',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.15,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.25,
        dte: 30,
      },
    ],
  },
  {
    id: 'pcs-30-20-30',
    name: 'put credit spread 30 20-30',
    templateId: 'pcs',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.2,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.3,
        dte: 30,
      },
    ],
  },
  {
    id: 'pcs-45-10-20',
    name: 'put credit spread 45 10-20',
    templateId: 'pcs',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.1,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.2,
        dte: 45,
      },
    ],
  },
  {
    id: 'pcs-45-15-25',
    name: 'put credit spread 45 15-25',
    templateId: 'pcs',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.15,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.25,
        dte: 45,
      },
    ],
  },
  {
    id: 'pcs-45-20-30',
    name: 'put credit spread 45 20-30',
    templateId: 'pcs',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.2,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.3,
        dte: 45,
      },
    ],
  },
  {
    id: 'ns-30-15-15',
    name: 'naked strangle 30 15-15',
    templateId: 'ns',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.15,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.15,
        dte: 30,
      },
    ],
  },
  {
    id: 'ns-30-20-20',
    name: 'naked strangle 30 20-20',
    templateId: 'ns',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.2,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dte: 30,
      },
    ],
  },
  {
    id: 'ns-30-25-25',
    name: 'naked strangle 30 25-25',
    templateId: 'ns',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.25,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.25,
        dte: 30,
      },
    ],
  },
  {
    id: 'ns-45-15-15',
    name: 'naked strangle 45 15-15',
    templateId: 'ns',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.15,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.15,
        dte: 45,
      },
    ],
  },
  {
    id: 'ns-45-20-20',
    name: 'naked strangle 45 20-20',
    templateId: 'ns',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.2,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dte: 45,
      },
    ],
  },
  {
    id: 'ns-45-25-25',
    name: 'naked strangle 45 25-25',
    templateId: 'ns',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.25,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.25,
        dte: 45,
      },
    ],
  },
  {
    id: 'ic-30-5-15-15-5',
    name: 'iron condor 30 5-15-15-5',
    templateId: 'ic',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.05,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.15,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.15,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.05,
        dte: 30,
      },
    ],
  },
  {
    id: 'ic-30-10-20-20-10',
    name: 'iron condor 30 10-20-20-10',
    templateId: 'ic',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.1,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.2,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.1,
        dte: 30,
      },
    ],
  },
  {
    id: 'ic-30-10-25-25-10',
    name: 'iron condor 30 10-25-25-10',
    templateId: 'ic',
    dte: 30,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.1,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.25,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.25,
        dte: 30,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.1,
        dte: 30,
      },
    ],
  },
  {
    id: 'ic-45-5-15-15-5',
    name: 'iron condor 45 5-15-15-5',
    templateId: 'ic',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.05,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.15,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.15,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.05,
        dte: 45,
      },
    ],
  },
  {
    id: 'ic-45-10-20-20-10',
    name: 'iron condor 45 10-20-20-10',
    templateId: 'ic',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.1,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.2,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.1,
        dte: 45,
      },
    ],
  },
  {
    id: 'ic-45-10-25-25-10',
    name: 'iron condor 45 10-25-25-10',
    templateId: 'ic',
    dte: 45,
    legs: [
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.LONG,
        targetDelta: -0.1,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: -0.25,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        targetDelta: 0.25,
        dte: 45,
      },
      {
        kind: 'option',
        type: OptionType.CALL,
        side: TradeSide.LONG,
        targetDelta: 0.1,
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
 * `= variantMatchesTemplateShape + band membership + direction`. The
 * layers are deliberately separable: shape is identity (the ID
 * generator gates on it so a `CDS` SPREAD code can't mislabel a put
 * spread), while bands are optional authoring policy — seed curation
 * here, Create-dialog/BE validation upstream — that ad hoc variants
 * composed from a template may exceed. `direction` is the
 * machine-readable spread character: a credit-ordered variant does not
 * conform to a debit template.
 *
 * Two documented gaps by design:
 *  - Does NOT validate the denormalized `variant.dte` against the legs
 *    (the ID's {DTE} segment could disagree with every leg). #1542
 *    derives/validates it — see ManageVariant.dte.
 *  - Does NOT check `variant.templateId === template.id` — the caller
 *    resolves the template via `variant.templateId` first.
 */
export function variantMatchesTemplate(
  variant: ManageVariant,
  template: ManageTemplate,
): boolean {
  if (!variantMatchesTemplateShape(variant, template)) return false;
  if (!variantDirectionHolds(variant, template.direction)) return false;
  return variant.legs.every((leg, i) => {
    const slot = template.legs[i];
    if (slot.kind === 'option' && leg.kind === 'option') {
      return (
        (slot.deltaMin === undefined || leg.targetDelta >= slot.deltaMin) &&
        (slot.deltaMax === undefined || leg.targetDelta <= slot.deltaMax) &&
        (slot.dteMin === undefined || leg.dte >= slot.dteMin) &&
        (slot.dteMax === undefined || leg.dte <= slot.dteMax)
      );
    }
    return true;
  });
}

/**
 * Spread character: 'debit' requires every long-side |Δ| to exceed
 * every short-side |Δ|; 'credit' the inverse. Absolute values — the
 * rule is identical for calls and puts. `undefined` direction or an
 * empty side (no pair exists) → unconstrained. Shared by
 * `variantMatchesTemplate` and the Create New Strategy dialog — do not
 * reimplement.
 */
export function variantDirectionHolds(
  variant: Pick<ManageVariant, 'legs'>,
  direction: 'debit' | 'credit' | undefined,
): boolean {
  if (!direction) return true;
  const opt = variant.legs.filter(
    (l): l is OptionLeg => l.kind === 'option',
  );
  const absOf = (side: TradeSide) =>
    opt.filter((l) => l.side === side).map((l) => Math.abs(l.targetDelta));
  const longs = absOf(TradeSide.LONG);
  const shorts = absOf(TradeSide.SHORT);
  if (longs.length === 0 || shorts.length === 0) return true;
  return direction === 'debit'
    ? Math.min(...longs) > Math.max(...shorts)
    : Math.min(...shorts) > Math.max(...longs);
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
