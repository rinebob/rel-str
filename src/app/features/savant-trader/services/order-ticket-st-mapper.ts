/**
 * @topic #984 — ST Firestore Reorg (task #1015)
 *
 * OrderTicket ↔ StOrderTicket boundary translation. The FE keeps its
 * legacy domain type; this mapper emits and reads the canonical
 * `st-order-tickets` schema (mode / origin / terms / state) so the
 * service's CRUD lands on the same shape the BE StOrderTicketWriter
 * emits. Doc ids carry the `{liv|pap}_` mode prefix — FE-minted ids are
 * bare, so the mapper normalizes them on every write path.
 */
import { deleteField } from '@angular/fire/firestore';
import type { OrderTicketTrackingFields } from '@screenshot-capture/contracts';
import {
  isStTicketId,
  stSignalOccurrenceId,
  stTicketId,
  stripStTicketPrefix,
} from '@st/ids';
import {
  validateStTicketTerms,
  type StMode,
  type StOrderTicket,
  type StTicketLeg,
  type StTicketOrigin,
  type StTicketOriginType,
  type StTicketState,
  type StTicketTerms,
} from '@st/order-tickets';
import {
  EquityOrderTicket,
  EtfOrderTicket,
  InstrumentType,
  OptionOrderTicket,
  OptionLeg,
  OrderSource,
  OrderTicket,
  OrderTicketError,
  OrderTicketPatch,
  OrderTicketStatus,
  TaxLotSelection,
} from './order-ticket.types';

/** Doc id on `st-order-tickets` — prefixes bare FE ids, passes through
 *  already-prefixed ones (hydrated docs, BE-minted pap_ ids). */
export function stDocId(id: string): string {
  return isStTicketId(id) ? id : stTicketId('live', id);
}

const STATUS_TO_STATE: Record<OrderTicketStatus, StTicketState> = {
  [OrderTicketStatus.STAGED]: 'staged',
  // SUBMITTING is local-only (never persisted) — if it ever reaches the
  // wire the honest on-disk state is still pre-submit.
  [OrderTicketStatus.SUBMITTING]: 'staged',
  [OrderTicketStatus.SUBMITTED]: 'submitted',
  [OrderTicketStatus.QUEUED]: 'submitted',
  [OrderTicketStatus.RESTING]: 'submitted',
  [OrderTicketStatus.FILLED]: 'filled',
  [OrderTicketStatus.FAILED]: 'failed',
  [OrderTicketStatus.CANCELLED]: 'cancelled',
  [OrderTicketStatus.EXPIRED]: 'expired',
  [OrderTicketStatus.CANCEL_PENDING]: 'cancel_pending',
  [OrderTicketStatus.PAPER]: 'submitted',
};

const STATE_TO_STATUS: Record<StTicketState, OrderTicketStatus> = {
  staged: OrderTicketStatus.STAGED,
  submitted: OrderTicketStatus.SUBMITTED,
  cancel_pending: OrderTicketStatus.CANCEL_PENDING,
  filled: OrderTicketStatus.FILLED,
  cancelled: OrderTicketStatus.CANCELLED,
  expired: OrderTicketStatus.EXPIRED,
  failed: OrderTicketStatus.FAILED,
};

const SOURCE_TO_ORIGIN: Record<OrderSource, StTicketOriginType> = {
  [OrderSource.SIGNAL_PIPELINE]: 'signal',
  [OrderSource.MANUAL]: 'manual',
  [OrderSource.POSITION_MANAGEMENT]: 'management',
  [OrderSource.PROGRAM]: 'program',
};

const ORIGIN_TO_SOURCE: Record<StTicketOriginType, OrderSource> = {
  signal: OrderSource.SIGNAL_PIPELINE,
  program: OrderSource.PROGRAM,
  manual: OrderSource.MANUAL,
  management: OrderSource.POSITION_MANAGEMENT,
};

const TRACKING_KEYS = ['role', 'linkedPositionId', 'signalId', 'lastSeenState', 'capturedEvents'] as const;

function modeOf(status: OrderTicketStatus): StMode {
  return status === OrderTicketStatus.PAPER ? 'paper' : 'live';
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toStLegs(legs: OptionLeg[] | undefined): StTicketLeg[] | undefined {
  return legs?.map((l) => ({
    side: l.side,
    occSymbol: l.symbol,
    optionId: l.optionId,
    positionEffect: l.positionEffect,
    ...(l.ratioQuantity !== undefined ? { ratioQuantity: l.ratioQuantity } : {}),
  }));
}

function fromStLegs(legs: StTicketLeg[] | undefined): OptionLeg[] | undefined {
  return legs?.map((l) => ({
    side: l.side,
    symbol: l.occSymbol,
    optionId: l.optionId,
    positionEffect: l.positionEffect,
    ...(l.ratioQuantity !== undefined ? { ratioQuantity: l.ratioQuantity } : {}),
  }));
}

function toStTerms(ticket: OrderTicket): StTicketTerms {
  const isOption = ticket.instrumentType === InstrumentType.OPTION;
  const limitPrice = isOption
    ? toNumber((ticket as OptionOrderTicket).price)
    : toNumber((ticket as EquityOrderTicket | EtfOrderTicket).limitPrice);
  const limits: StTicketTerms['limits'] = {};
  if (limitPrice !== undefined) limits.limitPrice = limitPrice;
  const stop = toNumber((ticket as EquityOrderTicket | OptionOrderTicket).stopPrice);
  if (stop !== undefined) limits.stopPrice = stop;
  const terms: StTicketTerms = {
    symbol: ticket.symbol,
    side: ticket.side,
    instrument: ticket.instrumentType as StTicketTerms['instrument'],
    ...(toNumber((ticket as EquityOrderTicket | OptionOrderTicket).quantity) !== undefined
      ? { quantity: toNumber((ticket as EquityOrderTicket | OptionOrderTicket).quantity) }
      : {}),
    ...(toNumber((ticket as EquityOrderTicket | EtfOrderTicket).dollarAmount) !== undefined
      ? { dollarAmount: toNumber((ticket as EquityOrderTicket | EtfOrderTicket).dollarAmount) }
      : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(isOption && (ticket as OptionOrderTicket).legs
      ? { legs: toStLegs((ticket as OptionOrderTicket).legs) }
      : {}),
    orderType: ticket.orderType,
    timeInForce: ticket.timeInForce,
    marketHours: ticket.marketHours,
    ...((ticket as EquityOrderTicket | EtfOrderTicket).taxLots
      ? { taxLots: (ticket as EquityOrderTicket | EtfOrderTicket).taxLots as TaxLotSelection[] }
      : {}),
  };
  return terms;
}

/** OrderTicket → canonical doc for createTicket. Validates terms through
 *  the shared gate so a malformed write fails before touching Firestore. */
export function toStOrderTicket(ticket: OrderTicket, userId: string): StOrderTicket {
  const terms = toStTerms(ticket);
  validateStTicketTerms(terms);
  const mode = modeOf(ticket.status);
  const origin: StTicketOrigin = { type: SOURCE_TO_ORIGIN[ticket.source] };
  const sc = ticket.signalContext;
  // Signal tickets carry the canonical st-signals occurrence id on origin
  // — minted the same way the order-intents migration emitted it
  // (stSignalOccurrenceId over signalContext, never tracking.signalId,
  // which is a different namespace used for group linkage).
  if (origin.type === 'signal' && sc?.barDate && sc.signalType) {
    try {
      origin.signalId = stSignalOccurrenceId(terms.symbol, sc.barDate, sc.signalType);
    } catch {
      // Malformed barDate — leave signalId unset rather than corrupt the doc.
    }
  }
  // Management tickets carry the managed entity id on origin.positionGroupId
  // (migration parity: legacy sourceRef.id lands there until position
  // groups exist FE-side).
  if (origin.type === 'management' && ticket.sourceRef?.id) {
    origin.positionGroupId = ticket.sourceRef.id;
  }
  const doc: StOrderTicket = {
    id: stTicketId(mode, stripStTicketPrefix(ticket.id)),
    origin,
    // Signal-accept and program passes are automated flows; manual/
    // management tickets are user-actioned (prod parity: program docs
    // carry auto:true — the FE never mints them, but the convention
    // holds on any re-create path).
    auto: origin.type === 'signal' || origin.type === 'program',
    mode,
    terms,
    state: STATUS_TO_STATE[ticket.status],
    refId: ticket.refId,
    accountTarget: ticket.accountNumber,
    userId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
  if (ticket.result?.orderId) doc.brokerOrderId = ticket.result.orderId;
  if (ticket.error) {
    doc.lastError = { category: ticket.error.code ?? 'unknown', message: ticket.error.message };
  }
  if (ticket.bucketId) doc.bucketId = ticket.bucketId;
  if (ticket.signalContext) doc.signalContext = { ...ticket.signalContext };
  const tracking: Record<string, unknown> = {};
  for (const key of TRACKING_KEYS) {
    const value: OrderTicketTrackingFields[typeof key] = ticket[key];
    if (value !== undefined) tracking[key] = value;
  }
  if (Object.keys(tracking).length > 0) {
    doc.tracking = tracking as StOrderTicket['tracking'];
  }
  if (ticket.terminalAt) doc.terminalAt = ticket.terminalAt;
  return doc;
}

/** OrderTicketPatch → canonical update payload. Every legacy key maps to
 *  its canonical destination (or a `terms.*`/`tracking.*` dotted path);
 *  an unmapped key throws — silently writing a legacy field onto a
 *  canonical doc corrupts the schema and fails rules-side anyway. */
export function toStTicketPatch(
  partial: OrderTicketPatch,
  writeAtIso: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(partial)) {
    const deleted = value === undefined;
    const del = () => (out[key] = deleteField());
    switch (key) {
      case 'status': {
        if (deleted) { out['state'] = deleteField(); break; }
        const status = value as OrderTicketStatus;
        if (status === OrderTicketStatus.PAPER) {
          // mode is bound to the doc-id prefix — patching a liv_ doc to
          // mode:'paper' violates the {liv|pap}_ invariant. The paper
          // transition is a doc move (delete liv_ → BE's pap_{tradeId}
          // lifecycle doc), never a patch.
          throw new Error('toStTicketPatch: status PAPER is not patchable — sendTicketToPaper moves the doc');
        }
        out['state'] = STATUS_TO_STATE[status];
        if (status === OrderTicketStatus.SUBMITTED) out['submittedAt'] = writeAtIso;
        if (status === OrderTicketStatus.STAGED) {
          // A staged doc carries no broker/terminal artifacts — requeue
          // must strip them or the doc fails the canonical audit
          // ('staged' + terminalAt/fillSummary/lastError) and a stale
          // brokerOrderId lets reconcile re-kill the requeued ticket.
          for (const f of ['terminalAt', 'lastError', 'fillSummary', 'filledAt', 'cancelledAt', 'brokerOrderId', 'submittedAt']) {
            out[f] = deleteField();
          }
        }
        break;
      }
      case 'result': {
        if (deleted) {
          out['brokerOrderId'] = deleteField();
          out['fillSummary'] = deleteField();
          break;
        }
        const result = value as OrderTicket['result'];
        if (result?.orderId) out['brokerOrderId'] = result.orderId;
        const fillPrice = result?.fillPrice ? Number(result.fillPrice) : NaN;
        const fillQty = result?.filledQuantity ? Number(result.filledQuantity) : NaN;
        if (Number.isFinite(fillPrice) || Number.isFinite(fillQty)) {
          // StTicketFillSummary.filledAt is schema-required — stamp it
          // from the write time (best available at the patch boundary).
          out['fillSummary'] = {
            ...(Number.isFinite(fillPrice) ? { averagePrice: fillPrice } : {}),
            ...(Number.isFinite(fillQty) ? { filledQty: fillQty } : {}),
            filledAt: writeAtIso,
          };
        }
        break;
      }
      case 'error': {
        out['lastError'] = deleted
          ? deleteField()
          : {
              category: (value as OrderTicketError).code ?? 'unknown',
              message: (value as OrderTicketError).message,
            };
        break;
      }
      case 'accountNumber':
        out['accountTarget'] = deleted ? deleteField() : value;
        break;
      case 'source':
        out['origin.type'] = deleted
          ? deleteField()
          : SOURCE_TO_ORIGIN[value as OrderSource];
        break;
      case 'signalContext':
        out['signalContext'] = deleted ? deleteField() : value;
        break;
      case 'symbol': out['terms.symbol'] = deleted ? deleteField() : value; break;
      case 'side': out['terms.side'] = deleted ? deleteField() : value; break;
      case 'quantity': out['terms.quantity'] = deleted ? deleteField() : toNumber(value as string); break;
      case 'dollarAmount': out['terms.dollarAmount'] = deleted ? deleteField() : toNumber(value as string); break;
      case 'limitPrice':
      case 'price':
        out['terms.limits.limitPrice'] = deleted ? deleteField() : toNumber(value as string);
        break;
      case 'stopPrice': out['terms.limits.stopPrice'] = deleted ? deleteField() : toNumber(value as string); break;
      case 'orderType': out['terms.orderType'] = deleted ? deleteField() : value; break;
      case 'timeInForce': out['terms.timeInForce'] = deleted ? deleteField() : value; break;
      case 'marketHours': out['terms.marketHours'] = deleted ? deleteField() : value; break;
      case 'taxLots': out['terms.taxLots'] = deleted ? deleteField() : value; break;
      case 'legs':
        out['terms.legs'] = deleted ? deleteField() : toStLegs(value as OptionLeg[]);
        break;
      case 'role':
      case 'linkedPositionId':
      case 'signalId':
      case 'lastSeenState':
      case 'capturedEvents':
        out[`tracking.${key}`] = deleted ? deleteField() : value;
        break;
      case 'refId':
      case 'bucketId':
      case 'terminalAt':
      case 'createdAt':
      case 'updatedAt':
        if (deleted) del(); else out[key] = value;
        break;
      default:
        throw new Error(`toStTicketPatch: unmapped patch key '${key}'`);
    }
  }
  return out;
}

/** Canonical doc → FE OrderTicket. mode:'paper' always maps to PAPER —
 *  paper docs belong to the paper ledger, not the live queue, in any
 *  state (a cancelled pap_ doc must never hydrate as a requeueable
 *  CANCELLED row — requeueing it would write state:'staged' on a
 *  mode:'paper' doc and strand it). */
export function fromStOrderTicket(doc: StOrderTicket): OrderTicket {
  const terms = doc.terms ?? ({} as StTicketTerms);
  const isOption = terms.instrument === 'option' || (terms.legs?.length ?? 0) > 0;
  const status =
    doc.mode === 'paper'
      ? OrderTicketStatus.PAPER
      // Schema-drifted state (BE added a state the FE predates) — FAILED is
      // terminal, visible, and requeueable rather than silently invisible.
      : (STATE_TO_STATUS[doc.state] ?? OrderTicketStatus.FAILED);
  const base = {
    id: doc.id,
    refId: doc.refId,
    source: ORIGIN_TO_SOURCE[doc.origin?.type ?? 'manual'] ?? OrderSource.MANUAL,
    // sourceRef survives the canonical round-trip in two slots: signal
    // tickets carry signalContext.decisionId; management tickets carry
    // origin.positionGroupId (the source entity id — the KIND collapses
    // to 'management'; orderType still distinguishes stop-loss rows).
    ...(doc.signalContext?.decisionId
      ? { sourceRef: { type: 'occurrence_decision', id: doc.signalContext.decisionId } }
      : doc.origin?.type === 'management' && doc.origin.positionGroupId
        ? { sourceRef: { type: 'management', id: doc.origin.positionGroupId } }
        : {}),
    status,
    accountNumber: doc.accountTarget,
    side: terms.side ?? 'buy',
    orderType: terms.orderType ?? 'market',
    timeInForce: terms.timeInForce ?? 'gfd',
    marketHours: terms.marketHours ?? 'regular_hours',
    ...(doc.signalContext
      ? {
          signalContext: {
            ...(doc.signalContext.signalId ? { signalId: doc.signalContext.signalId } : {}),
            signalType: doc.signalContext.signalType ?? '',
            barDate: doc.signalContext.barDate ?? '',
            timeframe: doc.signalContext.timeframe ?? '',
            direction: doc.signalContext.direction ?? '',
            decisionId: doc.signalContext.decisionId ?? doc.signalContext.decisionIds?.[0] ?? '',
            ...(doc.signalContext.decisionIds ? { decisionIds: doc.signalContext.decisionIds } : {}),
            ...(doc.signalContext.signalPrice !== undefined ? { signalPrice: doc.signalContext.signalPrice } : {}),
          },
        }
      : {}),
    ...(doc.bucketId ? { bucketId: doc.bucketId } : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(doc.terminalAt ? { terminalAt: doc.terminalAt } : {}),
    ...(doc.lastError
      ? { error: { message: doc.lastError.message, code: doc.lastError.category, retryable: false } }
      : {}),
    ...(doc.brokerOrderId || doc.fillSummary
      ? {
          result: {
            ...(doc.brokerOrderId ? { orderId: doc.brokerOrderId } : {}),
            // result.state is the BROKER order state — lastSeenState is
            // what the detector observed; doc.state is the local lifecycle
            // (not an RH vocabulary — 'submitted' ≠ RH 'confirmed').
            state: doc.tracking?.lastSeenState ?? doc.state,
            ...(doc.fillSummary
              ? {
                  fillPrice: String(doc.fillSummary.averagePrice),
                  filledQuantity: String(doc.fillSummary.filledQty),
                }
              : {}),
          },
        }
      : {}),
    ...(doc.tracking ?? {}),
  };
  if (isOption) {
    const t: OptionOrderTicket = {
      ...(base as Omit<OptionOrderTicket, 'instrumentType' | 'legs' | 'quantity'>),
      instrumentType: InstrumentType.OPTION,
      symbol: terms.symbol,
      legs: fromStLegs(terms.legs) ?? [],
      quantity: String(terms.quantity ?? ''),
      ...(terms.limits?.limitPrice !== undefined ? { price: String(terms.limits.limitPrice) } : {}),
      ...(terms.limits?.stopPrice !== undefined ? { stopPrice: String(terms.limits.stopPrice) } : {}),
    };
    return t;
  }
  const equityLike = {
    ...base,
    symbol: terms.symbol,
    ...(terms.quantity !== undefined ? { quantity: String(terms.quantity) } : {}),
    ...(terms.dollarAmount !== undefined ? { dollarAmount: String(terms.dollarAmount) } : {}),
    ...(terms.limits?.limitPrice !== undefined ? { limitPrice: String(terms.limits.limitPrice) } : {}),
    ...(terms.limits?.stopPrice !== undefined ? { stopPrice: String(terms.limits.stopPrice) } : {}),
    ...(terms.taxLots ? { taxLots: terms.taxLots as TaxLotSelection[] } : {}),
  };
  if (terms.instrument === 'etf') {
    return { ...equityLike, instrumentType: InstrumentType.ETF } as EtfOrderTicket;
  }
  return { ...equityLike, instrumentType: InstrumentType.EQUITY } as EquityOrderTicket;
}
