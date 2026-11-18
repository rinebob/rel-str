/**
 * Pick-docs → position-row mapper (Topic #1238, task #1499).
 *
 * Pure N-leg date join — the v2 replacement for `mapPickDocToRows`.
 * Each option leg resolves its own day's entry inside its pick doc; a
 * day where EVERY option leg picked becomes a `position` row (legs in
 * declared order — option legs carry the day fields verbatim plus their
 * coordinate and side; stock legs need no doc and carry the day's
 * `underlyingClose` from the option picks). Any option leg miss makes
 * the day `no-selection` with a `legMisses` entry per failing leg —
 * partial positions are never written (atomicity is the v2 contract).
 *
 * `repeatsPrevious` is all-legs-match via `positionRepeatsPrevious` —
 * option legs compare on contractId, stock legs on kind + side. A
 * no-selection day resets the run.
 *
 * At least one option leg is required: stock legs' `underlyingClose`
 * comes off the option picks, so a stock-only leg set is unresolvable
 * here (the worker fails permanently upstream instead).
 */

import {
  isPickDocPick,
  positionRepeatsPrevious,
} from '@options-replay/contracts';
import type {
  ContractListRow,
  NoSelectionReason,
  PickDocCoordinate,
  PickDocument,
  PositionLeg,
  PositionLegMiss,
} from '@options-replay/contracts';
import type { TradeSide } from '@common';

/** An option leg with the pick doc its coordinate fetched — one per
 *  option leg in the run's declared `legs[]` order. */
export interface MapperOptionLegInput {
  kind: 'option';
  side: TradeSide;
  /** The request coordinate — echoed into legs and legMisses. */
  coordinate: PickDocCoordinate;
  doc: PickDocument;
}

/** Stock legs need no doc — they always resolve via the day's
 *  underlying close taken from the option picks. */
export interface MapperStockLegInput {
  kind: 'stock';
  side: TradeSide;
}

export type MapperLegInput = MapperOptionLegInput | MapperStockLegInput;

/** Roll-up severity for a no-selection day: a real `miss` (chain
 *  existed, nothing matched) outranks a `gap` (data hole), which
 *  outranks `out-of-range`; reasonless misses leave reason absent. */
const REASON_SEVERITY: Record<NoSelectionReason, number> = {
  miss: 3,
  gap: 2,
  'out-of-range': 1,
};

export function mapLegsToPositionRows(
  legs: readonly MapperLegInput[],
  tradingDays: string[],
): ContractListRow[] {
  const optionLegs = legs.filter((l) => l.kind === 'option').length;
  if (optionLegs === 0) {
    throw new Error('mapLegsToPositionRows: at least one option leg is required');
  }

  const rows: ContractListRow[] = [];
  let prevLegs: PositionLeg[] | undefined;

  for (const date of tradingDays) {
    const dayLegs: PositionLeg[] = new Array(legs.length);
    const misses: PositionLegMiss[] = [];
    let underlyingClose: number | undefined;
    let allResolved = true;

    legs.forEach((leg, i) => {
      if (leg.kind === 'stock') return; // resolved after the option pass
      const entry = leg.doc.days[date];
      if (entry && isPickDocPick(entry)) {
        dayLegs[i] = { ...entry, kind: 'option', side: leg.side, coordinate: leg.coordinate };
        underlyingClose ??= entry.underlyingClose;
      } else {
        allResolved = false;
        const reason = missReason(leg.doc, date, entry);
        misses.push({
          legIndex: i,
          coordinate: leg.coordinate,
          ...(reason ? { reason } : {}),
        });
      }
    });

    if (allResolved) {
      legs.forEach((leg, i) => {
        if (leg.kind === 'stock') {
          dayLegs[i] = { kind: 'stock', side: leg.side, underlyingClose: underlyingClose! };
        }
      });
      rows.push({
        kind: 'position',
        entryDate: date,
        legs: [dayLegs[0], ...dayLegs.slice(1)],
        repeatsPrevious: positionRepeatsPrevious(prevLegs, dayLegs),
      });
      prevLegs = dayLegs;
      continue;
    }

    const reason = rollUpReason(misses);
    rows.push({
      kind: 'no-selection',
      entryDate: date,
      ...(reason ? { reason } : {}),
      legMisses: [misses[0], ...misses.slice(1)],
    });
    prevLegs = undefined;
  }

  return rows;
}

/** One leg's reason for an un-picked day — the v1 mapping carried
 *  forward per leg: no_match→'miss', no_chain→'gap', absent beyond the
 *  doc's [firstDate, lastDate]→'out-of-range', absent in-range→none. */
function missReason(
  doc: PickDocument,
  date: string,
  entry: PickDocument['days'][string] | undefined,
): NoSelectionReason | undefined {
  if (entry && 'status' in entry) {
    return entry.status === 'no_match' ? 'miss' : 'gap';
  }
  if (!entry && (date < doc.firstDate || date > doc.lastDate)) {
    return 'out-of-range';
  }
  return undefined;
}

/** Worst leg reason wins — the row's roll-up matches the worst
 *  per-leg miss rather than the first. Undefined when no leg reported
 *  a reason (all absent in-range). */
function rollUpReason(misses: readonly PositionLegMiss[]): NoSelectionReason | undefined {
  let worst: NoSelectionReason | undefined;
  for (const m of misses) {
    if (m.reason && (!worst || REASON_SEVERITY[m.reason] > REASON_SEVERITY[worst])) {
      worst = m.reason;
    }
  }
  return worst;
}
