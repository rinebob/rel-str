/**
 * Utility functions for working with heatmap snapshot shards.
 * 
 * All shards use canonical naming (e.g., SPY-DAILY-2026-H1).
 * The "current" shard is determined by which shard contains today's date in its range.
 */

/**
 * Get the current shard ID for a given timeframe based on today's date.
 * 
 * @param timeframe - The timeframe (DAILY, WEEKLY, or MONTHLY)
 * @returns The shard ID (e.g., '2026-H1', '2025-2026', '2023-2026')
 * 
 * @example
 * getCurrentShardId('DAILY') // Returns '2026-H1' (if current date is in H1 2026)
 * getCurrentShardId('WEEKLY') // Returns '2025-2026'
 * getCurrentShardId('MONTHLY') // Returns '2023-2026'
 */
export function getCurrentShardId(timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY'): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-11

  if (timeframe === 'DAILY') {
    // DAILY shards are 6-month periods (H1: Jan-Jun, H2: Jul-Dec)
    const half = month < 6 ? 1 : 2;
    return `${year}-H${half}`;
  } else if (timeframe === 'WEEKLY') {
    // WEEKLY shards are 2-year periods (e.g., 2025-2026)
    return `${year}-${year + 1}`;
  } else if (timeframe === 'MONTHLY') {
    // MONTHLY shards are 4-year periods (e.g., 2023-2026)
    return `${year - 3}-${year}`;
  }

  throw new Error(`Unsupported timeframe: ${timeframe}`);
}

/**
 * Get the document ID for the current shard.
 * 
 * @param baseline - The baseline symbol (e.g., 'SPY', 'QQQ')
 * @param timeframe - The timeframe (DAILY, WEEKLY, or MONTHLY)
 * @returns The Firestore document ID for the current shard
 * 
 * @example
 * getCurrentShardDocId('SPY', 'DAILY') // Returns 'SPY-DAILY-2026-H1'
 * getCurrentShardDocId('QQQ', 'WEEKLY') // Returns 'QQQ-WEEKLY-2025-2026'
 * getCurrentShardDocId('XLB', 'MONTHLY') // Returns 'XLB-MONTHLY-2023-2026'
 */
export function getCurrentShardDocId(baseline: string, timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY'): string {
  const shardId = getCurrentShardId(timeframe);
  return `${baseline}-${timeframe}-${shardId}`;
}

/**
 * Get all historical shard IDs for a timeframe (excluding the current shard).
 * 
 * @param timeframe - The timeframe (DAILY, WEEKLY, or MONTHLY)
 * @returns Array of shard IDs for historical shards
 * 
 * @example
 * getHistoricalShardIds('DAILY') 
 * // Returns ['2019-H1', '2019-H2', '2020-H1', ..., '2025-H2']
 * // (excludes current shard '2026-H1')
 */
export function getHistoricalShardIds(timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY'): string[] {
  const currentShardId = getCurrentShardId(timeframe);
  const today = new Date();
  const currentYear = today.getFullYear();
  const shards: string[] = [];

  if (timeframe === 'DAILY') {
    // Generate all half-year shards from 2019 to current (excluding current)
    for (let year = 2019; year <= currentYear; year++) {
      for (let half = 1; half <= 2; half++) {
        const shardId = `${year}-H${half}`;
        if (shardId !== currentShardId) {
          shards.push(shardId);
        }
      }
    }
  } else if (timeframe === 'WEEKLY') {
    // Generate all 2-year shards from 2019 to current (excluding current)
    for (let year = 2019; year <= currentYear; year += 2) {
      const shardId = `${year}-${year + 1}`;
      if (shardId !== currentShardId) {
        shards.push(shardId);
      }
    }
  } else if (timeframe === 'MONTHLY') {
    // Generate all 4-year shards from 2019 to current (excluding current)
    for (let year = 2019; year <= currentYear; year += 4) {
      const shardId = `${year}-${year + 3}`;
      if (shardId !== currentShardId) {
        shards.push(shardId);
      }
    }
  }

  return shards;
}

/**
 * Get all shard document IDs for a baseline and timeframe.
 * 
 * @param baseline - The baseline symbol (e.g., 'SPY', 'QQQ')
 * @param timeframe - The timeframe (DAILY, WEEKLY, or MONTHLY)
 * @returns Object containing current shard ID and array of historical shard IDs
 * 
 * @example
 * getAllShardDocIds('SPY', 'DAILY')
 * // Returns:
 * // {
 * //   current: 'SPY-DAILY-2026-H1',
 * //   historical: [
 * //     'SPY-DAILY-2019-H1',
 * //     'SPY-DAILY-2019-H2',
 * //     ...
 * //     'SPY-DAILY-2025-H2'
 * //   ]
 * // }
 */
export function getAllShardDocIds(
  baseline: string,
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY'
): {
  current: string;
  historical: string[];
} {
  const currentShardId = getCurrentShardId(timeframe);
  const historicalShardIds = getHistoricalShardIds(timeframe);

  return {
    current: `${baseline}-${timeframe}-${currentShardId}`,
    historical: historicalShardIds.map(id => `${baseline}-${timeframe}-${id}`),
  };
}

/**
 * Parse a shard document ID to extract its components.
 * 
 * @param docId - The shard document ID (e.g., 'SPY-DAILY-hist-2026-H1')
 * @returns Object containing baseline, timeframe, and shardId, or null if invalid
 * 
 * @example
 * parseShardDocId('SPY-DAILY-2026-H1')
 * // Returns: { baseline: 'SPY', timeframe: 'DAILY', shardId: '2026-H1' }
 */
export function parseShardDocId(docId: string): {
  baseline: string;
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  shardId: string;
} | null {
  const match = docId.match(/^([A-Z]+)-(DAILY|WEEKLY|MONTHLY)-(.+)$/);
  if (!match) {
    return null;
  }

  return {
    baseline: match[1],
    timeframe: match[2] as 'DAILY' | 'WEEKLY' | 'MONTHLY',
    shardId: match[3],
  };
}

/**
 * Check if a shard ID represents the current shard for a given timeframe.
 * 
 * @param shardId - The shard ID to check (e.g., '2026-H1')
 * @param timeframe - The timeframe (DAILY, WEEKLY, or MONTHLY)
 * @returns True if the shard ID is the current shard
 * 
 * @example
 * isCurrentShard('2026-H1', 'DAILY') // Returns true (if current date is in H1 2026)
 * isCurrentShard('2025-H2', 'DAILY') // Returns false
 */
export function isCurrentShard(shardId: string, timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY'): boolean {
  return shardId === getCurrentShardId(timeframe);
}
