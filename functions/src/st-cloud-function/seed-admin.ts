/**
 * ST Seed Admin Function
 *
 * Functions to manage the symbol-meta collection:
 * - clearStSymbolsAdmin: Clear all symbols (for testing/reset)
 * - seedAllSymbolsFromPartner: Fetch and seed ALL symbols from SavantAPI universe
 *
 * HTTP callable - hit once to populate Firestore.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';
import { ST_SYMBOLS_COLLECTION, StSymbol, StSymbolSource } from '../common/st-collections';
import { callPartnerTrackedSymbols } from '../partner-proxy';

/**
 * Clear all symbols (for testing/reset)
 */
export const clearStSymbolsAdmin = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    logger.info('st_clear_start');

    try {
      const snapshot = await db.collection(ST_SYMBOLS_COLLECTION).get();
      const batch = db.batch();

      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }

      await batch.commit();

      logger.info('st_clear_complete', { deleted: snapshot.docs.length });

      res.status(200).json({
        success: true,
        message: `Cleared ${snapshot.docs.length} symbols`,
      });
    } catch (error: any) {
      logger.error('st_clear_failed', { error: error?.message });
      res.status(500).json({
        success: false,
        error: error?.message,
      });
    }
  }
);

/**
 * Fetch ALL symbols from SavantAPI partner and seed to Firestore.
 * This enables the ST to analyze the entire tradeable universe.
 */
export const seedAllSymbolsFromPartner = onRequest(
  {
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    logger.info('st_seed_all_start');

    try {
      // 1. Fetch all symbols from partner
      logger.info('st_seed_all_fetching');
      const partnerResponse = await callPartnerTrackedSymbols();

      if (!partnerResponse.ok || !partnerResponse.symbols || partnerResponse.symbols.length === 0) {
        throw new Error('No symbols returned from partner');
      }

      const symbols = partnerResponse.symbols;
      logger.info('st_seed_all_fetched', { count: symbols.length, sample: symbols.slice(0, 3) });

      // Partner returns objects with symbol property, extract symbol strings
      const symbolStrings = symbols.map((s: any) => {
        if (typeof s === 'string') return s.trim();
        if (s && typeof s === 'object' && s.symbol) return s.symbol.trim();
        return null;
      }).filter((s: string | null): s is string => s !== null && s.length > 0);

      // Filter valid symbols (non-empty strings)
      const validSymbols = symbolStrings.filter((s: string) => s.length > 0);
      logger.info('st_seed_all_valid', { validCount: validSymbols.length, invalidCount: symbols.length - validSymbols.length });

      if (validSymbols.length === 0) {
        throw new Error('No valid symbols after filtering');
      }

      // 2. Batch write all symbols to Firestore
      const batch = db.batch();
      const collection = db.collection(ST_SYMBOLS_COLLECTION);

      for (let i = 0; i < validSymbols.length; i++) {
        const symbol = validSymbols[i].trim();
        const docRef = collection.doc(symbol);
        const symbolDoc: StSymbol = {
          symbol,
          enabled: true,
          createdAt: new Date().toISOString(),
          source: StSymbolSource.PARTNER_UNIVERSE,
        };
        batch.set(docRef, symbolDoc);
      }

      await batch.commit();

      logger.info('st_seed_all_complete', {
        count: validSymbols.length,
        firstFew: validSymbols.slice(0, 5),
      });

      res.status(200).json({
        success: true,
        message: `Seeded ${validSymbols.length} symbols from partner universe`,
        count: validSymbols.length,
        firstFew: validSymbols.slice(0, 10),
        collection: ST_SYMBOLS_COLLECTION,
      });
    } catch (error: any) {
      logger.error('st_seed_all_failed', { error: error?.message });
      res.status(500).json({
        success: false,
        error: error?.message,
      });
    }
  }
);
