/**
 * @topic #137 — STRAT-MANAGE, Thread #1690 (Live Position Lifecycle)
 * @task #1711 — SHARED: canonical variant display-name generator
 *
 * The single display-name generator for manage variants:
 * `'{template name} {dte} {Δlegs}'` in the instance-id's own segment
 * order ('call debit spread 30 50-40'). Derives from structure rather
 * than trusting the stored `variant.name` string — names seeded under
 * the stale deltas-first convention ('call debit spread 50-40 30')
 * render correctly at the display seam with no data migration. ΔLEGS
 * names option deltas only; a `'STK'` piece never appears in a name.
 *
 * Lives apart from `manage-instance-id.ts` (the grammar's generate/parse
 * pair) because the string-input overload needs the parser — hosting it
 * in the catalog would import `instance-id` back and close a module
 * cycle.
 */

import {
  getManageTemplate,
  getManageTemplateByCode,
  variantDirectionHolds,
  variantMatchesTemplateShape,
} from './manage-variant-catalog';
import { parseManageInstanceId } from './manage-instance-id';
import type { ManageVariant } from './manage-variant-contracts';

/**
 * The canonical variant display name.
 *
 * Variant input: derives only when the structure tells the truth —
 * the template resolves, the legs conform to its positional shape AND
 * direction, `variant.dte` is a positive integer every option leg
 * agrees with (the same uniformity the id grammar demands), and every
 * delta is a renderable number — otherwise the authored `variant.name`
 * stands, which stays authoritative for custom, non-conforming, and
 * malformed variants.
 *
 * Id input: a 'CUSTOM' spread segment has no structure to name and no
 * authored fallback — it throws. Callers rendering live instances
 * should pass the embedded variant snapshot (`instance.variant`), not
 * the id — a custom instance's only truthful name is its authored one.
 */
export function variantDisplayName(
  input: ManageVariant | string,
): string {
  if (typeof input === 'string') {
    const parsed = parseManageInstanceId(input);
    const tpl = getManageTemplateByCode(parsed.spreadCode);
    if (!tpl) {
      throw new Error(
        `cannot derive a display name for spread '${parsed.spreadCode}' — ` +
          'a CUSTOM structure has no template',
      );
    }
    const deltas = parsed.deltaLegs.filter((d): d is number => d !== 'STK');
    if (deltas.length === 0) {
      throw new Error(
        `instance id '${input}' carries no option deltas — nothing to name`,
      );
    }
    return `${tpl.name.toLowerCase()} ${parsed.dte} ${deltas.join('-')}`;
  }

  if (input == null || typeof input !== 'object' || !Array.isArray(input.legs)) {
    throw new Error(
      'variantDisplayName needs a ManageVariant or an instance-id string',
    );
  }

  const tpl = getManageTemplate(input.templateId);
  const optLegs = input.legs.filter((l) => l.kind === 'option');
  const renderable =
    tpl != null &&
    Number.isInteger(input.dte) &&
    input.dte > 0 &&
    optLegs.length > 0 &&
    optLegs.every((l) => l.dte === input.dte) &&
    optLegs.every(
      (l) =>
        typeof l.targetDelta === 'number' &&
        Number.isFinite(l.targetDelta) &&
        Math.abs(l.targetDelta) > 0 &&
        Math.abs(l.targetDelta) <= 1,
    ) &&
    variantMatchesTemplateShape(input, tpl) &&
    variantDirectionHolds(input, tpl.direction);

  if (renderable && tpl) {
    const deltas = optLegs.map((l) => Math.round(Math.abs(l.targetDelta) * 100));
    return `${tpl.name.toLowerCase()} ${input.dte} ${deltas.join('-')}`;
  }
  return input.name;
}
