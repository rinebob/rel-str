/**
 * Selection Replay Firestore converter.
 *
 * Pure helpers converting Firestore `DocumentData` snapshots into the
 * UI-facing `OptionsReplayRunUi` and `OptionsContractListUi` shapes —
 * same approach as `backtest-firestore-converter.ts`.
 */

import type { ContractListRow, PickDocMeta } from '@options-replay/contracts';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../common/options-replay.types';

type TimestampLike = { toDate: () => Date } | Date | string | number | undefined;

function toIso(ts: TimestampLike): string | undefined {
  if (!ts) return undefined;
  if (typeof ts === 'object' && 'toDate' in ts && typeof ts.toDate === 'function') {
    return ts.toDate().toISOString();
  }
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string') return ts;
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return undefined;
}

export function convertOptionsReplayRunDoc(id: string, data: Record<string, unknown>): OptionsReplayRunUi {
  return {
    runId: id,
    templateId: String(data['templateId'] ?? ''),
    symbols: Array.isArray(data['symbols']) ? data['symbols'].map((s) => String(s).toUpperCase()) : [],
    startDate: String(data['startDate'] ?? ''),
    status: String(data['status'] ?? 'pending') as OptionsReplayRunUi['status'],
    totalLists: Number(data['totalLists'] ?? 0),
    completedLists: Number(data['completedLists'] ?? 0),
    failedLists: Number(data['failedLists'] ?? 0),
    createdAtIso: toIso(data['createdAt'] as TimestampLike) ?? '',
    updatedAtIso: toIso(data['updatedAt'] as TimestampLike),
    completedAtIso: toIso(data['completedAt'] as TimestampLike),
    error: data['error'] ? String(data['error']) : undefined,
  };
}

export function convertOptionsContractListDoc(id: string, data: Record<string, unknown>): OptionsContractListUi {
  return {
    listId: id,
    runId: String(data['runId'] ?? ''),
    symbol: String(data['symbol'] ?? ''),
    templateId: String(data['templateId'] ?? ''),
    status: String(data['status'] ?? 'pending') as OptionsContractListUi['status'],
    rows: Array.isArray(data['rows']) ? (data['rows'] as ContractListRow[]) : [],
    pickDocMeta: (data['pickDocMeta'] as PickDocMeta) ?? undefined,
    generatedAtIso: toIso(data['generatedAt'] as TimestampLike),
    error: data['error'] ? String(data['error']) : undefined,
  };
}
