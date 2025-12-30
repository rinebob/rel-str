import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import type { Request, Response } from 'express';
import { admin, db, FieldValue } from './firebase-admin-init';
import { USERS_COLLECTION, USER_TRADES_COLLECTION } from './webhooks/webhooks-config';

// These must mirror the frontend enums/constants used in trade-journal.types.ts
export enum TradeUpsertOperation {
  CREATE = 'CREATE',
  EDIT = 'EDIT',
}

export const TRADE_STORAGE_ROOT = 'trades';
export const TRADE_USERS_SEGMENT = 'users';

export const TRADE_BUCKET_SCREENSHOTS = 'screenshots';
export const TRADE_BUCKET_BROKER_CSVS = 'brokerCsvs';
export const TRADE_BUCKET_INDICATOR_CSVS = 'indicatorCsvs';

export type TradeStorageBucket =
  | typeof TRADE_BUCKET_SCREENSHOTS
  | typeof TRADE_BUCKET_BROKER_CSVS
  | typeof TRADE_BUCKET_INDICATOR_CSVS;

export interface TradeJournalListItemDto {
  id: string;
  symbol: string;
  direction: string;
  status: string;
  entryDate: string;
  entryPrice?: number | null;
  exitDate?: string | null;
  exitPrice?: number | null;
}

export interface TradeUpsertDto {
  operation: TradeUpsertOperation;
  tradeId: string;
  trade: TradeJournalListItemDto;
  brokerCsvPaths: string[];
  indicatorCsvPaths: string[];
  screenshotPaths: string[];
  deletedBrokerCsvPaths?: string[];
  deletedIndicatorCsvPaths?: string[];
  deletedScreenshotPaths?: string[];
}

export interface TradeUpsertResponse {
  tradeId: string;
}

function isAllowedBucket(bucket: string): bucket is TradeStorageBucket {
  return (
    bucket === TRADE_BUCKET_SCREENSHOTS ||
    bucket === TRADE_BUCKET_BROKER_CSVS ||
    bucket === TRADE_BUCKET_INDICATOR_CSVS
  );
}

function validateStoragePathForUserAndTrade(path: string, uid: string, tradeId: string): boolean {
  if (!path) {
    return false;
  }

  const segments = path.split('/');
  if (segments.length < 5) {
    return false;
  }

  const [root, usersSegment, pathUid, pathTradeId, bucket] = segments;

  if (root !== TRADE_STORAGE_ROOT) {
    return false;
  }

  if (usersSegment !== TRADE_USERS_SEGMENT) {
    return false;
  }

  if (pathUid !== uid) {
    return false;
  }

  if (pathTradeId !== tradeId) {
    return false;
  }

  if (!isAllowedBucket(bucket)) {
    return false;
  }

  return true;
}

export const tradeJournalManager = onRequest({ maxInstances: 10 }, async (req: Request, res: Response): Promise<void> => {
  const origin = req.headers.origin as string | undefined;
  const allowedOrigin = origin || '*';

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const tokenMatch = authHeader.startsWith('Bearer ')
      ? authHeader.substring('Bearer '.length)
      : null;

    if (!tokenMatch) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(tokenMatch);
    const uid = decoded.uid;

    const body = (req.body || {}) as Partial<TradeUpsertDto>;

    if (!body.tradeId || typeof body.tradeId !== 'string') {
      res.status(400).json({ error: 'tradeId is required' });
      return;
    }

    if (!body.trade || typeof body.trade !== 'object') {
      res.status(400).json({ error: 'trade is required' });
      return;
    }

    const operation = body.operation ?? TradeUpsertOperation.EDIT;
    if (operation !== TradeUpsertOperation.CREATE && operation !== TradeUpsertOperation.EDIT) {
      res.status(400).json({ error: 'Invalid operation' });
      return;
    }

    const tradeId = body.tradeId;
    const trade = body.trade as TradeJournalListItemDto;

    const brokerCsvPaths = Array.isArray(body.brokerCsvPaths) ? body.brokerCsvPaths : [];
    const indicatorCsvPaths = Array.isArray(body.indicatorCsvPaths) ? body.indicatorCsvPaths : [];
    const screenshotPaths = Array.isArray(body.screenshotPaths) ? body.screenshotPaths : [];

    const allPaths = [
      ...brokerCsvPaths,
      ...indicatorCsvPaths,
      ...screenshotPaths,
      ...(body.deletedBrokerCsvPaths ?? []),
      ...(body.deletedIndicatorCsvPaths ?? []),
      ...(body.deletedScreenshotPaths ?? []),
    ];

    for (const path of allPaths) {
      if (!validateStoragePathForUserAndTrade(path, uid, tradeId)) {
        res.status(400).json({ error: `Invalid storage path for user or trade: ${path}` });
        return;
      }
    }

    const [datePartRaw, timePartRaw] = String(trade.entryDate || '').split(' ');
    const datePart = datePartRaw || null;
    const timePart = timePartRaw || null;

    const [exitDateRaw, exitTimeRaw] = String(trade.exitDate || '').split(' ');
    const exitDate = exitDateRaw || null;
    const exitTime = exitTimeRaw || null;

    const tradeDocRef = db
      .collection(USERS_COLLECTION)
      .doc(uid)
      .collection(USER_TRADES_COLLECTION)
      .doc(tradeId);

    const payload = {
      tradeId,
      symbol: trade.symbol || null,
      direction: trade.direction || null,
      status: trade.status || null,
      entry: {
        price: typeof trade.entryPrice === 'number' ? trade.entryPrice : null,
        date: datePart,
        time: timePart,
      },
      exit: {
        price: typeof trade.exitPrice === 'number' ? trade.exitPrice : null,
        date: exitDate,
        time: exitTime,
      },
      brokerCsvPaths,
      indicatorCsvPaths,
      screenshotPaths,
      updatedAt: FieldValue.serverTimestamp(),
    } as Record<string, unknown>;

    if (operation === TradeUpsertOperation.CREATE) {
      payload['createdAt'] = FieldValue.serverTimestamp();
    }

    await tradeDocRef.set(payload, { merge: true });

    logger.info('[TradeJournalManager] upserted trade', {
      uid,
      tradeId,
      operation,
      symbol: trade.symbol,
      direction: trade.direction,
      status: trade.status,
    });

    res.status(200).json({ tradeId } satisfies TradeUpsertResponse);
  } catch (err: any) {
    logger.error('[TradeJournalManager] error', err);
    res.status(500).json({ error: 'trade upsert failed', message: String(err?.message ?? err) });
  }
});
