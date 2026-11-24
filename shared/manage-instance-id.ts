/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1542 — SHARED: Manage instance ID generator
 * @task #1711 — SHARED: parse + canonical display-name generator
 *
 * Manage-domain instance IDs: `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}`,
 * ALL-CAPS, hyphen-delimited — e.g. `QQQ-CDS-30-50-40-ALL`.
 *
 *   - SYM     — underlying ticker, normalized to uppercase
 *   - SPREAD  — the template's `code` ('CUSTOM' for ad hoc variants)
 *   - DTE     — the variant's primary DTE (the near leg's, per contract)
 *   - ΔLEGS   — leg deltas in leg-array order (template-defined for
 *               conforming variants) joined with '-':
 *               round(|Δ|*100) per option leg ('50-40'), 'STK' per stock
 *               leg. Rounding is the encode — variants targeting
 *               sub-percent deltas share an ID (the seed contract pins
 *               whole-percent deltas; ad hoc authors get the same rule).
 *   - STOP    — 'ALL' (paper) or a STOP_CODES key (real), normalized
 *               trim+uppercase
 *
 * The id is the instance's dedup key — every segment is validated so no
 * '-' can smuggle a fifth position into the grammar, and anything the
 * grammar can't distinguish (multi-expiry legs, mismatched dte, a
 * template that isn't the variant's own, legs that don't conform to
 * their template) throws instead of emitting a colliding id.
 *
 * Known residual on the CUSTOM path — reachable only by a truly
 * template-free variant (`templateId === 'custom'`, the escape hatch the
 * contracts mark hypothetical; ad hoc variants composed in the Create
 * dialog still carry their template's id and pass shape conformance):
 * ΔLEGS encodes |Δ| only — a freeform put spread and call spread at the
 * same |Δ|s/dte/symbol/stop mint the same `…-CUSTOM-…` id (type/side are
 * invisible), and LONG-vs-SHORT stock-only variants likewise collide.
 * Accepted for v1 — encoding type/side into CUSTOM ΔLEGS ('C50-P40') is
 * a grammar decision deferred to the artifact-schema workstream; flag
 * before the BE create path lands.
 *
 * Replaces `generateInstanceId` (strategy-instance-id.ts) for manage
 * instances; the legacy function stays for its remaining readers.
 *
 * This module is the identity-grammar home: it generates the id and
 * parses it back to typed segments. The display-name generator
 * (`variantDisplayName`) lives in `manage-variant-display.ts` — its
 * string-input overload needs this parser, and hosting it in the
 * catalog would close a module cycle.
 */

import type { InstanceMode, StopType } from './manage-instance-contracts';
import {
  INSTANCE_MODES,
  isValidModeStopType,
  STOP_TYPE_ALL,
} from './manage-instance-contracts';
import type {
  ManageTemplate,
  ManageVariant,
} from './manage-variant-contracts';
import {
  getManageTemplateByCode,
  MANAGE_CUSTOM_TEMPLATE_ID,
  variantMatchesTemplateShape,
} from './manage-variant-catalog';

/**
 * STOP-segment vocabulary: `ALL` is the paper-mode composite (every
 * configured exit applies); real-mode codes are human-readable stop
 * identifiers. Keys are ALL-CAPS alphanumeric — '-' is forbidden inside
 * the hyphen-delimited grammar. Values are display descriptions.
 *
 * `T8` is a placeholder pending the real stop-type vocabulary (per the
 * PRD's worked example) — extend this map as real stops are defined.
 */
export const STOP_CODES: Readonly<Record<string, string>> = Object.freeze({
  [STOP_TYPE_ALL]: 'all configured exits (paper composite)',
  T8: 'placeholder real stop — vocabulary TBD',
});

export interface ManageInstanceIdInput {
  /** Underlying ticker — normalized trim+uppercase; charset
   *  `[A-Z0-9]+(\.[A-Z0-9]+)*` (dots for BRK.B-class tickers). */
  symbol: string;
  /** The variant being instantiated (embedded snapshot source). */
  variant: ManageVariant;
  /**
   * The template `variant.templateId` resolved to — omit for ad hoc
   * (`MANAGE_CUSTOM_TEMPLATE_ID`) variants, which emit a `CUSTOM`
   * SPREAD segment. When passed, the template must match
   * `variant.templateId` AND the variant's legs must match its shape
   * (`variantMatchesTemplateShape` — kind/type/side positional; delta/DTE
   * bands are authoring policy, not checked here) — the ΔLEGS grammar
   * can't distinguish a put spread from a call spread at the same |Δ|s,
   * so a shape-conforming pair is required to keep the dedup key
   * unique-by-construction.
   * That uniqueness guarantee is template-gated: ad hoc variants
   * composed from a template still carry its `templateId` and pass this
   * gate; only a truly template-free variant (`'custom'`, a hypothetical
   * escape hatch per variant-contracts) emits `CUSTOM`, where a put
   * spread and a call spread at the same |Δ|s share `QQQ-CUSTOM-…`.
   */
  template?: ManageTemplate;
  /** Paper ⇒ 'ALL'; real ⇒ a seeded STOP_CODES key. */
  mode: InstanceMode;
  /** Stop code; normalized trim+uppercase before validation. */
  stopType: StopType;
}

/**
 * Generate the manage instance id. Throws on any input the grammar
 * can't encode unambiguously — an id is a dedup key, so a best-effort
 * emit would silently conflate distinct configurations.
 */
export function generateManageInstanceId(
  input: ManageInstanceIdInput,
): string {
  // InstanceMode is a compile-time union only — a wire caller can pass any
  // string, and isValidModeStopType treats every non-'paper' value as real.
  if (!INSTANCE_MODES.includes(input.mode)) {
    throw new Error(`mode '${input.mode}' is not a known InstanceMode`);
  }

  const symbol = input.symbol.trim().toUpperCase();
  // Alnum with dots between alnums only — BRK.B-class tickers; '.', 'Q.',
  // and '..QQ' are not tickers.
  assertSegment('symbol', symbol, /^[A-Z0-9]+(\.[A-Z0-9]+)*$/);

  const stop = input.stopType.trim().toUpperCase();
  if (!isValidModeStopType(input.mode, stop)) {
    throw new Error(
      `mode '${input.mode}' + stopType '${stop}' violates the mode/stop invariant`,
    );
  }
  // hasOwnProperty, not `in` — 'constructor'/'toString' pass `in` via the
  // prototype chain and would mint unseeded codes into the dedup key.
  if (!Object.prototype.hasOwnProperty.call(STOP_CODES, stop)) {
    throw new Error(`stop code '${stop}' is not in STOP_CODES`);
  }
  assertSegment('stop', stop, /^[A-Z0-9]+$/);

  if (!Array.isArray(input.variant.legs)) {
    throw new Error('variant.legs is not an array — nothing to encode');
  }
  const spread = spreadSegment(input);
  // ΔLEGS first — dlegsPiece's curated leg-kind error must run before
  // dteSegment's flatMap dereferences leg.kind (same malformed input).
  const dlegs = input.variant.legs.map(dlegsPiece).join('-');
  const dte = dteSegment(input.variant);

  const id = `${symbol}-${spread}-${dte}-${dlegs}-${stop}`;
  // Whole-id net — every segment is individually validated, but a finite
  // out-of-domain number (e.g. dte 1e21 → '1e+21') could still smuggle
  // non-grammar characters in. The dedup key may not contain them. The
  // symbol segment allows '.' (BRK.B-class tickers) like the per-segment
  // charset does.
  if (!/^[A-Z0-9.]+(-[A-Z0-9.]+)+$/.test(id)) {
    throw new Error(`generated id '${id}' violates the grammar charset`);
  }
  return id;
}

// ==========================
// Segment helpers
// ==========================

/**
 * One ΔLEGS piece per leg: `round(|Δ|*100)` for option legs — the delta
 * must be a finite (0,1] magnitude or it mints garbage segments ('NaN',
 * 'Infinity', '1e+23') that distinct malformed inputs would collide on —
 * and `STK` for stock legs. Anything else is unencodable and throws.
 */
function dlegsPiece(leg: ManageVariant['legs'][number]): string {
  if (!leg || (leg.kind !== 'option' && leg.kind !== 'stock')) {
    throw new Error(
      `unencodable leg kind '${(leg as { kind?: string } | undefined)?.kind}' in ΔLEGS`,
    );
  }
  if (leg.kind === 'stock') return 'STK';
  if (typeof leg.targetDelta !== 'number') {
    // Strict-typing parity with leg dte — '0.5' must not coerce to '50'.
    throw new Error(`option-leg targetDelta '${leg.targetDelta}' is not a number`);
  }
  const a = Math.abs(leg.targetDelta);
  if (!Number.isFinite(a) || a <= 0 || a > 1) {
    throw new Error(
      `option-leg targetDelta ${leg.targetDelta} must be finite with |Δ| in (0,1]`,
    );
  }
  const piece = Math.round(a * 100);
  // |Δ| < 0.5% rounds to 0 — a segment the grammar can't carry back
  // through parseManageInstanceId's (0,100] check. Refuse it at mint
  // rather than mint an id its own inverse rejects.
  if (piece < 1 || piece > 100) {
    throw new Error(
      `option-leg targetDelta ${leg.targetDelta} encodes to '${piece}' — ` +
        'outside (0,100], the id would not round-trip',
    );
  }
  return String(piece);
}

/** SPREAD segment — template code, or CUSTOM for ad hoc variants. */
function spreadSegment(input: ManageInstanceIdInput): string {
  const isCustom = input.variant.templateId === MANAGE_CUSTOM_TEMPLATE_ID;
  if (input.template) {
    if (isCustom || input.template.id !== input.variant.templateId) {
      throw new Error(
        `template '${input.template.id}' does not match variant.templateId '${input.variant.templateId}'`,
      );
    }
    // The grammar can't distinguish a put spread from a call spread at the
    // same |Δ|s — legs that don't structurally match their declared
    // template mint colliding ids, so shape conformance is enforced here,
    // not left to callers. Bands are NOT checked: delta/DTE bands are
    // authoring policy (seed curation, Create-dialog/BE validation) — an
    // out-of-band ad hoc variant under a named template still mints a
    // unique, truthful id.
    if (!variantMatchesTemplateShape(input.variant, input.template)) {
      throw new Error(
        `variant legs do not conform to template '${input.template.id}' (positional kind/type/side)`,
      );
    }
    assertSegment('spread code', input.template.code, /^[A-Z0-9]+$/);
    return input.template.code;
  }
  if (!isCustom) {
    throw new Error(
      `templateId '${input.variant.templateId}' did not resolve — pass the resolved template`,
    );
  }
  return 'CUSTOM';
}

/**
 * DTE segment + the checks the grammar's single-DTE shape demands:
 * every option leg must share the variant's primary dte — a diagonal
 * variant would collide with its same-expiry siblings, so it throws
 * instead of minting an ambiguous id.
 */
function dteSegment(variant: ManageVariant): number {
  const dtes = variant.legs.flatMap((l) =>
    l.kind === 'option' ? [l.dte] : [],
  );
  if (!Number.isInteger(variant.dte) || variant.dte <= 0) {
    throw new Error(`variant.dte '${variant.dte}' is not a positive integer`);
  }
  if (dtes.length === 0) {
    if (variant.legs.length === 0) {
      throw new Error('variant has no legs — ΔLEGS would be empty');
    }
    // No option legs at all: the primary dte still encodes (stock-only
    // variants are hypothetical today — the grammar accepts the slot).
    return variant.dte;
  }
  if (new Set(dtes).size > 1) {
    throw new Error(
      `multi-expiry legs (${[...new Set(dtes)].join('/')}) — the ID grammar ` +
        `carries one DTE segment and cannot distinguish diagonals`,
    );
  }
  if (dtes[0] !== variant.dte) {
    throw new Error(
      `variant.dte ${variant.dte} disagrees with leg dte ${dtes[0]}`,
    );
  }
  return variant.dte;
}

// ==========================
// Instance-ID parse
// ==========================

/**
 * The typed segments of a manage instance id — the inverse of
 * {@link generateManageInstanceId}. `deltaLegs` preserves the ΔLEGS
 * segment's leg order: `round(|Δ|*100)` per option leg, `'STK'` per
 * stock leg.
 */
export interface ParsedManageInstanceId {
  symbol: string;
  /** Template `code` ('CDS', 'IC', …) or 'CUSTOM'. */
  spreadCode: string;
  dte: number;
  deltaLegs: readonly (number | 'STK')[];
  stop: string;
}

/**
 * Parse a manage instance id back into its grammar segments. Strict —
 * the id is a dedup key, so anything the generator could not have
 * emitted throws instead of returning a plausible-looking lie: wrong
 * segment count, lowercase, unknown spread/stop codes, non-integer or
 * out-of-range ΔLEGS pieces, non-canonical encodings (leading zeros —
 * the generator's `String(n)` never emits them), and ΔLEGS that
 * disagree with the named spread's leg shape. No trimming or
 * case-folding — a stored id is already canonical.
 */
export function parseManageInstanceId(id: string): ParsedManageInstanceId {
  if (typeof id !== 'string') {
    throw new Error(`instance id '${id}' is not a string`);
  }
  const segs = id.split('-');
  // SYM-SPREAD-DTE-ΔLEGS…-STOP — ΔLEGS carries at least one piece.
  if (segs.length < 5) {
    throw new Error(
      `instance id '${id}' has ${segs.length} segments — the grammar needs ≥5`,
    );
  }
  const [symbol, spread, dteSeg, ...rest] = segs;
  const stop = rest[rest.length - 1];
  const dlegsSegs = rest.slice(0, -1);

  assertSegment('symbol', symbol, /^[A-Z0-9]+(\.[A-Z0-9]+)*$/);

  const tpl = spread === 'CUSTOM' ? undefined : getManageTemplateByCode(spread);
  if (spread !== 'CUSTOM' && !tpl) {
    throw new Error(`spread segment '${spread}' is not a known template code`);
  }
  assertSegment('spread', spread, /^[A-Z0-9]+$/);

  const dte = parseNumericSegment('DTE', dteSeg, 1, Number.MAX_SAFE_INTEGER);

  const deltaLegs = dlegsSegs.map((piece) =>
    piece === 'STK' ? ('STK' as const) : parseNumericSegment('ΔLEGS', piece, 1, 100),
  );

  // ΔLEGS↔template conformance for named spreads — the generator gates
  // on positional leg shape, so the inverse holds parse to the same
  // contract: piece count and per-slot kind (option→number, stock→'STK').
  if (tpl) {
    if (deltaLegs.length !== tpl.legs.length) {
      throw new Error(
        `ΔLEGS has ${deltaLegs.length} piece(s) but spread '${spread}' ` +
          `(${tpl.name}) declares ${tpl.legs.length} leg(s) — unmintable id`,
      );
    }
    tpl.legs.forEach((slot, i) => {
      const isStk = deltaLegs[i] === 'STK';
      if (slot.kind === 'stock' ? !isStk : isStk) {
        throw new Error(
          `ΔLEGS piece ${i + 1} ('${dlegsSegs[i]}') does not match ` +
            `template '${tpl.id}' slot kind '${slot.kind}'`,
        );
      }
    });
  }

  assertSegment('stop', stop, /^[A-Z0-9]+$/);
  if (!Object.prototype.hasOwnProperty.call(STOP_CODES, stop)) {
    throw new Error(`stop code '${stop}' is not in STOP_CODES`);
  }

  return { symbol, spreadCode: spread, dte, deltaLegs, stop };
}

/**
 * One all-digit grammar piece → its integer, validated against the
 * canonical encoding (no leading zeros — `String(n)` is the only
 * encoder) and an inclusive range.
 */
function parseNumericSegment(
  name: string,
  seg: string,
  min: number,
  max: number,
): number {
  if (!/^\d+$/.test(seg)) {
    throw new Error(`${name} segment '${seg}' is not numeric`);
  }
  const n = Number(seg);
  if (String(n) !== seg) {
    throw new Error(
      `${name} segment '${seg}' is a non-canonical encoding (leading zeros)`,
    );
  }
  if (n < min || n > max) {
    throw new Error(`${name} segment '${seg}' is outside [${min},${max}]`);
  }
  return n;
}

/**
 * A segment must be non-empty, carry no '-' (the grammar delimiter), and
 * stay inside its charset — interior whitespace, '/', and lowercase leak
 * into the dedup key otherwise (symbols allow '.' for BRK.B-class tickers).
 */
function assertSegment(name: string, value: string, charset: RegExp): void {
  if (value.length === 0) {
    throw new Error(`${name} segment is empty`);
  }
  if (value.includes('-')) {
    throw new Error(`${name} segment '${value}' contains '-' — the ID delimiter`);
  }
  if (!charset.test(value)) {
    throw new Error(`${name} segment '${value}' has characters outside ${charset}`);
  }
}
