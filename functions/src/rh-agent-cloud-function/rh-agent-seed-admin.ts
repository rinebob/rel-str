/**
 * RH Agent Seed Admin Function
 *
 * Functions to seed the rh-agent-symbols collection:
 * - seedRhAgentSymbolsAdmin: Seed top 20 market cap stocks for testing
 * - seedAllSymbolsFromPartner: Fetch and seed ALL symbols from SavantAPI universe
 *
 * HTTP callable - hit once to populate Firestore.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';
import { RH_AGENT_SYMBOLS_COLLECTION } from './rh-agent-config';
import { callPartnerTrackedSymbols } from '../partner-proxy';

// Top 20 largest market cap stocks for initial testing
const TOP_20_SYMBOLS = [
  { symbol: 'AAPL', priority: 1 },
  { symbol: 'MSFT', priority: 2 },
  { symbol: 'NVDA', priority: 3 },
  { symbol: 'AMZN', priority: 4 },
  { symbol: 'GOOGL', priority: 5 },
  { symbol: 'META', priority: 6 },
  { symbol: 'TSLA', priority: 7 },
  { symbol: 'BRK.B', priority: 8 },
  { symbol: 'AVGO', priority: 9 },
  { symbol: 'WMT', priority: 10 },
  { symbol: 'JPM', priority: 11 },
  { symbol: 'V', priority: 12 },
  { symbol: 'MA', priority: 13 },
  { symbol: 'UNH', priority: 14 },
  { symbol: 'HD', priority: 15 },
  { symbol: 'PG', priority: 16 },
  { symbol: 'LLY', priority: 17 },
  { symbol: 'MRK', priority: 18 },
  { symbol: 'JNJ', priority: 19 },
  { symbol: 'XOM', priority: 20 },
];

/**
 * Admin function to seed RH Agent symbols collection.
 * Creates 20 documents in rh-agent-symbols collection.
 */
export const seedRhAgentSymbolsAdmin = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    logger.info('rh_agent_seed_start', { count: TOP_20_SYMBOLS.length });

    try {
      const batch = db.batch();
      const collection = db.collection(RH_AGENT_SYMBOLS_COLLECTION);

      for (const { symbol, priority } of TOP_20_SYMBOLS) {
        const docRef = collection.doc(symbol);
        batch.set(docRef, {
          symbol,
          enabled: true,
          priority,
          createdAt: new Date().toISOString(),
        });
      }

      await batch.commit();

      logger.info('rh_agent_seed_complete', { count: TOP_20_SYMBOLS.length });

      res.status(200).json({
        success: true,
        message: `Seeded ${TOP_20_SYMBOLS.length} symbols`,
        symbols: TOP_20_SYMBOLS.map(s => s.symbol),
        collection: RH_AGENT_SYMBOLS_COLLECTION,
      });
    } catch (error: any) {
      logger.error('rh_agent_seed_failed', { error: error?.message });
      res.status(500).json({
        success: false,
        error: error?.message,
      });
    }
  }
);

/**
 * Clear all symbols (for testing/reset)
 */
export const clearRhAgentSymbolsAdmin = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    logger.info('rh_agent_clear_start');

    try {
      const snapshot = await db.collection(RH_AGENT_SYMBOLS_COLLECTION).get();
      const batch = db.batch();

      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }

      await batch.commit();

      logger.info('rh_agent_clear_complete', { deleted: snapshot.docs.length });

      res.status(200).json({
        success: true,
        message: `Cleared ${snapshot.docs.length} symbols`,
      });
    } catch (error: any) {
      logger.error('rh_agent_clear_failed', { error: error?.message });
      res.status(500).json({
        success: false,
        error: error?.message,
      });
    }
  }
);

/**
 * Fetch ALL symbols from SavantAPI partner and seed to Firestore.
 * This enables the RH Agent to analyze the entire tradeable universe.
 */
export const seedAllSymbolsFromPartner = onRequest(
  {
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    logger.info('rh_agent_seed_all_start');

    try {
      // 1. Fetch all symbols from partner
      logger.info('rh_agent_seed_all_fetching');
      const partnerResponse = await callPartnerTrackedSymbols();

      if (!partnerResponse.ok || !partnerResponse.symbols || partnerResponse.symbols.length === 0) {
        throw new Error('No symbols returned from partner');
      }

      const symbols = partnerResponse.symbols;
      logger.info('rh_agent_seed_all_fetched', { count: symbols.length, sample: symbols.slice(0, 3) });

      // Partner returns objects with symbol property, extract symbol strings
      const symbolStrings = symbols.map((s: any) => {
        if (typeof s === 'string') return s.trim();
        if (s && typeof s === 'object' && s.symbol) return s.symbol.trim();
        return null;
      }).filter((s: string | null): s is string => s !== null && s.length > 0);

      // Filter valid symbols (non-empty strings)
      const validSymbols = symbolStrings.filter((s: string) => s.length > 0);
      logger.info('rh_agent_seed_all_valid', { validCount: validSymbols.length, invalidCount: symbols.length - validSymbols.length });

      if (validSymbols.length === 0) {
        throw new Error('No valid symbols after filtering');
      }

      // 2. Batch write all symbols to Firestore
      const batch = db.batch();
      const collection = db.collection(RH_AGENT_SYMBOLS_COLLECTION);

      for (let i = 0; i < validSymbols.length; i++) {
        const symbol = validSymbols[i].trim();
        const docRef = collection.doc(symbol);
        batch.set(docRef, {
          symbol,
          enabled: true,
          priority: i + 1,  // Preserve order from partner
          createdAt: new Date().toISOString(),
          source: 'partner-universe',
        });
      }

      await batch.commit();

      logger.info('rh_agent_seed_all_complete', {
        count: validSymbols.length,
        firstFew: validSymbols.slice(0, 5),
      });

      res.status(200).json({
        success: true,
        message: `Seeded ${validSymbols.length} symbols from partner universe`,
        count: validSymbols.length,
        firstFew: validSymbols.slice(0, 10),
        collection: RH_AGENT_SYMBOLS_COLLECTION,
      });
    } catch (error: any) {
      logger.error('rh_agent_seed_all_failed', { error: error?.message });
      res.status(500).json({
        success: false,
        error: error?.message,
      });
    }
  }
);
