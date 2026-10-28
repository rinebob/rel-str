/**
 * Backfill canonical `st-signals` occurrence docs from the legacy
 * signal-history + run-ids subcollections (task #1001, IMPL-BE Phase 1 §2).
 *
 * Sources (per symbol, `savant-trader/data/symbols/{SYM}`):
 *   - signal-history/{barDate} — nightly canonicalized CONFIRMED entries
 *     (each entry carries `sourceRunId`)
 *   - run-ids/{runId} — every run's detections (intraday INTERIM +
 *     nightly). Occurrences absent from history stay INTERIM.
 *
 * Target: `st-signals/{SYM}_{barDate}_{signalType}` — same shape and
 * semantics as the #1000 dual-write. Aggregation rules:
 *   - one doc per occurrence across every run that detected it
 *   - `runIds` = union of all detecting runIds + recorded sourceRunIds
 *   - `status` = CONFIRMED when any mapped history entry is non-INTERIM
 *     (signal-history holds INTERIM weekly re-detections — presence alone
 *     does not confirm) or any run entry is already CONFIRMED, else INTERIM
 *   - `sourceRunId`/`marketDate`/`createdAt` = FIRST detection (earliest
 *     run-ids `startedAt`; falls back to the history entry's sourceRunId)
 *   - payload (direction/timeframe/indicators) prefers the history entry
 *   - existing docs are never clobbered: merge unions runIds, upgrades
 *     INTERIM→CONFIRMED, and never touches create-only provenance or
 *     downgrades status
 *
 * Usage (from functions/):
 *   npx tsx scripts/backfill-st-signals-1001.ts [--dry-run] [--symbol SYM]
 *
 *   --dry-run   aggregate + print per-symbol counts, write nothing
 *   --symbol    restrict to one symbol (e.g. ADPT)
 *
 * Requires Application Default Credentials (writes st-signals).
 * Run OUTSIDE live-run windows — a concurrent dual-write create can race
 * the same doc and overwrite first-detection provenance.
 */
import { pathToFileURL } from 'node:url';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../src/firebase-admin-init';
import {
  ST_SYMBOLS_COLLECTION,
  ST_SYMBOLS_ROOT,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_SIGNAL_HISTORY_SUBCOLLECTION,
  ST_SIGNALS_ROOT,
} from '../src/common/st-collections';
import { signalEntriesFromDoc, StSignalEntry } from '../src/st-cloud-function/signals';
import { stSignalOccurrenceId } from '@st/ids';
import { normalizeStSignalDirection } from '@st/signals';
import { TradeSide } from '../../shared/common';

const BATCH_LIMIT = 400;

// ---------------------------------------------------------------------------
// Aggregation (pure — unit-tested, shared with the backfill verify script)
// ---------------------------------------------------------------------------

export interface RawRunDoc {
  runId: string;
  marketDate?: string;
  startedAt?: string;
  entries: Record<string, StSignalEntry>;
}

export interface RawHistoryDoc {
  barDate: string;
  entries: Record<string, StSignalEntry & { sourceRunId?: string }>;
}

export interface OccurrenceAggregate {
  id: string;
  symbol: string;
  signalType: string;
  barDate: string;
  marketDate: string;
  direction: TradeSide | null;
  timeframe: string;
  indicators: Record<string, number | string | null>;
  status: 'INTERIM' | 'CONFIRMED';
  /** Every run that detected this occurrence — sorted, deduped. */
  runIds: string[];
  /** First detection's runId. */
  sourceRunId: string;
  /** First detection run's startedAt (ISO) — stamped as createdAt. */
  createdAtIso?: string;
}

export function aggregateOccurrences(
  symbol: string,
  historyDocs: RawHistoryDoc[],
  runDocs: RawRunDoc[],
): { occurrences: Map<string, OccurrenceAggregate>; malformed: string[]; notes: string[] } {
  const sym = symbol.toUpperCase();
  const malformed: string[] = [];
  const notes: string[] = [];

  interface Bucket {
    signalType: string;
    barDate: string;
    runs: { runId: string; marketDate?: string; startedAt?: string; entry: StSignalEntry }[];
    history?: StSignalEntry & { sourceRunId?: string };
    /** Every history entry's recorded sourceRunId — multiple history
     *  docs can map to one bucket (weekly re-dating), and each nightly
     *  run that canonicalized it belongs in runIds even though only the
     *  last entry wins the payload. */
    historyRunIds: Set<string>;
    /** Any mapped history entry with status !== 'INTERIM' — the payload
     *  is last-wins, but confirmation is any-wins: a trailing INTERIM
     *  re-detection can't hide an earlier CONFIRMED canonicalization. */
    historyConfirmed: boolean;
  }
  const buckets = new Map<string, Bucket>();

  const bucketFor = (barDate: string, signalType: string): Bucket | null => {
    let id: string;
    try {
      id = stSignalOccurrenceId(sym, barDate, signalType);
    } catch (err) {
      malformed.push(`${sym} barDate='${barDate}' type='${signalType}' — ${String(err)}`);
      return null;
    }
    const b = buckets.get(id) ?? { signalType, barDate, runs: [], historyRunIds: new Set(), historyConfirmed: false };
    buckets.set(id, b);
    return b;
  };

  for (const doc of runDocs) {
    for (const [key, e] of Object.entries(doc.entries)) {
      bucketFor(e.barDate, e.signalType ?? key)?.runs.push({
        runId: doc.runId,
        marketDate: doc.marketDate,
        startedAt: doc.startedAt,
        entry: e,
      });
    }
  }
  for (const doc of historyDocs) {
    for (const [key, e] of Object.entries(doc.entries)) {
      // Prefer entry.barDate — the #1000 dual-write mints occurrence ids
      // from it; older prod docs (e.g. generated weekly history) can carry
      // a doc-id barDate that differs (week-open vs re-dated fire-day).
      const b = bucketFor(e.barDate ?? doc.barDate, e.signalType ?? key);
      if (b) {
        b.history = e;
        // Absent status counts as confirmed — older generated docs
        // predate the field but carry the history doc's EOD semantics.
        if (e.status !== 'INTERIM') b.historyConfirmed = true;
        if (e.sourceRunId) b.historyRunIds.add(e.sourceRunId);
      }
      if (e.barDate && doc.barDate && e.barDate !== doc.barDate) {
        notes.push(
          `${sym} history/${doc.barDate} signals.${e.signalType ?? key} — ` +
          `entry.barDate ${e.barDate} re-dated from doc-id ${doc.barDate} ` +
          `(minted ${b?.barDate})`,
        );
      }
    }
  }

  const occurrences = new Map<string, OccurrenceAggregate>();
  for (const [id, b] of buckets) {
    // Earliest startedAt is first detection; missing/unparseable sorts last.
    const ts = (r: { startedAt?: string }) =>
      typeof r.startedAt === 'string' && r.startedAt && !isNaN(Date.parse(r.startedAt))
        ? r.startedAt
        : '9999';
    const sorted = [...b.runs].sort((a, c) => {
      const ta = ts(a);
      const tc = ts(c);
      return ta === tc ? a.runId.localeCompare(c.runId) : ta.localeCompare(tc);
    });
    for (const r of b.runs) {
      if (r.startedAt !== undefined && ts(r) === '9999') {
        notes.push(`${id} run-ids/${r.runId} — startedAt '${r.startedAt}' unparseable, ignored for first-detection`);
      }
    }
    const first = sorted[0];
    const payload = b.history ?? first?.entry;
    if (!payload) continue;

    const runIds = new Set<string>(b.runs.map((r) => r.runId));
    for (const r of b.historyRunIds) runIds.add(r);
    // First detection: the earliest run with a real startedAt; when no run
    // carries one (legacy docs predate the field) the history entry's
    // recorded sourceRunId is better evidence than an alphabetical pick.
    const timedFirst = first && ts(first) !== '9999' ? first : undefined;
    const sourceRunId =
      timedFirst?.runId ?? b.history?.sourceRunId ?? first?.runId ?? '';
    const marketDate = timedFirst
      ? (str(timedFirst.marketDate) ?? str(timedFirst.entry.marketDate) ?? b.barDate)
      : (str(b.history?.marketDate) ??
        (first && (str(first.marketDate) ?? str(first.entry.marketDate))) ??
        b.barDate);

    const direction = normalizeStSignalDirection(payload.direction);
    if (!direction) {
      malformed.push(`${id} — direction '${payload.direction}' not normalizable`);
      continue;
    }
    if (runIds.size === 0) {
      malformed.push(`${id} — no detecting run (history entry lacks sourceRunId)`);
      continue;
    }
    occurrences.set(id, {
      id,
      symbol: sym,
      signalType: b.signalType,
      barDate: b.barDate,
      marketDate,
      direction,
      timeframe: payload.timeframe,
      indicators: payload.indicators ?? {},
      // History presence alone does NOT confirm: signal-history is written
      // for every nightly entry (writeSignalHistoryDoc has no status
      // filter), so a W/M signal re-detected on an open bar lands there
      // INTERIM. historyConfirmed is any-wins across every mapped history
      // entry — a trailing INTERIM re-detection can't hide an earlier
      // CONFIRMED canonicalization.
      status:
        b.historyConfirmed || b.runs.some((r) => r.entry.status === 'CONFIRMED')
          ? 'CONFIRMED'
          : 'INTERIM',
      runIds: [...runIds].sort(),
      sourceRunId,
      createdAtIso: timedFirst?.startedAt,
    });
  }
  return { occurrences, malformed, notes };
}

/**
 * Merge payload for an EXISTING canonical doc — emits `{status:'CONFIRMED'}`
 * when the aggregate confirms, `{}` otherwise (never a downgrade, never
 * touches create-only provenance). runIds are unioned separately by the
 * caller via updateForExisting.
 */
export function payloadForExisting(agg: OccurrenceAggregate): Record<string, unknown> {
  return agg.status === 'CONFIRMED' ? { status: 'CONFIRMED' } : {};
}

/**
 * Merge decision for an EXISTING canonical doc — returns null when the
 * write would be a no-op, else {newRuns, upgrades}. Pure so the three
 * branches (no-change / runIds-only / upgrade-only) are unit-testable;
 * the caller adds FieldValue sentinels + guards the empty arrayUnion.
 */
export function updateForExisting(
  agg: OccurrenceAggregate,
  prior: FirebaseFirestore.DocumentData,
): { newRuns: string[]; upgrades: boolean } | null {
  const priorRunIds = Array.isArray(prior.runIds) ? (prior.runIds as string[]) : [];
  const existingRuns = new Set(priorRunIds);
  const newRuns = agg.runIds.filter((r) => !existingRuns.has(r));
  const upgrades = agg.status === 'CONFIRMED' && prior.status !== 'CONFIRMED';
  return newRuns.length === 0 && !upgrades ? null : { newRuns, upgrades };
}

/**
 * Full canonical field set for a NEW doc. The caller writes runIds via
 * arrayUnion (not this literal array — it's the same values, the sentinel
 * just survives a racing union), stamps createdAt (first-detection ISO
 * when parseable), and updatedAt.
 */
export function payloadForNew(agg: OccurrenceAggregate): Record<string, unknown> {
  return {
    symbol: agg.symbol,
    signalType: agg.signalType,
    barDate: agg.barDate,
    marketDate: agg.marketDate,
    direction: agg.direction,
    timeframe: agg.timeframe,
    indicators: agg.indicators,
    status: agg.status,
    sourceRunId: agg.sourceRunId,
    runIds: agg.runIds,
    ticketIds: [],
    positionGroupIds: [],
  };
}

// ---------------------------------------------------------------------------
// Firestore plumbing
// ---------------------------------------------------------------------------

/** Only real non-empty strings pass — prod fields occasionally arrive as
 * Timestamps/numbers and would crash sorts or be written verbatim. */
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : undefined;

export interface SymbolInputs {
  historyDocs: RawHistoryDoc[];
  runDocs: RawRunDoc[];
  /** signal values present in the raw docs that signalEntriesFromDoc
   *  dropped as non-entry-shaped (missing barDate/direction) — reported
   *  as malformed so skipped legacy data can't silently pass the audit. */
  dropped: string[];
}

/**
 * Signal-type keys the entry reader would see but reject — mirrors
 * signalEntriesFromDoc's flattening of `signals.{type}` top-level keys
 * and the nested `signals` map without re-running its isEntry check.
 */
export function droppedSignalTypes(
  data: FirebaseFirestore.DocumentData | undefined,
): string[] {
  const seen = new Set<string>();
  for (const [k, v] of Object.entries(data ?? {})) {
    if (k.startsWith('signals.')) seen.add(k.slice('signals.'.length));
    else if (k === 'signals' && v && typeof v === 'object' && !('barDate' in v)) {
      for (const tk of Object.keys(v)) seen.add(tk);
    } else if (k === 'signals') {
      // Scalar/array/entry-shaped `signals` value — the reader can't map
      // it, so whatever it holds is dropped entirely.
      seen.add('(signals field itself)');
    }
  }
  const extracted = new Set(Object.keys(signalEntriesFromDoc(data ?? {})));
  return [...seen].filter((t) => !extracted.has(t));
}

/** Load a symbol's legacy signal docs into the raw aggregation inputs. */
export async function loadSymbolInputs(
  firestore: FirebaseFirestore.Firestore,
  symbol: string,
): Promise<SymbolInputs> {
  const symRef = firestore.collection(ST_SYMBOLS_COLLECTION).doc(symbol);
  const [histSnap, runSnap] = await Promise.all([
    symRef.collection(ST_SIGNAL_HISTORY_SUBCOLLECTION).get(),
    symRef.collection(ST_RUN_IDS_SUBCOLLECTION).get(),
  ]);
  const dropped: string[] = [];
  return {
    historyDocs: histSnap.docs.map((d) => {
      for (const t of droppedSignalTypes(d.data())) {
        dropped.push(`signal-history/${d.id}: signals.${t} not entry-shaped`);
      }
      return {
        barDate: d.id,
        entries: signalEntriesFromDoc(d.data()) as RawHistoryDoc['entries'],
      };
    }),
    runDocs: runSnap.docs.map((d) => {
      for (const t of droppedSignalTypes(d.data())) {
        dropped.push(`run-ids/${d.id}: signals.${t} not entry-shaped`);
      }
      return {
        runId: d.id,
        marketDate: str(d.get('marketDate')),
        startedAt: str(d.get('startedAt')),
        entries: signalEntriesFromDoc(d.data()),
      };
    }),
    dropped,
  };
}

interface WriteStats {
  created: number;
  updated: number;
  unchanged: number;
}

const READ_CHUNK = 100;

async function writeSymbolOccurrences(
  firestore: FirebaseFirestore.Firestore,
  occurrences: Map<string, OccurrenceAggregate>,
  dryRun: boolean,
): Promise<WriteStats> {
  const col = firestore.collection(ST_SIGNALS_ROOT);
  const stats: WriteStats = { created: 0, updated: 0, unchanged: 0 };
  let batch = firestore.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) {
      await batch.commit();
      batch = firestore.batch();
      pending = 0;
    }
  };

  // Existence reads in getAll chunks (~100 refs) INTERLEAVED with writes —
  // one upfront snapshot would stretch the read→commit window across the
  // whole symbol; chunk-local reads shrink the racing-dual-write TOCTOU
  // to one chunk's processing + one commit (still run outside live
  // windows — a merge can't express set-if-absent for provenance/status,
  // and ticketIds/positionGroupIds stay literal [] on the create path).
  const aggs = [...occurrences.values()];
  for (let i = 0; i < aggs.length; i += READ_CHUNK) {
    const chunk = aggs.slice(i, i + READ_CHUNK);
    const snaps = await firestore.getAll(...chunk.map((a) => col.doc(a.id)));
    const existing = new Map<string, FirebaseFirestore.DocumentData>();
    snaps.forEach((s, j) => {
      if (s.exists) existing.set(chunk[j].id, s.data() ?? {});
    });

    for (const agg of chunk) {
      const ref = col.doc(agg.id);
      const prior = existing.get(agg.id);
      if (!prior) {
        stats.created++;
        if (!dryRun) {
          const createdMs = agg.createdAtIso ? Date.parse(agg.createdAtIso) : NaN;
          // runIds via arrayUnion (creates the field when absent) — a
          // literal array would silently drop a runId unioned by a racing
          // dual-write between the getAll and this commit.
          const { runIds: _drop, ...rest } = payloadForNew(agg);
          batch.set(
            ref,
            {
              ...rest,
              runIds: FieldValue.arrayUnion(...agg.runIds),
              createdAt: Number.isFinite(createdMs)
                ? Timestamp.fromMillis(createdMs)
                : FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          pending++;
        }
      } else {
        const update = updateForExisting(agg, prior);
        if (!update) {
          stats.unchanged++;
          continue;
        }
        stats.updated++;
        if (!dryRun) {
          const fields: Record<string, unknown> = {
            ...payloadForExisting(agg),
            updatedAt: FieldValue.serverTimestamp(),
          };
          // arrayUnion() throws on zero elements — only emit when there's
          // a run the doc doesn't already carry.
          if (update.newRuns.length > 0) {
            fields.runIds = FieldValue.arrayUnion(...update.newRuns);
          }
          batch.set(ref, fields, { merge: true });
          pending++;
        }
      }
      if (pending >= BATCH_LIMIT) await flush();
    }
  }
  await flush();
  return stats;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const symArg = process.argv.find((a) => a === '--symbol' || a.startsWith('--symbol='));
  let onlySymbol: string | undefined;
  if (symArg) {
    const raw = symArg.includes('=')
      ? symArg.split('=')[1]
      : process.argv[process.argv.indexOf(symArg) + 1];
    if (!raw || raw.startsWith('--')) {
      console.error('--symbol requires a value — refusing to run all symbols on a fat-fingered flag');
      process.exit(1);
    }
    onlySymbol = raw.toUpperCase();
  }

  let symbols: string[];
  if (onlySymbol) {
    symbols = [onlySymbol];
  } else {
    // Enumerate canonical docs — post-#1159 symbols may exist only in
    // st-symbols (subcollection writes don't materialize the legacy
    // parent doc, so a legacy enumeration would miss them).
    const snap = await db.collection(ST_SYMBOLS_ROOT).get();
    symbols = snap.docs.map((d) => d.id);
  }

  console.log(`st-signals backfill — ${symbols.length} symbol(s)${dryRun ? ' [DRY RUN]' : ''}\n`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  const allMalformed: string[] = [];
  const allNotes: string[] = [];
  const failedSymbols: string[] = [];

  for (const symbol of symbols) {
    try {
      const inputs = await loadSymbolInputs(db, symbol);
      const { occurrences, malformed, notes } = aggregateOccurrences(symbol, inputs.historyDocs, inputs.runDocs);
      malformed.push(...inputs.dropped.map((d) => `${symbol}/${d}`));
      allNotes.push(...notes);
      allMalformed.push(...malformed);
      const stats = await writeSymbolOccurrences(db, occurrences, dryRun);
      totalCreated += stats.created;
      totalUpdated += stats.updated;
      totalUnchanged += stats.unchanged;
      if (occurrences.size > 0 || malformed.length > 0) {
        console.log(
          `${symbol}: ${occurrences.size} occurrence(s) → ` +
          `${dryRun ? 'would create' : 'created'}=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged}` +
          (malformed.length ? ` malformed=${malformed.length}` : ''),
        );
      }
    } catch (err) {
      // Isolate failures — one bad symbol shouldn't abort the remaining
      // several hundred (matches sibling backfill-signal-history.ts).
      failedSymbols.push(symbol);
      console.error(`${symbol}: FAILED —`, err);
    }
  }

  console.log(
    `\nTOTAL — ${dryRun ? 'would create' : 'created'}=${totalCreated} ` +
    `updated=${totalUpdated} unchanged=${totalUnchanged} malformed=${allMalformed.length}` +
    (failedSymbols.length ? ` FAILED=${failedSymbols.length}` : ''),
  );
  for (const s of failedSymbols) console.log(`  FAILED ${s}`);
  for (const m of allMalformed.slice(0, 50)) console.log(`  MALFORMED ${m}`);
  if (allMalformed.length > 50) console.log(`  … +${allMalformed.length - 50} more`);
  for (const n of allNotes.slice(0, 50)) console.log(`  NOTE ${n}`);
  if (allNotes.length > 50) console.log(`  … +${allNotes.length - 50} more`);
  if (failedSymbols.length > 0) process.exitCode = 1;
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err) => {
    console.error('backfill failed:', err);
    process.exit(1);
  });
}
