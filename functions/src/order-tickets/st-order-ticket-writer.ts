/**
 * @topic #984 — ST Firestore Reorg (task #1002)
 *
 * StOrderTicketWriter
 *
 * Canonical `st-order-tickets` emission + lifecycle transitions — the
 * single writer every action path (auto-paper ingest, open pass,
 * paperSignalOrder, live submit, management) funnels through during the
 * #984 dual-write window. Mirrors SignalDateWriter (#1000): deps-seamed
 * `{db, logger}`, fail-soft so a canonical-path failure never drops the
 * legacy artifact the path actually runs on.
 *
 * - `emit()` stages a ticket doc: `get`-then-`set` so a deterministic
 *   `idSeed` makes re-emission idempotent — an existing doc is returned
 *   untouched (state and provenance are never rewritten).
 * - Transitions run inside a transaction with a state guard: terminal
 *   states can't be re-opened and a fill racing an async cancel wins
 *   (`cancel_pending`/`cancelled` → `filled`), matching the RH cancel
 *   semantics in the PRD (accepted ≠ cancelled).
 *
 * Live-submit/management FE emission lands via #1003's order-intents
 * dual-write and #1015's service re-point — this writer already covers
 * those axes (`liv_` ids, brokerOrderId/reviewSnapshot/fillSummary/
 * lastError, cancel_pending).
 */
import { logger as defaultLogger } from 'firebase-functions/v2';
import { db as defaultDb } from '../firebase-admin-init';
import { ST_ORDER_TICKETS_ROOT } from '../common/st-collections';
import { stTicketId } from '@st/ids';
import {
  validateStTicketTerms,
  type StMode,
  type StOrderTicket,
  type StTicketError,
  type StTicketFillSummary,
  type StTicketOrigin,
  type StTicketReviewSnapshot,
  type StTicketSignalContext,
  type StTicketState,
  type StTicketTerms,
} from '@st/order-tickets';

/** Minimal logger surface — injectable for tests. */
export interface StOrderTicketWriterLogger {
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface StOrderTicketWriterDeps {
  db?: FirebaseFirestore.Firestore;
  logger?: StOrderTicketWriterLogger;
}

/** The dep seam call sites declare — one surface, not four spellings.
 *  Sites needing fewer methods Pick from this type. */
export type StOrderTicketEmitter = Pick<
  StOrderTicketWriter,
  'emit' | 'markFilled' | 'markFailed' | 'markCancelled'
>;

/** Everything a caller supplies to stage a ticket doc. */
export interface EmitStOrderTicketInput {
  /** 'paper' → pap_ id prefix; 'live' → liv_. */
  mode: StMode;
  /**
   * Opaque id segment (`st-order-tickets/{liv|pap}_{idSeed}`). Prefer a
   * deterministic value the path already dedupes on (tradeId, positionId)
   * so a retried emit is a no-op instead of a sibling doc.
   */
  idSeed: string;
  origin: StTicketOrigin;
  /** True when staged by an automated flow (auto-paper, program pass). */
  auto: boolean;
  terms: StTicketTerms;
  /** RH ref_id idempotency key — defaults to the minted ticket id for
   *  paper paths that never reach the broker. */
  refId?: string;
  /** Live account number or paper `acct-{userId}` the ticket targets. */
  accountTarget: string;
  userId: string;
  signalContext?: StTicketSignalContext;
  bucketId?: string;
  /** ISO timestamp stamped on createdAt/updatedAt. */
  now: string;
}

export interface StTicketTransitionResult {
  applied: boolean;
  ticketId: string;
  /** State the txn observed — undefined when the doc doesn't exist. */
  from?: StTicketState;
  to: StTicketState;
}

/**
 * State-guard table — `to` state → states it may transition FROM.
 * 'filled' deliberately accepts 'cancel_pending'/'cancelled': an RH cancel
 * is async, so a fill can race it and the broker outcome wins locally.
 */
const ALLOWED_FROM: Record<Exclude<StTicketState, 'staged'>, StTicketState[]> = {
  submitted: ['staged', 'submitted'],
  cancel_pending: ['submitted'],
  cancelled: ['staged', 'submitted', 'cancel_pending'],
  // 'filled' accepts 'failed' too — a transient markFailed (ledger quota,
  // timeout) followed by a successful retry must be able to heal the
  // ticket; the broker/ledger outcome is the truth, not the stale state.
  filled: ['staged', 'submitted', 'cancel_pending', 'cancelled', 'failed', 'filled'],
  expired: ['submitted', 'cancel_pending'],
  failed: ['staged', 'submitted', 'cancel_pending'],
};

export class StOrderTicketWriter {
  private readonly db: FirebaseFirestore.Firestore;
  private readonly log: StOrderTicketWriterLogger;

  constructor(deps: StOrderTicketWriterDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.log = deps.logger ?? defaultLogger;
  }

  /**
   * Stage a ticket doc under `st-order-tickets/{liv|pap}_{idSeed}`.
   * Returns the ticket id, or null when the emit failed (logged — callers
   * treat a null as "canonical write skipped", never a hard failure
   * during the dual-write window).
   */
  async emit(input: EmitStOrderTicketInput): Promise<string | null> {
    let id: string;
    try {
      id = stTicketId(input.mode, input.idSeed);
      validateStTicketTerms(input.terms);
    } catch (err) {
      this.log.error('st-order-ticket emit rejected — unmintable id or invalid terms', {
        idSeed: input.idSeed,
        mode: input.mode,
        error: String(err),
      });
      return null;
    }

    try {
      const ref = this.db.collection(ST_ORDER_TICKETS_ROOT).doc(id);
      const doc: StOrderTicket = {
        id,
        origin: input.origin,
        auto: input.auto,
        mode: input.mode,
        terms: input.terms,
        state: 'staged',
        refId: input.refId ?? id,
        accountTarget: input.accountTarget,
        userId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      };
      if (input.signalContext) doc.signalContext = input.signalContext;
      if (input.bucketId) doc.bucketId = input.bucketId;
      // create() not get-then-set: atomic — a racing emit/transition
      // resolves ALREADY_EXISTS instead of overwriting a filled doc back
      // to 'staged'. Deterministic idSeed → re-emit is a no-op.
      await ref.create(doc);
      return id;
    } catch (err) {
      if (isAlreadyExists(err)) return id;
      this.log.error('st-order-ticket emit failed', { idSeed: input.idSeed, error: String(err) });
      return null;
    }
  }

  /**
   * Guarded state transition — applies `to` + fields inside a transaction
   * only when the observed state is in the transition's allowed-from set.
   * Fail-soft: missing doc, disallowed transition, and txn failure all
   * resolve `applied:false` with a warn log rather than throwing.
   */
  private async transition(
    ticketId: string,
    to: Exclude<StTicketState, 'staged'>,
    fields: Record<string, unknown>,
    now: string,
  ): Promise<StTicketTransitionResult> {
    const ref = this.db.collection(ST_ORDER_TICKETS_ROOT).doc(ticketId);
    try {
      const result = await this.db.runTransaction(async (txn: FirebaseFirestore.Transaction) => {
        const snap = await txn.get(ref);
        const from = snap.exists
          ? (snap.data() as StOrderTicket | undefined)?.state
          : undefined;
        if (!from || !ALLOWED_FROM[to].includes(from)) {
          return { applied: false, ticketId, from, to };
        }
        txn.update(ref, { state: to, ...fields, updatedAt: now });
        return { applied: true, ticketId, from, to };
      });
      if (!result.applied) {
        this.log.warn('st-order-ticket transition rejected', { ticketId, from: result.from, to });
      }
      return result;
    } catch (err) {
      this.log.warn('st-order-ticket transition failed', {
        ticketId,
        to,
        error: String(err),
      });
      return { applied: false, ticketId, to };
    }
  }

  /** staged → submitted. Stamps brokerOrderId + reviewSnapshot at submit. */
  markSubmitted(
    ticketId: string,
    fields: { brokerOrderId?: string; reviewSnapshot?: StTicketReviewSnapshot; now: string },
  ): Promise<StTicketTransitionResult> {
    const extra: Record<string, unknown> = { submittedAt: fields.now };
    if (fields.brokerOrderId) extra.brokerOrderId = fields.brokerOrderId;
    if (fields.reviewSnapshot) extra.reviewSnapshot = fields.reviewSnapshot;
    return this.transition(ticketId, 'submitted', extra, fields.now);
  }

  /** submitted → cancel_pending. RH cancel acceptance is async. */
  markCancelPending(ticketId: string, now: string): Promise<StTicketTransitionResult> {
    return this.transition(ticketId, 'cancel_pending', {}, now);
  }

  /** → cancelled. Stamps cancelledAt + terminalAt. */
  markCancelled(ticketId: string, now: string): Promise<StTicketTransitionResult> {
    return this.transition(ticketId, 'cancelled', { cancelledAt: now, terminalAt: now }, now);
  }

  /** → filled. Stamps fillSummary + filledAt; wins over a racing cancel. */
  markFilled(
    ticketId: string,
    fill: StTicketFillSummary,
    now: string,
  ): Promise<StTicketTransitionResult> {
    return this.transition(
      ticketId,
      'filled',
      { fillSummary: fill, filledAt: fill.filledAt, terminalAt: fill.filledAt },
      now,
    );
  }

  /** → failed. Stamps lastError + terminalAt. */
  markFailed(
    ticketId: string,
    error: StTicketError,
    now: string,
  ): Promise<StTicketTransitionResult> {
    return this.transition(ticketId, 'failed', { lastError: error, terminalAt: now }, now);
  }

  /** submitted/cancel_pending → expired (TIF expired at the broker). */
  markExpired(ticketId: string, now: string): Promise<StTicketTransitionResult> {
    return this.transition(ticketId, 'expired', { terminalAt: now }, now);
  }
}

/** Firestore's ALREADY_EXISTS — the emit idempotency signal. */
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}
