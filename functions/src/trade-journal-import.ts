import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as Busboy from 'busboy';
import type { Request, Response } from 'express';
import { admin, db, FieldValue } from './firebase-admin-init';
import { USERS_COLLECTION, USER_TRADES_COLLECTION } from './webhooks/webhooks-config';

/**
 * Legacy Busboy-based multipart/form-data trade import endpoint.
 *
 * @deprecated Use tradeJournalManager with JSON DTOs and client-side Storage
 * uploads instead. This function is retained temporarily for rollback
 * of the old import pipeline and will be removed in a future cleanup.
 */

interface ParsedFileMeta {
  filename: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

interface ParsedForm {
  fields: Record<string, string>;
  files: Record<string, ParsedFileMeta[]>;
}

function parseJsonStringArray(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as string[]) : [];
  } catch {
    return [];
  }
}

function parseMultipartForm(req: Request): Promise<ParsedForm> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    const busboy = Busboy({ headers: { 'content-type': contentType as string } });
    const fields: Record<string, string> = {};
    const files: Record<string, ParsedFileMeta[]> = {};

    busboy.on('field', (name: string, value: string) => {
      fields[name] = value;
    });

    busboy.on('file', (name: string, file: NodeJS.ReadableStream, info: Busboy.FileInfo) => {
      const { filename, mimeType } = info;
      const chunks: Buffer[] = [];

      file.on('data', (data: Buffer) => {
        chunks.push(data as Buffer);
      });

      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const size = buffer.length;
        if (!files[name]) {
          files[name] = [];
        }
        files[name].push({ filename, mimeType, size, buffer });
      });
    });

    busboy.on('error', (err: Error) => reject(err));
    busboy.on('finish', () => resolve({ fields, files }));

    // In Functions v2, the body is fully buffered on req.rawBody; feed that into Busboy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (rawBody) {
      busboy.end(rawBody);
    } else {
      // Fallback for environments that still stream the request.
      req.pipe(busboy);
    }
  });
}

/**
 * Legacy HTTP handler for trade imports.
 *
 * @deprecated Prefer tradeJournalManager; new callers should not depend on
 * this endpoint. It is kept only so existing clients can be rolled back
 * during the transition.
 */
export const importTrade = onRequest({ maxInstances: 10 }, async (req: Request, res: Response): Promise<void> => {
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
    // Extract Firebase Auth token from Authorization header (Bearer) if present
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

    const { fields, files } = await parseMultipartForm(req);

    const {
      localTradeId,
      symbol,
      direction,
      status,
      entryPrice,
      entryDate,
      entryTime,
      deletedBrokerCsvPaths: deletedBrokerCsvPathsRaw,
      deletedIndicatorCsvPaths: deletedIndicatorCsvPathsRaw,
      deletedScreenshotPaths: deletedScreenshotPathsRaw,
    } = fields;

    const brokerCsvs = files['brokerCsvs'] ?? [];
    const indicatorCsvs = files['indicatorCsvs'] ?? [];
    const screenshots = files['screenshots'] ?? [];

    const bucket = admin.storage().bucket();

    const tradeId = localTradeId || `${uid}-${Date.now()}`;
    const basePath = `trades/users/${uid}/${tradeId}`;

    const uploadGroup = async (
      groupName: 'broker' | 'indicators' | 'screenshots',
      metas: ParsedFileMeta[],
    ): Promise<string[]> => {
      const paths: string[] = [];
      for (const meta of metas) {
        const storagePath = `${basePath}/${groupName}/${meta.filename}`;
        const fileRef = bucket.file(storagePath);
        await fileRef.save(meta.buffer, { contentType: meta.mimeType });
        paths.push(storagePath);
      }
      return paths;
    };

    const [brokerCsvPaths, indicatorCsvPaths, screenshotPaths] = await Promise.all([
      uploadGroup('broker', brokerCsvs),
      uploadGroup('indicators', indicatorCsvs),
      uploadGroup('screenshots', screenshots),
    ]);

    const tradeDocRef = db
      .collection(USERS_COLLECTION)
      .doc(uid)
      .collection(USER_TRADES_COLLECTION)
      .doc(tradeId);

    // Existing paths for edit scenarios
    const existingSnap = await tradeDocRef.get();
    const existingData = existingSnap.exists
      ? (existingSnap.data() as {
          brokerCsvPaths?: string[];
          indicatorCsvPaths?: string[];
          screenshotPaths?: string[];
        })
      : {};

    const existingBrokerCsvPaths: string[] = existingData.brokerCsvPaths ?? [];
    const existingIndicatorCsvPaths: string[] = existingData.indicatorCsvPaths ?? [];
    const existingScreenshotPaths: string[] = existingData.screenshotPaths ?? [];

    const deletedBrokerCsvPaths = parseJsonStringArray(deletedBrokerCsvPathsRaw);
    const deletedIndicatorCsvPaths = parseJsonStringArray(deletedIndicatorCsvPathsRaw);
    const deletedScreenshotPaths = parseJsonStringArray(deletedScreenshotPathsRaw);

    // Delete any Storage objects explicitly marked for deletion
    const deletePaths: string[] = [
      ...deletedBrokerCsvPaths,
      ...deletedIndicatorCsvPaths,
      ...deletedScreenshotPaths,
    ];
    await Promise.all(
      deletePaths
        .filter((p) => !!p)
        .map(async (p) => {
          try {
            await bucket.file(p).delete({ ignoreNotFound: true } as any);
          } catch (err) {
            logger.warn('[TradeImport] failed to delete storage object', { path: p, err });
          }
        }),
    );

    const keptBrokerCsvPaths = existingBrokerCsvPaths.filter((p) => !deletedBrokerCsvPaths.includes(p));
    const keptIndicatorCsvPaths = existingIndicatorCsvPaths.filter(
      (p) => !deletedIndicatorCsvPaths.includes(p),
    );
    const keptScreenshotPaths = existingScreenshotPaths.filter(
      (p) => !deletedScreenshotPaths.includes(p),
    );

    const finalBrokerCsvPaths = [...keptBrokerCsvPaths, ...brokerCsvPaths];
    const finalIndicatorCsvPaths = [...keptIndicatorCsvPaths, ...indicatorCsvPaths];
    const finalScreenshotPaths = [...keptScreenshotPaths, ...screenshotPaths];

    await tradeDocRef.set(
      {
        tradeId,
        localTradeId: localTradeId || null,
        symbol: symbol || null,
        direction: direction || null,
        status: status || null,
        entry: {
          price: entryPrice ? Number(entryPrice) : null,
          date: entryDate || null,
          time: entryTime || null,
        },
        brokerCsvPaths: finalBrokerCsvPaths,
        indicatorCsvPaths: finalIndicatorCsvPaths,
        screenshotPaths: finalScreenshotPaths,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info('[TradeImport] stored trade', {
      uid,
      tradeId,
      localTradeId,
      symbol,
      direction,
      status,
      entryPrice,
      entryDate,
      entryTime,
      brokerCsvPaths: finalBrokerCsvPaths,
      indicatorCsvPaths: finalIndicatorCsvPaths,
      screenshotPaths: finalScreenshotPaths,
    });

    res.status(200).json({ ok: true, tradeId });
  } catch (err: any) {
    logger.error('[TradeImport] error', err);
    res.status(500).json({ error: 'import failed', message: String(err?.message ?? err) });
  }
});
