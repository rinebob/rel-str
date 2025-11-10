import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';

export function toKebabRunType(rt?: string): string | undefined {
  if (!rt) return undefined;
  return String(rt).replace(/_/g, '-');
}

export function formatPtSegment(iso?: string): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return undefined;
  }
}

export function computeEventDocId(args: {
  messageId?: string;
  isHeartbeat: boolean;
  ptSegment?: string;
  eventType: string;
  runId?: string;
  publishTime?: string;
}): string {
  const { isHeartbeat, ptSegment, runId, messageId } = args as any;
  const mid = (messageId && String(messageId).trim()) || 'no-mid';
  if (isHeartbeat) {
    // Heartbeats have no runId; keep them distinct and readable.
    return `heartbeat-${ptSegment || 'unknown'}-${mid}`;
  }
  const rid = (runId && String(runId).trim()) || 'no-runid';
  // Format: runId-messageId (e.g., 2025-11-10-PRE-1200-<messageId> if SA includes time in runId)
  return `${rid}-${mid}`;
}

export async function markProcessing(
  eventRef: DocumentReference,
  info: {
    eventType: string;
    isHeartbeat: boolean;
    runId?: string;
    messageId?: string;
    publishTime?: string;
    ptSegment?: string;
  }
): Promise<void> {
  await eventRef.set(
    {
      status: 'processing',
      startTime: FieldValue.serverTimestamp(),
      eventType: info.eventType,
      isHeartbeat: info.isHeartbeat,
      runId: info.runId,
      messageId: info.messageId,
      publishTime: info.publishTime,
      ptSegment: info.ptSegment,
    },
    { merge: true }
  );
}
