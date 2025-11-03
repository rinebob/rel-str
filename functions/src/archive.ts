import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db } from './firebase-admin-init';
import { PAIRS_COLLECTION, ARCHIVE_COLLECTION_PREFIX } from './webhooks/webhooks-config';
import { RsPhase } from './types/partner';


/**
 * Choose which phase value to emit for a given day using the fixed rubric:
 * - Historical days (day !== today): emit POST only; ignore PRE even if present.
 * - Today (day === today): emit POST if present; else PRE if present; else skip.
 *
 * Notes:
 * - "today" is computed in UTC as new Date().toISOString().slice(0, 10)
 */
export function selectRsForDay(
    row: any,
    day: string,
    todayStr: string,
  ): { value?: number; phase?: RsPhase } {
    const hasPost = Number.isFinite(row?.post?.rs);
    const hasPre = Number.isFinite(row?.pre?.rs);
  
    const postVal = hasPost ? Number(row.post.rs) : undefined;
    const preVal = hasPre ? Number(row.pre.rs) : undefined;
  
    const isToday = day === todayStr;
    if (!isToday) {
      // Historical: strictly POST-only
      if (hasPost) return { value: postVal, phase: RsPhase.POST };
      return {}; // ignore PRE
    }
    // Today: POST if present, else PRE
    if (hasPost) return { value: postVal, phase: RsPhase.POST };
    if (hasPre) return { value: preVal, phase: RsPhase.PRE };
    return {};
  }

/**
 * Callable: getPairRSArchive
 * Reads RS history for a pair from archive shards under
 *   pairs-data/{BASE}-{SYMBOL}/archive-YYYY/{YYMMDD}
 * and returns a compact series for the requested range.
 *
 * Request:
 * { baseline: string; symbol: string; from: 'YYYY-MM-DD'; to: 'YYYY-MM-DD' }
 *
 * Response:
 * { pair: string; items: Array<{ day: string; value: number; phase?: RsPhase }>; count: number }
 */
export const getPairRSArchive = onCall({ region: 'us-central1', timeoutSeconds: 60 }, async (req) => {
  try {
    const baseline = String(req.data?.baseline || '').trim().toUpperCase();
    const symbol = String(req.data?.symbol || '').trim().toUpperCase();
    const fromStr = String(req.data?.from || '').slice(0, 10);
    const toStr = String(req.data?.to || '').slice(0, 10);

    if (!baseline || !symbol || !fromStr || !toStr) {
      return { pair: `${baseline}-${symbol}`, items: [], count: 0 };
    }

    // Helper to build inclusive list of years covered by [from, to]
    const years = () => {
      const y1 = Number(fromStr.slice(0, 4));
      const y2 = Number(toStr.slice(0, 4));
      const out: number[] = [];
      for (let y = y1; y <= y2; y++) out.push(y);
      return out;
    };

    const pairId = `${baseline}-${symbol}`;
    const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

    const items: Array<{ day: string; value: number; phase?: RsPhase }> = [];
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const y of years()) {
      const yearStr = String(y);
      const archiveCol = `${ARCHIVE_COLLECTION_PREFIX}${yearStr}`; // e.g., archive-2025
      const daysCol = pairRef.collection(archiveCol);

      // Optional optimization: narrow server-side by year-bounded from/to so we fetch fewer docs
      const yearFrom = `${yearStr}-01-01`;
      const yearTo = `${yearStr}-12-31`;
      const lower = fromStr > yearFrom ? fromStr : yearFrom;
      const upper = toStr < yearTo ? toStr : yearTo;

      // Order asc so FE can display chronological immediately
      const q = daysCol
        .where('day', '>=', lower)
        .where('day', '<=', upper)
        .orderBy('day', 'asc');

      const snap = await q.get();
      for (const doc of snap.docs) {
        const d = (doc.data() as any) || {};
        const day: string = String(d?.day || '');
        if (!day || day < fromStr || day > toStr) continue;

        const picked = selectRsForDay(d, day, todayStr);
        if (Number.isFinite(picked.value)) {
          items.push({ day, value: Number(picked.value), phase: picked.phase });
        }
      }
    }

    // Ensure chronological order overall
    items.sort((a, b) => a.day.localeCompare(b.day));
    return { pair: pairId, items, count: items.length };
  } catch (e: any) {
    logger.error('getPairRSArchive failed', { message: e?.message, code: e?.code });
    return { pair: String(req.data?.baseline || '').toUpperCase() + '-' + String(req.data?.symbol || '').toUpperCase(), items: [], count: 0 };
  }
});
