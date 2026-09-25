/**
 *
 * Service that builds, reads, and backfills an OCC → Robinhood MCP instrument
 * map entry for a selected EOD candidate or an open position mark lookup.
 */

import type { OptionContractRef, OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';
import type {
  OccRhInstrumentMapReader,
  OccRhInstrumentMapResolver,
  OccRhInstrumentMapWriter,
} from './occ-rh-instrument-map-types';
import {
  buildOccRhInstrumentMapEntry,
  writeOccRhInstrumentMapEntry,
} from './occ-rh-instrument-map-writer';
import { McpOccRhInstrumentMapResolver } from './mcp-instrument-map-resolver';
import { createDefaultOccRhInstrumentMapWriter } from './occ-rh-instrument-map-writer';
import { createDefaultOccRhInstrumentMapReader } from './occ-rh-instrument-map-reader';
import { createLogger } from '../logging';

const logger = createLogger('OccRhInstrumentMapService');

export class OccRhInstrumentMapService {
  constructor(
    private readonly resolver: OccRhInstrumentMapResolver = new McpOccRhInstrumentMapResolver(),
    private readonly writer: OccRhInstrumentMapWriter = createDefaultOccRhInstrumentMapWriter(),
    private readonly reader: OccRhInstrumentMapReader = createDefaultOccRhInstrumentMapReader(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Read an existing map entry by OCC ID.
   */
  async get(occId: string): Promise<OccRhInstrumentMapEntry | null> {
    return this.reader(occId);
  }

  /**
   * Return the existing map entry if it is fresh; otherwise resolve and persist.
   */
  async getOrResolve(
    quote: OptionContractRef,
    firstTradedDate?: string,
  ): Promise<OccRhInstrumentMapEntry> {
    const existing = await this.get(quote.contractID);
    if (existing && !this.isExpired(existing)) {
      return existing;
    }

    const preservedFirstTradedDate = firstTradedDate ?? existing?.firstTradedDate;
    const { instrumentId, chainId } = await this.resolver.resolve(quote);
    const entry = buildOccRhInstrumentMapEntry(
      quote,
      instrumentId,
      chainId,
      preservedFirstTradedDate,
    );
    await writeOccRhInstrumentMapEntry(entry, this.writer);
    return entry;
  }

  /**
   * Resolve the RH instrument/chain IDs for `quote` and persist the map entry.
   * If an existing entry is present and still fresh, only overwrite when the
   * resolved instrument or chain ID has changed, and log the update.
   */
  async buildAndPersist(
    quote: OptionContractRef,
    firstTradedDate?: string,
  ): Promise<OccRhInstrumentMapEntry> {
    const { instrumentId, chainId } = await this.resolver.resolve(quote);
    const entry = buildOccRhInstrumentMapEntry(
      quote,
      instrumentId,
      chainId,
      firstTradedDate,
    );

    const existing = await this.get(quote.contractID);
    if (
      existing &&
      !this.isExpired(existing) &&
      existing.instrumentId === entry.instrumentId &&
      existing.chainId === entry.chainId
    ) {
      return existing;
    }

    if (existing) {
      logger.info(
        `${quote.contractID}: updating instrument ` +
          `${existing.instrumentId} -> ${entry.instrumentId}, chain ` +
          `${existing.chainId} -> ${entry.chainId}`,
      );
    }

    await writeOccRhInstrumentMapEntry(entry, this.writer);
    return entry;
  }

  private isExpired(entry: OccRhInstrumentMapEntry): boolean {
    return new Date(entry.expiresAt).getTime() <= this.now().getTime();
  }
}
