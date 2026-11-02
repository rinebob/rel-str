/**
 * Exit-strategy registry (Topic #1238, Thread #1266).
 *
 * Code-curated, imported directly by the BE analyzer worker (evaluator
 * dispatch) and the FE results UI (labels + ordering) — no listing callable.
 * A strategy is an `exitId` + evaluator `kind` + params; every registered
 * strategy is evaluated independently over each contract's full series
 * through expiry — one strategy firing never truncates another's scan.
 *
 * Adding a strategy = a registry entry (+ its kind's evaluator if new) —
 * bump EXIT_REGISTRY_VERSION so stale result docs are detectable.
 *
 * Seed list is provisional pending the user's final list.
 */

interface ExitStrategyBase {
  /** 'target-90', 'price-100', 'stop-200', 'dte-21', 'expiry'. */
  exitId: string;
  /** UI label, e.g. 'Target 90% premium'. */
  label: string;
  /** UI ordering (aggregate-table row order). */
  order: number;
}

/** Exit when mark <= entryMark * (1 - pct/100) — profit target. */
export interface TargetPctPremiumExit extends ExitStrategyBase {
  kind: 'target-pct-premium';
  params: { pct: number };
}

/** Exit when mark <= price — absolute mark level (e.g. $1.00, $0.50). */
export interface AbsolutePriceExit extends ExitStrategyBase {
  kind: 'absolute-price';
  params: { price: number };
}

/** Exit when mark >= entryMark * (pct/100) — loss stop (pct > 100). */
export interface StopPctPremiumExit extends ExitStrategyBase {
  kind: 'stop-pct-premium';
  params: { pct: number };
}

/** Exit when remaining DTE <= dte — time stop. */
export interface DteTimeExit extends ExitStrategyBase {
  kind: 'dte-time';
  params: { dte: number };
}

/** Never exits — absorbs the expiry outcome record. */
export interface HoldToExpiryExit extends ExitStrategyBase {
  kind: 'hold-to-expiry';
  params: Record<string, never>;
}

/**
 * A registered exit strategy — discriminated union on `kind` (same pattern
 * as `ContractListRow`): each kind's required params are structural, so
 * `{ kind: 'absolute-price', params: {} }` can't compile.
 */
export type ExitStrategyDef =
  | TargetPctPremiumExit
  | AbsolutePriceExit
  | StopPctPremiumExit
  | DteTimeExit
  | HoldToExpiryExit;

/** Evaluator kinds — the BE worker switch-dispatches on these. Derived from
 *  the union so it can't drift when a variant is added. */
export type ExitStrategyKind = ExitStrategyDef['kind'];

/** Bumped whenever a rule is added/removed/re-parameterized — result docs
 *  are stamped with it so stale results are detectable. */
export const EXIT_REGISTRY_VERSION = 1;

export const EXIT_STRATEGIES: readonly ExitStrategyDef[] = [
  {
    exitId: 'target-90',
    kind: 'target-pct-premium',
    params: { pct: 90 },
    label: 'Target 90% premium',
    order: 10,
  },
  {
    exitId: 'price-100',
    kind: 'absolute-price',
    params: { price: 1.0 },
    label: 'Exit at $1.00',
    order: 20,
  },
  {
    exitId: 'price-50',
    kind: 'absolute-price',
    params: { price: 0.5 },
    label: 'Exit at $0.50',
    order: 30,
  },
  {
    exitId: 'stop-200',
    kind: 'stop-pct-premium',
    params: { pct: 200 },
    label: 'Stop at 200% premium',
    order: 40,
  },
  {
    exitId: 'dte-21',
    kind: 'dte-time',
    params: { dte: 21 },
    label: 'Exit at 21 DTE',
    order: 50,
  },
  {
    exitId: 'expiry',
    kind: 'hold-to-expiry',
    params: {},
    label: 'Hold to expiration',
    order: 60,
  },
];

/** Look up an exit strategy by id; undefined on miss. */
export function getExitStrategy(exitId: string): ExitStrategyDef | undefined {
  return EXIT_STRATEGIES.find((e) => e.exitId === exitId);
}
