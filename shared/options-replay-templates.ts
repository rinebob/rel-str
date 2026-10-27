/**
 * Selection Replay template registry (Topic #1238, Thread #1240).
 *
 * Code-curated, imported directly by FE (run-dialog picker) and BE
 * (`optionsReplayStart` validation) — no listing callable. A template is a
 * display name + order side mapped to a pick-doc coordinate; the pick doc
 * itself is direction-neutral, so `side` is stamped here, at write time.
 *
 * The registry may later wrap an SA-side enumeration if the pick-doc grid
 * proves enumerable — the `ReplayTemplate` shape doesn't change.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import type { ReplayTemplate } from './options-replay-contracts';

export const REPLAY_TEMPLATES: readonly ReplayTemplate[] = [
  {
    id: 'csp-45-20',
    name: '45DTE 20Δ put (CSP)',
    description: 'Sell one 45DTE 20-delta put each trading day — cash-secured-put ladder.',
    side: TradeSide.SHORT,
    coordinate: {
      type: OptionType.PUT,
      targetDelta: -0.2,
      expiry: { mode: 'nearestDte', dte: 45 },
    },
  },
  {
    id: 'csp-30-30',
    name: '30DTE 30Δ put (CSP)',
    description: 'Sell one 30DTE 30-delta put each trading day — closer cash-secured-put ladder.',
    side: TradeSide.SHORT,
    coordinate: {
      type: OptionType.PUT,
      targetDelta: -0.3,
      expiry: { mode: 'nearestDte', dte: 30 },
    },
  },
];

/** Look up a template by id; undefined on miss. */
export function getReplayTemplate(id: string): ReplayTemplate | undefined {
  return REPLAY_TEMPLATES.find((t) => t.id === id);
}
