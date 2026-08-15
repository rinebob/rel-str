/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * End-to-end nightly EOD selection orchestrator.
 *
 * Coordinates the AV EOD selection pass, OCC → RH instrument map persistence,
 * and overnight delta simulation for a single strategy instance on a given
 * market date.
 */

import type { OptionQuote } from '@options-strategy-engine/contracts';
import type {
  OccRhInstrumentMapEntry,
  OvernightDeltaSimulation,
  StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';
import { runEodSelectionPass } from './selection/eod-selection-pass';
import type { EodSelectionPassResult } from './selection/eod-selection-pass';
import { AvEodOptionQuoteProvider } from './quote-providers/av-eod-option-quote-provider';
import { OccRhInstrumentMapService } from './instrument-map/occ-rh-instrument-map-service';
import { computeOvernightDeltaSimulation } from './pricing/overnight-simulation';
import {
  persistOvernightDeltaSimulation,
  type OvernightSimulationWriter,
  createDefaultOvernightSimulationWriter,
} from './pricing/overnight-simulation-writer';

export interface EodNightlySelectionResult {
  quote: OptionQuote;
  dte: number;
  mapEntry: OccRhInstrumentMapEntry;
  simulation: OvernightDeltaSimulation;
}

export interface EodNightlySelectionDependencies {
  provider?: Pick<AvEodOptionQuoteProvider, 'getEodChain'>;
  mapService?: OccRhInstrumentMapService;
  writeSimulation?: OvernightSimulationWriter;
}

/**
 * Run the full nightly EOD selection workflow for one strategy instance.
 *
 * @returns `null` when no contract satisfies the delta/DTE rules.
 */
export async function runEodNightlySelection(
  marketDate: string,
  config: StrategyInstanceConfig,
  underlyingClose: number,
  instanceId: string,
  deps: EodNightlySelectionDependencies = {},
): Promise<EodNightlySelectionResult | null> {
  const selection: EodSelectionPassResult | null = await runEodSelectionPass(
    marketDate,
    config,
    deps.provider ?? new AvEodOptionQuoteProvider(),
  );

  if (!selection) {
    return null;
  }

  const mapService = deps.mapService ?? new OccRhInstrumentMapService();
  const writeSimulation =
    deps.writeSimulation ?? createDefaultOvernightSimulationWriter();

  const simulation = computeOvernightDeltaSimulation(
    selection.quote,
    underlyingClose,
    selection.dte,
    config,
  );

  const [mapEntry] = await Promise.all([
    mapService.buildAndPersist(selection.quote, marketDate),
    persistOvernightDeltaSimulation(
      instanceId,
      marketDate,
      simulation,
      writeSimulation,
    ),
  ]);

  return {
    quote: selection.quote,
    dte: selection.dte,
    mapEntry,
    simulation,
  };
}
