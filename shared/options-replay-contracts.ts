/**
 * Shared contracts for Selection Replay (Topic #1238, Thread #1240).
 *
 * A selection replay run is ONE (template, symbol, startDate) selection —
 * submitting N symbols creates N independent runs (#1430). A run fetches
 * the SA Pick Document for the template's coordinate and persists a
 * Contract List — one row per trading day, either a resolved position
 * (schemaVersion 2) or an explicit no-selection marker. Legacy v1 docs
 * (`pick` rows + `pickDocMeta`) narrow to v2 via `v1ListDocToV2` — readers
 * see one schema. Types plus the pure helpers that stamp/narrow them;
 * importable by both the Angular frontend and Firebase functions.
 *
 * Timestamps are ISO strings at the shared layer (BE writers stamp
 * FieldValue server-side; the read shape here is what FE/BE consumers see).
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';

// ==========================
// Templates
// ==========================

/** Expiration selector inside a pick-doc coordinate. */
export interface PickDocExpiry {
  mode: 'nearestDte';
  dte: number;
}

/** Pick-doc coordinate — the SA grid cell a template maps to. */
export interface PickDocCoordinate {
  type: OptionType;
  /** Signed delta target matching SA's convention (e.g. -0.20 for puts). */
  targetDelta: number;
  expiry: PickDocExpiry;
}

// ==========================
// Pick-doc grid
// ==========================

/**
 * The fixed pick-doc grid menu (Thread #1270 catalog): |Δ| 5–95 in steps
 * of `PICK_GRID_DELTA_STEP`, DTEs from `PICK_GRID_DTES`. Leg coordinates,
 * template-shape bands, and the registry validator (#1494) all resolve
 * against this menu — a leg is "on-grid" when |targetDelta| is a step
 * multiple inside [5, 95] and `dte` is a member of the menu.
 */
export const PICK_GRID_DTES: readonly number[] = [7, 14, 21, 30, 45, 60, 90, 120, 180, 365];

/** |Δ|% step between adjacent grid cells (5 → magnitudes 5,10,…,95). */
export const PICK_GRID_DELTA_STEP = 5;

/** |Δ|% bounds of the grid — magnitudes only; sign comes from option type. */
export const PICK_GRID_DELTA_BAND: readonly [number, number] = [5, 95];

/**
 * A curated time-based selection template. `side` stamps direction onto rows
 * at write time — pick docs are direction-neutral, so the same coordinate can
 * serve STO and BTO templates.
 */
export interface ReplayTemplate {
  /** Stable id, e.g. 'csp-45-20'. */
  id: string;
  /** Display name, e.g. '45DTE 20Δ put (CSP)'. */
  name: string;
  description: string;
  side: TradeSide;
  coordinate: PickDocCoordinate;
}

// ==========================
// Variant legs (Thread #1270 — Multi-leg Templates)
// ==========================

/**
 * Concrete option leg — a resolved pick-doc coordinate plus direction.
 * The same shape is the engine's concrete leg coordinate: `dte` replaces
 * the `dteMin`/`dteMax` window on pick-doc-driven configs. A bare template
 * leg carries bands instead; see `TemplateShapeLeg` (#1492).
 */
export interface OptionLeg {
  kind: 'option';
  type: OptionType;
  /** Signed delta target matching SA's convention (e.g. -0.20 for puts).
   *  Sign-vs-`type` parity and on-grid `dte` are NOT enforced here —
   *  they're data-carried conventions; the registry validator (#1494)
   *  and the #1498 request boundary enforce them. */
  targetDelta: number;
  /** Calendar days — one of the pick-doc grid's DTE cells. */
  dte: number;
  side: TradeSide;
}

/** Stock leg — no pick doc; marks at the underlying close. */
export interface StockLeg {
  kind: 'stock';
  side: TradeSide;
}

/** One leg of a variant — an option pick or a share of the underlying. */
export type VariantLeg = OptionLeg | StockLeg;

/** Map an option leg to its pick-doc coordinate — the single place the
 *  leg → coordinate derivation lives, so historical replay and live
 *  selection can't diverge. */
export function legToPickDocCoordinate(leg: OptionLeg): PickDocCoordinate {
  return {
    type: leg.type,
    targetDelta: leg.targetDelta,
    expiry: { mode: 'nearestDte', dte: leg.dte },
  };
}

/** Inverse of `legToPickDocCoordinate` — a legacy `ReplayTemplate` viewed
 *  as a 1-leg option leg. The migration shim resolving `templateId` runs
 *  to 1-leg variants goes through this (#1498). */
export function templateToOptionLeg(template: ReplayTemplate): OptionLeg {
  return {
    kind: 'option',
    type: template.coordinate.type,
    targetDelta: template.coordinate.targetDelta,
    dte: template.coordinate.expiry.dte,
    side: template.side,
  };
}

/**
 * A concrete, named, reusable configuration — `legs` are the recipe;
 * id/name are labels. Registry entries live in
 * `shared/options-replay-templates.ts` (#1492).
 */
export interface ReplayVariant {
  /** Stable id, e.g. 'pcs-45-20-10'. */
  id: string;
  /** Display name, e.g. '45DTE 20/10Δ put credit spread'. */
  name: string;
  description: string;
  /** Which template shape it was composed from, or 'custom'. */
  structure?: string;
  /** Concrete legs — every option leg has Δ/DTE pinned. Registry data —
   *  readonly so an importer can't mutate the shared curated array. */
  legs: readonly VariantLeg[];
}

/**
 * Variant as stamped on the run doc — self-describing, so later registry
 * edits can't rewrite history. The worker reads this, never the registry.
 */
export interface VariantSnapshot {
  /** Registry id when the run came from a named variant; absent for
   *  inline `legs` submissions. */
  variantId?: string;
  name: string;
  /** Stamped to the run doc — never mutated after write. readonly also
   *  keeps `variant.legs` assignable here without a copy (#1498). */
  legs: readonly VariantLeg[];
}

// ==========================
// SA Pick Document (wire shape)
// ==========================

/** One trading day's pick inside a PickDocument. Field-for-field identical to
 *  SA's `DayPick` (av-proxy-api shared/options/options-delta-picks.types.ts). */
export interface PickDocDay {
  underlyingClose: number;
  contractId: string;
  expiration: string;
  dte: number;
  strike: number;
  delta: number;
  iv: number;
  mark: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
}

/** SA miss statuses — explicit no-pick entries inside the `days` map.
 *  `no_chain` = no corpus chain for that date (self-repairs upstream when the
 *  chain is later seeded); `no_match` = chain present but nothing selectable
 *  for this cell. */
export type PickDocMissStatus = 'no_chain' | 'no_match';

/** An explicit miss entry — mirrors SA's `DayMiss`. `underlyingClose` is
 *  present whenever an adjusted close exists for the date. */
export interface PickDocMiss {
  status: PickDocMissStatus;
  underlyingClose?: number;
  reason?: string;
}

/** One trading day's entry — a picked contract or an explicit miss. A pick
 *  entry carries no `status` field; presence of `contractId` means pick. */
export type PickDocDayEntry = PickDocDay | PickDocMiss;

/** Narrow a day entry to a pick — `contractId` is present only on picks.
 *  Mirrors SA's `isPickEntry` (null-safe, not just key presence). */
export function isPickDocPick(entry: PickDocDayEntry): entry is PickDocDay {
  return 'contractId' in entry && entry.contractId != null;
}

/** SA pick doc — one grid cell-year shard: the coordinate plus symbol, grid
 *  metadata, and day map. Matches SA's `CellYearDoc` (the storage doc is the
 *  wire contract; `updatedAt` is stamped by SA's materialization writer and
 *  passed through by the endpoint). */
export interface PickDocument extends PickDocCoordinate {
  symbol: string;
  gridVersion: number;
  firstDate: string;
  lastDate: string;
  pickCount: number;
  missCount: number;
  /** Trading date → pick or explicit miss. Every trading day in
   *  [firstDate, lastDate] carries an entry; absent keys are treated as
   *  no-selection defensively. */
  days: Record<string, PickDocDayEntry>;
  /** Server stamp — ISO string on the wire. */
  updatedAt?: string;
}

// ==========================
// Contract List
// ==========================

/**
 * Why a trading day produced no pick. Maps SA day-entry statuses:
 * 'miss' = SA `no_match` (chain existed, no contract met the criteria);
 * 'gap' = SA `no_chain` (market data hole — self-repairs upstream);
 * 'out-of-range' = past the doc's lastDate. Optional — writers populate when
 * the cause is known.
 */
export type NoSelectionReason = 'miss' | 'gap' | 'out-of-range';

/**
 * A day's pick — the **v1** row shape, kept for legacy list docs
 * (schemaVersion absent). Extends the PickDocDay wire shape verbatim so SA
 * field changes propagate instead of silently drifting; `entryDate` is the
 * map key promoted to a field, `side` is stamped from the template, and
 * `repeatsPrevious` flags that the immediately preceding row picked the
 * same contractId (each repeated pick is still a distinct position entry).
 * Readers narrow to the v2 position row via `v1PickToPosition`.
 */
export interface ContractListPickRowV1 extends PickDocDay {
  kind: 'pick';
  entryDate: string;
  side: TradeSide;
  repeatsPrevious: boolean;
}

/** v1 no-selection marker — predates per-leg miss detail (#1493). */
export interface ContractListNoSelectionRowV1 {
  kind: 'no-selection';
  entryDate: string;
  reason?: NoSelectionReason;
}

/** v1 row union — legacy list docs only; readers see v2 via the shim. */
export type ContractListRowV1 = ContractListPickRowV1 | ContractListNoSelectionRowV1;

/** Resolved option leg on a position row — the entry-day pick fields
 *  verbatim plus the coordinate the leg resolved under and its side. */
export interface PositionOptionLeg extends PickDocDay {
  kind: 'option';
  side: TradeSide;
  coordinate: PickDocCoordinate;
}

/** Stock legs need no contract resolution — the entry-day underlying
 *  close is all they carry. */
export interface PositionStockLeg {
  kind: 'stock';
  side: TradeSide;
  underlyingClose: number;
}

export type PositionLeg = PositionOptionLeg | PositionStockLeg;

/** Which leg failed to resolve for a no-selection day, and why. */
export interface PositionLegMiss {
  legIndex: number;
  coordinate: PickDocCoordinate;
  reason?: NoSelectionReason;
}

/**
 * A day's resolved position — exists iff EVERY option leg resolved for
 * that date (atomicity: partial positions are never written). `legs` is
 * ≥1 — a single-leg position is `legs.length === 1`, not a separate kind.
 * `repeatsPrevious` flags that every leg matches the immediately
 * preceding position row — the UI's "same trade rolled forward" hint.
 */
export interface ContractListPositionRow {
  kind: 'position';
  entryDate: string;
  legs: readonly [PositionLeg, ...PositionLeg[]];
  repeatsPrevious: boolean;
}

/** Explicit marker for a trading day with no position — never omitted.
 *  `legMisses` names each failing option leg's coordinate (plus a reason
 *  when known); `reason` is the roll-up worst miss across legs. */
export interface ContractListNoSelectionRow {
  kind: 'no-selection';
  entryDate: string;
  reason?: NoSelectionReason;
  legMisses: readonly [PositionLegMiss, ...PositionLegMiss[]];
}

/** One contract-list row — a resolved position or an explicit
 *  no-selection marker. The v1 `pick` kind is retired. */
export type ContractListRow = ContractListPositionRow | ContractListNoSelectionRow;

/** Pick-doc provenance recorded on each list doc — v1 carries one; v2
 *  carries `legMetas[i]` per option leg in `legs[i]` order. */
export interface PickDocMeta {
  coordinate: PickDocCoordinate;
  gridVersion: number;
  pickCount: number;
  missCount: number;
  firstDate: string;
  lastDate: string;
}

/**
 * Narrow a v1 pick row to a 1-leg position row — every day field plus
 * `side` lands verbatim on the leg, with `coordinate` stamped by the
 * caller (it lives on the doc's `pickDocMeta`, not the row). For row
 * sequences use `v1RowsToPositionRows` — `repeatsPrevious` needs the
 * previous row to normalize correctly.
 */
export function v1PickToPosition(
  row: ContractListPickRowV1,
  coordinate: PickDocCoordinate,
): ContractListPositionRow {
  const { kind: _pickKind, entryDate, side, repeatsPrevious, ...dayFields } = row;
  return {
    kind: 'position',
    entryDate,
    legs: [{ ...dayFields, kind: 'option', side, coordinate }],
    repeatsPrevious,
  };
}

/**
 * Narrow a whole v1 row sequence to v2. Picks become 1-leg positions;
 * markers gain `legMisses` naming leg 0's coordinate — v1 was single-leg,
 * so every miss was that leg's. `repeatsPrevious` is normalized, not
 * trusted: the flag means "the previous row was a position", so a row
 * after a no-selection gap (or the first row) can never repeat.
 */
export function v1RowsToPositionRows(
  rows: readonly ContractListRowV1[],
  coordinate: PickDocCoordinate,
): ContractListRow[] {
  const out: ContractListRow[] = [];
  for (const row of rows) {
    if (row.kind === 'no-selection') {
      const reason = row.reason ? { reason: row.reason } : {};
      out.push({
        kind: 'no-selection',
        entryDate: row.entryDate,
        ...reason,
        legMisses: [{ legIndex: 0, coordinate, ...reason }],
      });
      continue;
    }
    const pos = v1PickToPosition(row, coordinate);
    const prev = out[out.length - 1];
    out.push({
      ...pos,
      // Normalized, not trusted: the flag means "the previous row was a
      // position with identical legs" — a gap or first row can never
      // repeat, and a corrupt flag can't survive a contractId change.
      repeatsPrevious:
        pos.repeatsPrevious &&
        prev?.kind === 'position' &&
        positionRepeatsPrevious(prev.legs, pos.legs),
    });
  }
  return out;
}

/**
 * All-legs-match for `repeatsPrevious` on v2 rows: a position repeats only
 * when every leg is identical to the previous position's — option legs on
 * kind + side + `contractId`, stock legs on kind + side (they have no
 * contract). Marks and
 * Greeks drift day to day; identity fields may not. The v2 writer calls
 * this when stamping rows; a per-leg repeat flag is noise.
 */
export function positionRepeatsPrevious(
  prevLegs: readonly PositionLeg[] | undefined,
  legs: readonly PositionLeg[],
): boolean {
  if (!prevLegs || !legs.length || prevLegs.length !== legs.length) return false;
  return legs.every((leg, i) => {
    const prev = prevLegs[i];
    if (leg.kind !== prev.kind || leg.side !== prev.side) return false;
    return leg.kind === 'option' && prev.kind === 'option'
      ? leg.contractId === prev.contractId
      : true;
  });
}

/** Narrow a v1 list doc to the v2 shape — `pickDocMeta` becomes
 *  `legMetas[0]`, rows narrow per the sequence rules, `schemaVersion`
 *  stamped. Readers see one schema. */
export function v1ListDocToV2(doc: OptionsContractListDocV1): OptionsContractListDoc {
  // Failed/stub docs are merge-written as Partial — a missing payload is a
  // caller bug (gate on status first), not a TypeError.
  if (!doc.pickDocMeta || !Array.isArray(doc.rows)) {
    throw new Error('v1ListDocToV2: incomplete v1 list doc — gate on status before narrowing');
  }
  const { pickDocMeta, rows, ...rest } = doc;
  return {
    ...rest,
    schemaVersion: 2,
    rows: v1RowsToPositionRows(rows, pickDocMeta.coordinate),
    legMetas: [pickDocMeta],
  };
}

// ==========================
// Firestore doc shapes
// ==========================

/** Run status vocabulary — mirrors BacktestRunStatus values. */
export type OptionsReplayRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export const OPTIONS_REPLAY_RUN_STATUSES: readonly OptionsReplayRunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
];

/** List-doc status vocabulary — mirrors BacktestPermutationStatus values. */
export type OptionsContractListStatus = 'pending' | 'running' | 'success' | 'failed';
export const OPTIONS_CONTRACT_LIST_STATUSES: readonly OptionsContractListStatus[] = [
  'pending',
  'running',
  'success',
  'failed',
];

/**
 * Run header — st-options-replay-runs/{runId}. A run is ONE (template,
 * symbol, startDate) selection: submitting N symbols to
 * `optionsReplayStart` creates N independent run docs — the multi-symbol
 * input is convenience fanout, not a batch (no grouping field, #1430).
 * The runId embeds the symbol (`{runIdPT}_{rand}_{SYMBOL}`), and the run's
 * status IS its contract list's status — the worker's terminal list
 * outcome writes the run's terminal status directly.
 */
export interface OptionsReplayRun {
  runId: string;
  /** Resolved registry id — the variant id for variantId/templateId-form
   *  runs (one shared namespace), `'custom'` for inline `legs` runs which
   *  have no registry entry. Legs-form runs carry their identity in
   *  `variantSnapshot`, not an absent templateId (#1498). */
  templateId: string;
  symbol: string;
  startDate: string;
  status: OptionsReplayRunStatus;
  /** Self-describing variant the run resolved to — stamped at start so
   *  later registry edits can't rewrite history. Absent on runs created
   *  before the variant model (#1498 wires stamping). */
  variantSnapshot?: VariantSnapshot;
  /** ISO timestamps — BE writes FieldValue server-side. */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

/** v1 contract list — legacy docs (schemaVersion absent). `pickDocMeta`
 *  is the single-leg provenance; `rows` carry the retired `pick` kind.
 *  Readers narrow via `v1ListDocToV2`. */
export interface OptionsContractListDocV1 {
  runId: string;
  symbol: string;
  /** Registry id the run resolved to. A failed stub written when the
   *  run doc itself is missing may omit it — merge-writes are Partial. */
  templateId: string;
  status: OptionsContractListStatus;
  /** v1 is defined by absence — never present on a v1 doc. */
  schemaVersion?: never;
  rows: ContractListRowV1[];
  pickDocMeta: PickDocMeta;
  /** ISO timestamp. */
  generatedAt: string;
  error?: string;
}

/** Contract list — st-options-contract-lists/{runId} (docId IS the runId;
 *  run and list are 1:1 by construction). */
export interface OptionsContractListDoc {
  runId: string;
  symbol: string;
  /** Registry id the run resolved to. A failed stub written when the
   *  run doc itself is missing may omit it — merge-writes are Partial. */
  templateId: string;
  status: OptionsContractListStatus;
  /** Position-row schema version — `2`; absent on legacy v1 docs. */
  schemaVersion: 2;
  rows: ContractListRow[];
  /** Pick-doc provenance per option leg, in `legs[i]` order. */
  legMetas: readonly PickDocMeta[];
  /** ISO timestamp. */
  generatedAt: string;
  error?: string;
}

// ==========================
// Callable + task payloads
// ==========================

/** Fields shared by every optionsReplayStart request form. */
interface OptionsReplayStartBase {
  symbols: string[];
  startDate: string; // YYYY-MM-DD
}

/** Form 1 — a named variant from the code-curated registry. */
export interface OptionsReplayStartVariantRequest extends OptionsReplayStartBase {
  variantId: string;
  legs?: never;
  templateId?: never;
  variantName?: never;
}

/** Form 2 — inline concrete legs composed by the spread builder. The
 *  runtime boundary (#1498) requires a non-empty array passing
 *  `validateVariantLegs` (on-grid Δ/DTE, sign parity, no dupes) — the type
 *  alone can't express that, so `legs: []` still typechecks. */
export interface OptionsReplayStartLegsRequest extends OptionsReplayStartBase {
  legs: readonly VariantLeg[];
  /** Display-only label carried onto the run's snapshot — an inline
   *  submission has no registry name to borrow. */
  variantName?: string;
  variantId?: never;
  templateId?: never;
}

/** Legacy form — the v1 single-template picker, resolved to its 1-leg
 *  variant server-side. Retired once the builder dialog ships (#1507). */
export interface OptionsReplayStartTemplateRequest extends OptionsReplayStartBase {
  templateId: string;
  variantId?: never;
  legs?: never;
  variantName?: never;
}

/**
 * Request shape for the optionsReplayStart callable — exactly one of
 * `variantId` / `legs` / `templateId` identifies the variant. The three
 * forms are mutually exclusive in the type.
 */
export type OptionsReplayStartRequest =
  | OptionsReplayStartVariantRequest
  | OptionsReplayStartLegsRequest
  | OptionsReplayStartTemplateRequest;

/** One runId per submitted symbol — each is an independent run doc. */
export interface OptionsReplayStartResponse {
  runIds: string[];
}

/** Cloud Task payload — one per run (each run is a single symbol, #1430).
 *  Just the identity: every selection input (symbol included) is read
 *  off the run doc, so a stale payload can't disagree with it.
 *  `symbol` rides along solely so the worker can still label a
 *  meaningful failed list doc when the run doc itself is gone —
 *  the data path uses `run.symbol`. */
export interface OptionsReplayPermutationPayload {
  runId: string;
  symbol: string;
}

/** optionsReplayRetry — re-runs a failed single-symbol run in place
 *  (Thread #1266, task #1369; single-symbol model #1430). */
export interface OptionsReplayRetryRequest {
  runId: string;
}

export interface OptionsReplayRetryResponse {
  /** The retried run's symbol, or `null` when the call was a no-op
   *  (run not `failed`). */
  retriedSymbol: string | null;
}

/** optionsReplayDelete — cascade-deletes a run, its 1:1 contract list
 *  (docId == runId), and every analysis-result doc keyed off it
 *  (`contractListDocId == runId`). Idempotent: missing docs count as
 *  already-deleted, not errors (task #1439). */
export interface OptionsReplayDeleteRequest {
  runId: string;
}

export interface OptionsReplayDeleteResponse {
  /** True when the run doc existed and was deleted. */
  deletedRun: boolean;
  /** Contract-list docs deleted (0 or 1 — the model is 1:1). */
  deletedLists: number;
  /** st-options-analysis-results docs deleted. */
  deletedResults: number;
}
