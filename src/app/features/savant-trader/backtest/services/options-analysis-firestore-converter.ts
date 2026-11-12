/**
 * Options Analysis Firestore converter.
 *
 * Pure helper converting `st-options-analysis-results` snapshots into
 * `AnalysisResultDoc` — same boundary-seam approach as
 * `options-replay-firestore-converter.ts`.
 */

import { ANALYSIS_RESULT_STATUSES } from '@options-analysis/contracts';
import type { AnalysisResultDoc, AnalysisResultStatus } from '@options-analysis/contracts';

/** Firestore doc → AnalysisResultDoc — defaults guard sparse/partial
 *  snapshots; mirrors convertOptionsContractListDoc. */
export function convertAnalysisResultDoc(d: Record<string, unknown>): AnalysisResultDoc {
  const exitId = String(d['exitId'] ?? '');
  return {
    contractListDocId: String(d['contractListDocId'] ?? ''),
    runId: String(d['runId'] ?? ''),
    symbol: String(d['symbol'] ?? ''),
    templateId: String(d['templateId'] ?? ''),
    exitId,
    registryVersion: Number(d['registryVersion'] ?? 0),
    // An absent/invalid status must NOT pass through — 'success' would flip
    // the card to a dead-end View Results and remove its only re-run
    // affordance. 'failed' fails safe: the card keeps Analyze enabled.
    status: (ANALYSIS_RESULT_STATUSES as readonly unknown[]).includes(d['status'])
      ? (d['status'] as AnalysisResultStatus)
      : 'failed',
    trades: Array.isArray(d['trades']) ? (d['trades'] as AnalysisResultDoc['trades']) : [],
    // openCount defaults 0 — v1 docs predate the field (they're flagged
    // stale by the version check, but a sparse read still type-checks).
    aggregate: d['aggregate'] && typeof d['aggregate'] === 'object'
      ? {
          exitId,
          contractCount: 0,
          exitedCount: 0,
          expiredCount: 0,
          openCount: 0,
          errorCount: 0,
          ...(d['aggregate'] as Partial<AnalysisResultDoc['aggregate']>),
        }
      : {
      exitId, contractCount: 0, exitedCount: 0, expiredCount: 0, openCount: 0, errorCount: 0,
    },
    generatedAt: String(d['generatedAt'] ?? ''),
    error: typeof d['error'] === 'string' ? d['error'] : undefined,
  };
}
