/**
 * Pick-doc → contract-list row mapper (Topic #1238, task #1280).
 *
 * Pure function — one `ContractListRow` per trading day. A `days` entry that
 * narrows to a pick becomes a `pick` row (all day fields verbatim + `side`
 * stamped from the template); an explicit miss entry becomes a
 * `no-selection` row with the SA status mapped (`no_match`→'miss',
 * `no_chain`→'gap'); a trading day with no entry gets a marker too —
 * 'out-of-range' when outside the doc's [firstDate, lastDate], no reason
 * when absent inside it (SA's contract is every trading day carries an
 * entry, so an absent in-range key has no honest explanation).
 *
 * `repeatsPrevious` compares each pick to the immediately preceding pick —
 * a no-selection day resets the run.
 */

import { isPickDocPick } from '@options-replay/contracts';
import type {
  ContractListRow,
  NoSelectionReason,
  PickDocument,
} from '@options-replay/contracts';
import type { TradeSide } from '@common';

export function mapPickDocToRows(
  doc: PickDocument,
  tradingDays: string[],
  side: TradeSide,
): ContractListRow[] {
  const rows: ContractListRow[] = [];
  let prevContractId: string | null = null;

  for (const date of tradingDays) {
    const entry = doc.days[date];

    if (entry && isPickDocPick(entry)) {
      rows.push({
        ...entry,
        kind: 'pick',
        entryDate: date,
        side,
        repeatsPrevious: prevContractId === entry.contractId,
      });
      prevContractId = entry.contractId;
      continue;
    }

    let reason: NoSelectionReason | undefined;
    if (entry && 'status' in entry) {
      reason = entry.status === 'no_match' ? 'miss' : 'gap';
    } else if (!entry && (date < doc.firstDate || date > doc.lastDate)) {
      reason = 'out-of-range';
    }
    rows.push({ kind: 'no-selection', entryDate: date, ...(reason ? { reason } : {}) });
    prevContractId = null;
  }

  return rows;
}
