/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Service that builds and persists an OCC → Robinhood MCP instrument map entry
 * for a selected EOD candidate.
 */

import type { OptionQuote, OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';
import type {
  OccRhInstrumentMapResolver,
  OccRhInstrumentMapWriter,
} from './occ-rh-instrument-map-types';
import {
  buildOccRhInstrumentMapEntry,
  writeOccRhInstrumentMapEntry,
} from './occ-rh-instrument-map-writer';
import { McpOccRhInstrumentMapResolver } from './mcp-instrument-map-resolver';
import { createDefaultOccRhInstrumentMapWriter } from './occ-rh-instrument-map-writer';

export class OccRhInstrumentMapService {
  constructor(
    private readonly resolver: OccRhInstrumentMapResolver = new McpOccRhInstrumentMapResolver(),
    private readonly writer: OccRhInstrumentMapWriter = createDefaultOccRhInstrumentMapWriter(),
  ) {}

  /**
   * Resolve the RH instrument/chain IDs for `quote` and persist the map entry.
   */
  async buildAndPersist(
    quote: OptionQuote,
    firstTradedDate?: string,
  ): Promise<OccRhInstrumentMapEntry> {
    const { instrumentId, chainId } = await this.resolver.resolve(quote);
    const entry = buildOccRhInstrumentMapEntry(
      quote,
      instrumentId,
      chainId,
      firstTradedDate,
    );
    await writeOccRhInstrumentMapEntry(entry, this.writer);
    return entry;
  }
}
