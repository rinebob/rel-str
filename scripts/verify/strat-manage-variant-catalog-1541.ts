/**
 * Verification: manage variant catalog seed registry + loaders (task #1541).
 *
 * Exercises the catalog through the real `@manage/*` tsconfig alias — a
 * passing run proves alias resolution under tsx plus: seed counts
 * (>=1 template, >=2 variants), unique ids/codes/names, band-only template
 * legs, concrete variant legs, referential integrity (every templateId
 * resolves, `variantMatchesTemplate` holds, 'custom' never resolves),
 * seed delta ordering (debit character — overlapping bands admit inverted
 * variants otherwise), pure-JSON round-trip, and lookup hit/miss/round-
 * trip on both the id and code surfaces.
 *
 * Usage: npx tsx scripts/verify/strat-manage-variant-catalog-1541.ts
 *
 * No credentials, no Firestore — a code-curated registry and pure helpers.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { MANAGE_ADHOC_VARIANT_REF } from '@manage/instance-contracts';
import {
  getManageTemplate,
  getManageTemplateByCode,
  getManageVariant,
  MANAGE_CUSTOM_TEMPLATE_ID,
  MANAGE_TEMPLATES,
  MANAGE_VARIANTS,
  variantDirectionHolds,
  variantMatchesTemplate,
} from '@manage/variant-catalog';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// ── Seed counts + uniqueness ─────────────────────────────────────────
check('MANAGE_CUSTOM_TEMPLATE_ID', MANAGE_CUSTOM_TEMPLATE_ID, 'custom');
check('MANAGE_ADHOC_VARIANT_REF', MANAGE_ADHOC_VARIANT_REF, 'adhoc');
check('templates seeded (>=1)', MANAGE_TEMPLATES.length >= 1, true);
check('variants seeded (>=2)', MANAGE_VARIANTS.length >= 2, true);
check(
  'template ids unique',
  new Set(MANAGE_TEMPLATES.map((t) => t.id)).size,
  MANAGE_TEMPLATES.length,
);
check(
  'template codes unique',
  new Set(MANAGE_TEMPLATES.map((t) => t.code)).size,
  MANAGE_TEMPLATES.length,
);
check(
  'variant ids unique',
  new Set(MANAGE_VARIANTS.map((v) => v.id)).size,
  MANAGE_VARIANTS.length,
);
check(
  'variant names unique',
  new Set(MANAGE_VARIANTS.map((v) => v.name)).size,
  MANAGE_VARIANTS.length,
);
check(
  'template codes are ALL-CAPS letters/digits',
  MANAGE_TEMPLATES.every((t) => /^[A-Z0-9]+$/.test(t.code)),
  true,
);
check(
  'no template code is CUSTOM (reserved for ad hoc variants)',
  MANAGE_TEMPLATES.every((t) => t.code !== 'CUSTOM'),
  true,
);
check(
  'template ids/names non-empty',
  MANAGE_TEMPLATES.every((t) => t.id.length > 0 && t.name.length > 0),
  true,
);
check(
  'option slots: bands well-formed when present (min<=max, dteMin>0)',
  MANAGE_TEMPLATES.every((t) =>
    t.legs.every(
      (l) =>
        l.kind !== 'option' ||
        ((l.deltaMin === undefined ||
          l.deltaMax === undefined ||
          l.deltaMin <= l.deltaMax) &&
          (l.dteMin === undefined ||
            l.dteMax === undefined ||
            l.dteMin <= l.dteMax) &&
          (l.dteMin === undefined || l.dteMin > 0)),
    ),
  ),
  true,
);
check(
  'variant ids disjoint from template ids',
  MANAGE_VARIANTS.every(
    (v) => !MANAGE_TEMPLATES.some((t) => t.id === v.id),
  ),
  true,
);
check(
  'variant ids disjoint from adhoc sentinel',
  MANAGE_VARIANTS.every((v) => v.id !== MANAGE_ADHOC_VARIANT_REF),
  true,
);

// ── Shape: template bands only, variant legs concrete ───────────────
check(
  'template legs carry no pinned targetDelta/dte',
  MANAGE_TEMPLATES.every((t) =>
    t.legs.every(
      (l) => !('targetDelta' in l) && !('dte' in l) && l.role.length > 0,
    ),
  ),
  true,
);
check(
  'variant option legs are concrete (whole-Δ%, int dte>0)',
  MANAGE_VARIANTS.every((v) =>
    v.legs.every(
      (l) =>
        l.kind !== 'option' ||
        (l.targetDelta !== 0 &&
          Math.abs(l.targetDelta) < 1 &&
          Number.isInteger(l.targetDelta * 100) &&
          Number.isInteger(l.dte) &&
          l.dte > 0),
    ),
  ),
  true,
);
check(
  'variant ids/names non-empty',
  MANAGE_VARIANTS.every((v) => v.id.length > 0 && v.name.length > 0),
  true,
);

// ── Referential integrity + conformance ──────────────────────────────
check(
  'every variant templateId resolves',
  MANAGE_VARIANTS.every((v) => getManageTemplate(v.templateId) !== undefined),
  true,
);
check(
  'no seeded variant uses the custom sentinel',
  MANAGE_VARIANTS.every((v) => v.templateId !== MANAGE_CUSTOM_TEMPLATE_ID),
  true,
);
check(
  'custom sentinel never resolves',
  getManageTemplate(MANAGE_CUSTOM_TEMPLATE_ID),
  undefined,
);
check(
  'every variant passes variantMatchesTemplate',
  MANAGE_VARIANTS.every((v) =>
    variantMatchesTemplate(v, getManageTemplate(v.templateId)!),
  ),
  true,
);
check(
  'seeded variants satisfy their template direction ordering',
  MANAGE_VARIANTS.every((v) => {
    const t = getManageTemplate(v.templateId)!;
    return !t.direction || variantDirectionHolds(v, t.direction);
  }),
  true,
);
check(
  'primary dte is the min (near-leg) option dte',
  MANAGE_VARIANTS.every((v) => {
    const dtes = v.legs.filter((l) => l.kind === 'option').map((l) => l.dte);
    return v.dte === Math.min(...dtes);
  }),
  true,
);

// ── JSON artifact mirror ─────────────────────────────────────────────
// A stringify→parse deep-equal is a tautology for serializable input —
// it can't see Date→string mutation or NaN→null. Walk the leaves instead:
// every value must be a string, finite number, boolean, plain object, or
// array — the only shapes the external JSON artifact can carry.
function isJsonData(x: unknown): boolean {
  if (x === null) return true;
  if (Array.isArray(x)) return x.every(isJsonData);
  if (typeof x === 'object') {
    return Object.values(x as Record<string, unknown>).every(isJsonData);
  }
  return (
    typeof x === 'string' ||
    typeof x === 'boolean' ||
    (typeof x === 'number' && Number.isFinite(x))
  );
}
check(
  'seeds are pure JSON data (leaf-walked)',
  isJsonData(MANAGE_TEMPLATES) && isJsonData(MANAGE_VARIANTS),
  true,
);

// ── Lookups ──────────────────────────────────────────────────────────
check('getManageTemplate hit', getManageTemplate('cds')?.code, 'CDS');
check('getManageTemplate miss', getManageTemplate('nope'), undefined);
check(
  'getManageTemplateByCode hit',
  getManageTemplateByCode('CDS')?.id,
  'cds',
);
check(
  'getManageTemplateByCode miss',
  getManageTemplateByCode('nope'),
  undefined,
);
check('getManageVariant hit', getManageVariant('cds-30-50-40')?.dte, 30);
check('getManageVariant miss', getManageVariant('nope'), undefined);
check(
  'lookup round-trips all ids + codes',
  MANAGE_TEMPLATES.every(
    (t) => getManageTemplate(t.id) === t && getManageTemplateByCode(t.code) === t,
  ) && MANAGE_VARIANTS.every((v) => getManageVariant(v.id) === v),
  true,
);

if (failures > 0) {
  console.log(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
