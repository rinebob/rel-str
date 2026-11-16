/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1538 — SHARED: Manage instance + variant contracts (run-state, stop-type)
 *
 * Manage-domain instance contracts for the Strategy Manage page
 * (`options/strategy/manage`). A Manage Instance is
 * `variant × symbol × stopType` — unique by construction (no duplicate
 * instances for the same triple; re-running is toggling `runState` on the
 * same doc, never minting a new one).
 *
 * Known gap flagged to #1542: uniqueness weakens for multi-expiry spreads —
 * the ID grammar carries ONE DTE (the near leg's), so two variants differing
 * only in far-leg expiry (calendars/diagonals) produce identical IDs.
 * Resolve in the ID spec before the grammar ships.
 *
 * Persisted on `st-strategy-instances/{id}` (reused root, new schema).
 * The instance ID is `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}` in ALL CAPS —
 * see `manage-instance-id.ts` (#1542).
 *
 * Deliberately separate from the legacy `StrategyInstanceConfig` /
 * `LifecycleState` model: the manage domain uses `runState` (a new field —
 * NOT `lifecycleState` — so the wire field can't silently reinterpret the
 * enum), explicit `paper | real` modes per the PRD, and a `trigger` kind in
 * place of the old `frequency`/`openTimePT` pair (the noon-PT daily routine
 * is engine-owned; instances just pick how that routine opens for them).
 *
 * Pure types + invariant helpers; importable by both the Angular frontend
 * and Firebase functions.
 */

import type { ManageVariant } from './manage-variant-contracts';

// ==========================
// Vocabularies
// ==========================

/** Execution mode. v1 is paper-only; 'real' arrives in v2 — the field
 *  exists now so real support lands as enablement, not a schema change. */
export type InstanceMode = 'paper' | 'real';
export const INSTANCE_MODES: readonly InstanceMode[] = ['paper', 'real'];

/**
 * How the instance opens new positions during the engine's noon-PT routine:
 * - 'daily'  — the routine opens every trading day the instance is ACTIVE.
 * - 'signal' — the routine opens only when an ST signal fires for the
 *              instance's symbol that day.
 */
export type InstanceTrigger = 'daily' | 'signal';
export const INSTANCE_TRIGGERS: readonly InstanceTrigger[] = ['daily', 'signal'];

/**
 * Run state — the manual start/stop gate on opening new positions.
 *
 * - UNSTARTED: initial state at creation; has never run. The first start
 *   leaves UNSTARTED forever (restarting a stopped instance lands on ACTIVE).
 * - ACTIVE:    the noon-PT routine may open new positions per `trigger`;
 *              existing positions are managed normally.
 * - STOPPED:   no new opens; existing positions are still managed through
 *              expiration (the legacy PAUSED/STOPPED "off is off" semantics —
 *              restartable, never terminal).
 */
export type InstanceRunState = 'UNSTARTED' | 'ACTIVE' | 'STOPPED';
export const INSTANCE_RUN_STATES: readonly InstanceRunState[] = [
  'UNSTARTED',
  'ACTIVE',
  'STOPPED',
];

// ==========================
// Stop type
// ==========================

/**
 * Paper-mode stop type — every registered exit in the shared Exit Registry
 * is evaluated/tracked observationally while the position runs to expiry.
 */
export const STOP_TYPE_ALL = 'ALL';

/**
 * The instance's stop type — the ID's STOP segment.
 * - paper: always `'ALL'` (track every registered exit).
 * - real:  exactly one concrete stop code — the governing exit that actually
 *          exits the position. `ALL` is a hard invariant violation for real.
 * Concrete codes are a human-readable vocabulary mapped onto Exit Registry
 * `exitId`s (PRD open question — vocabulary lands with #1542/#1544) and
 * MUST NOT contain '-' (the ID grammar is '-'-delimited — a hyphenated
 * code would make the STOP segment unparseable).
 *
 * Compile-time this is effectively `string` — '(string & {})' exists only
 * to keep 'ALL' visible in completions. All real enforcement lives in
 * `isValidModeStopType`, not this type.
 */
export type StopType = typeof STOP_TYPE_ALL | (string & {});

/**
 * Mode/stop-type invariant — validated in the BE create path and the FE
 * create form. `paper ⇒ stopType === 'ALL'`; `real ⇒ stopType` is a
 * non-empty concrete code (never 'ALL', never empty).
 *
 * Compared on the trim+uppercase-normalized form because the ID segment is
 * ALL-CAPS — 'all'/' ALL ' would otherwise pass as a real code and bake
 * into the ID as the paper-reserved 'ALL' segment.
 */
export function isValidModeStopType(mode: InstanceMode, stopType: StopType): boolean {
  const s = stopType.trim().toUpperCase();
  return mode === 'paper' ? s === STOP_TYPE_ALL : s.length > 0 && s !== STOP_TYPE_ALL;
}

/**
 * `variantRef` sentinel for instances whose variant was composed ad hoc and
 * never saved to the registry — the embedded `variant` snapshot keeps the
 * doc self-describing.
 */
export const MANAGE_ADHOC_VARIANT_REF = 'adhoc';

// ==========================
// Manage Instance doc
// ==========================

/**
 * Manage strategy instance doc (`st-strategy-instances/{id}`).
 *
 * Identity: `{SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}` — the unique key is
 * variant + symbol + stopType, all encoded in the id itself. The doc
 * embeds the resolved variant so it stays self-describing even when the
 * variant is ad hoc or the registry later edits the named variant.
 */
export interface ManageInstance {
  /** Instance ID, e.g. 'QQQ-CDS-30-50-40-ALL' / 'QQQ-CDS-30-50-40-T8'. */
  id: string;
  /** Registry variant id (provenance only), or `MANAGE_ADHOC_VARIANT_REF`
   *  for ad hoc variants. `variant` is authoritative — readers never
   *  dereference this field. */
  variantRef: string;
  /** Embedded variant snapshot — the recipe the instance actually runs.
   *  Pinned at creation so registry edits can't silently rewrite a running
   *  instance; reconciling snapshot-vs-registry drift is a #1539+ concern. */
  variant: ManageVariant;
  symbol: string;
  mode: InstanceMode;
  trigger: InstanceTrigger;
  stopType: StopType;
  runState: InstanceRunState;
  userId: string;
  /** Paper-ledger account binding; required when mode='paper' — enforced
   *  at the BE create path, not by this type. */
  paperAccountId?: string;
  /** ISO of the last routine pass that opened a position for this instance. */
  lastFiredAt?: string;
  createdAt: string;
  updatedAt: string;
  /** ISO of the soft-delete stamp — deleted docs are filtered on read. */
  deletedAt?: string;
}
