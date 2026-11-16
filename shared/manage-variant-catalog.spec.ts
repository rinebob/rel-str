/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1541 — SHARED: Variant catalog module (seed registry + loaders)
 *
 * Catalog tests: seeded templates/variants resolve and stay internally
 * coherent — template legs carry bands only (no pinned Δ/DTE), variant
 * legs are concrete, every variant's templateId resolves to a seeded
 * template, each variant passes `variantMatchesTemplate`, and seeded
 * variants preserve delta ordering (the debit character). Lookup helpers
 * hit/miss.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import { MANAGE_ADHOC_VARIANT_REF } from './manage-instance-contracts';
import {
  getManageTemplate,
  getManageTemplateByCode,
  getManageVariant,
  MANAGE_CUSTOM_TEMPLATE_ID,
  MANAGE_TEMPLATES,
  MANAGE_VARIANTS,
  variantMatchesTemplate,
} from './manage-variant-catalog';

describe('manage-variant-catalog', () => {
  describe('MANAGE_TEMPLATES', () => {
    it('is seeded with at least one template', () => {
      expect(MANAGE_TEMPLATES.length).toBeGreaterThanOrEqual(1);
      expect(MANAGE_TEMPLATES.map((t) => t.id)).toContain('cds');
    });

    it('has no duplicate ids or codes', () => {
      const ids = MANAGE_TEMPLATES.map((t) => t.id);
      const codes = MANAGE_TEMPLATES.map((t) => t.code);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('every option slot carries bands only — no pinned Δ/DTE', () => {
      for (const t of MANAGE_TEMPLATES) {
        expect(t.id.length).toBeGreaterThan(0);
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.code).toMatch(/^[A-Z0-9]+$/);
        // 'CUSTOM' is the ad hoc variants' SPREAD segment — a template
        // claiming it would misresolve their instance IDs (#1542).
        expect(t.code).not.toBe('CUSTOM');
        expect(t.legs.length).toBeGreaterThan(0);
        for (const leg of t.legs) {
          // Shape guard — a curated entry could sneak a concrete literal in
          // without a type error if authored as JSON.
          expect(leg).not.toHaveProperty('targetDelta');
          expect(leg).not.toHaveProperty('dte');
          expect(leg.role.length).toBeGreaterThan(0);
          if (leg.kind === 'option') {
            expect(leg.deltaMin).toBeLessThanOrEqual(leg.deltaMax);
            expect(leg.dteMin).toBeLessThanOrEqual(leg.dteMax);
            expect(leg.dteMin).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('MANAGE_VARIANTS', () => {
    it('is seeded with at least two variants', () => {
      expect(MANAGE_VARIANTS.length).toBeGreaterThanOrEqual(2);
    });

    it('has unique ids and names, disjoint from template ids', () => {
      const ids = MANAGE_VARIANTS.map((v) => v.id);
      const names = MANAGE_VARIANTS.map((v) => v.name);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(names).size).toBe(names.length);
      // A variant id colliding with a template id would make namespace
      // resolution ambiguous — ids share the registry surface.
      const templateIds = new Set(MANAGE_TEMPLATES.map((t) => t.id));
      for (const id of ids) expect(templateIds.has(id)).toBe(false);
      // 'adhoc' is the instance-side sentinel (MANAGE_ADHOC_VARIANT_REF)
      // — a registry variant claiming it would make variantRef ambiguous.
      for (const id of ids) expect(id).not.toBe(MANAGE_ADHOC_VARIANT_REF);
    });

    it('every variant resolves its templateId to a seeded template', () => {
      for (const v of MANAGE_VARIANTS) {
        expect(v.id.length).toBeGreaterThan(0);
        expect(v.name.length).toBeGreaterThan(0);
        expect(v.templateId).not.toBe(MANAGE_CUSTOM_TEMPLATE_ID);
        expect(getManageTemplate(v.templateId)).toBeDefined();
      }
    });

    it('every variant leg is concrete (Δ/DTE pinned on option legs)', () => {
      for (const v of MANAGE_VARIANTS) {
        expect(v.legs.length).toBeGreaterThan(0);
        for (const leg of v.legs) {
          if (leg.kind === 'option') {
            expect(leg.targetDelta).not.toBe(0);
            expect(Math.abs(leg.targetDelta)).toBeLessThan(1);
            // Whole-percent deltas — the ΔLEGS segment encodes integer
            // percents; sub-percent seeds would collide post-rounding
            // (#1542 owns the general rounding policy).
            expect(Number.isInteger(leg.targetDelta * 100)).toBe(true);
            expect(Number.isInteger(leg.dte)).toBe(true);
            expect(leg.dte).toBeGreaterThan(0);
          }
        }
      }
    });

    it('every variant passes variantMatchesTemplate against its template', () => {
      for (const v of MANAGE_VARIANTS) {
        const template = getManageTemplate(v.templateId);
        if (!template) throw new Error(`dangling templateId ${v.templateId}`);
        expect(variantMatchesTemplate(v, template)).toBe(true);
      }
    });

    it('seeded variants preserve delta ordering (debit character)', () => {
      // Bands may overlap — what keeps a CDS a debit spread is |Δ|long >
      // |Δ|short. Overlapping bands admit an inverted variant (credit
      // wearing a CDS name), so ordering is asserted on the seeds. The
      // long>short direction encodes the seeded debit structure; a future
      // credit template needs a per-template direction map (flagged to
      // the artifact-schema workstream).
      for (const v of MANAGE_VARIANTS) {
        const t = getManageTemplate(v.templateId)!;
        // Unordered pairs — the invariant holds wherever the long/short
        // slots sit; a short-first template must not silently no-op.
        const n = Math.min(v.legs.length, t.legs.length);
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const roles = [t.legs[i].role, t.legs[j].role].sort();
            if (roles[0] !== 'long' || roles[1] !== 'short') continue;
            const li = t.legs[i].role === 'long' ? i : j;
            const si = t.legs[i].role === 'short' ? i : j;
            const ll = v.legs[li], sl = v.legs[si];
            if (ll.kind === 'option' && sl.kind === 'option') {
              expect(Math.abs(ll.targetDelta)).toBeGreaterThan(
                Math.abs(sl.targetDelta),
              );
            }
          }
        }
      }
    });

    it('primary dte matches the legs — equal when same-expiry, near-leg otherwise', () => {
      for (const v of MANAGE_VARIANTS) {
        const dtes = v.legs
          .filter((l) => l.kind === 'option')
          .map((l) => l.dte);
        expect(v.dte).toBe(Math.min(...dtes));
      }
    });

    it('seeds are pure JSON data (external-artifact mirror)', () => {
      // toEqual is type-aware: a Date or class instance would survive
      // stringify→parse as a string/plain object and fail this check —
      // the artifact drops in only if the seeds really are plain data.
      expect(JSON.parse(JSON.stringify(MANAGE_TEMPLATES))).toEqual(
        MANAGE_TEMPLATES,
      );
      expect(JSON.parse(JSON.stringify(MANAGE_VARIANTS))).toEqual(
        MANAGE_VARIANTS,
      );
    });
  });

  describe('getManageTemplate', () => {
    it('returns the seeded entry on hit', () => {
      const t = getManageTemplate('cds');
      expect(t).toBeDefined();
      expect(t!.code).toBe('CDS');
      expect(t!.legs).toHaveLength(2);
    });

    it('returns undefined on miss — including the custom sentinel', () => {
      expect(getManageTemplate('nope')).toBeUndefined();
      expect(getManageTemplate('')).toBeUndefined();
      expect(getManageTemplate(MANAGE_CUSTOM_TEMPLATE_ID)).toBeUndefined();
    });

    it('round-trips every seeded id', () => {
      for (const t of MANAGE_TEMPLATES) {
        expect(getManageTemplate(t.id)).toBe(t);
      }
    });
  });

  describe('getManageTemplateByCode', () => {
    it('resolves the ID-grammar SPREAD segment', () => {
      expect(getManageTemplateByCode('CDS')?.id).toBe('cds');
    });

    it('misses on unknown or lowercase code', () => {
      expect(getManageTemplateByCode('nope')).toBeUndefined();
      expect(getManageTemplateByCode('')).toBeUndefined();
      // Exact-match is the contract: the ID grammar is ALL-CAPS, so a
      // lowercase form of a real code must not resolve.
      expect(getManageTemplateByCode('cds')).toBeUndefined();
    });

    it('round-trips every seeded code', () => {
      for (const t of MANAGE_TEMPLATES) {
        expect(getManageTemplateByCode(t.code)).toBe(t);
      }
    });
  });

  describe('getManageVariant', () => {
    it('returns the seeded entries on hit', () => {
      const v = getManageVariant('cds-30-50-40');
      expect(v).toBeDefined();
      expect(v!.templateId).toBe('cds');
      expect(v!.dte).toBe(30);
      const [long, short] = v!.legs;
      expect(long).toMatchObject({
        kind: 'option', type: OptionType.CALL, side: TradeSide.LONG,
        targetDelta: 0.5, dte: 30,
      });
      expect(short).toMatchObject({
        kind: 'option', type: OptionType.CALL, side: TradeSide.SHORT,
        targetDelta: 0.4, dte: 30,
      });
    });

    it('returns undefined on miss', () => {
      expect(getManageVariant('nope')).toBeUndefined();
      expect(getManageVariant('')).toBeUndefined();
    });

    it('round-trips every seeded id', () => {
      for (const v of MANAGE_VARIANTS) {
        expect(getManageVariant(v.id)).toBe(v);
      }
    });
  });

  describe('variantMatchesTemplate', () => {
    const cds = () => getManageTemplate('cds')!;
    // Select by id — index 0 would pass the negative tests for the wrong
    // reason if a different template's variant ever landed there.
    const seed = () => getManageVariant('cds-30-50-40')!;

    it('rejects a variant with wrong leg count', () => {
      const v = seed();
      expect(
        variantMatchesTemplate({ ...v, legs: [v.legs[0]] }, cds()),
      ).toBe(false);
    });

    it('rejects a leg pinned outside its band', () => {
      const v = seed();
      const offBand = {
        ...v,
        legs: [
          { ...v.legs[0], targetDelta: 0.9 },
          v.legs[1],
        ],
      };
      expect(variantMatchesTemplate(offBand, cds())).toBe(false);
    });

    it('rejects a leg with flipped side', () => {
      const v = seed();
      const flipped = {
        ...v,
        legs: [
          { ...v.legs[0], side: TradeSide.SHORT },
          v.legs[1],
        ],
      };
      expect(variantMatchesTemplate(flipped, cds())).toBe(false);
    });
  });
});
