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
}): string {
  const { isHeartbeat, ptSegment, eventType, runId } = args;
  if (isHeartbeat) return `heartbeat__${ptSegment || 'unknown'}`;
  const rt = eventType || 'unknown';
  const rid = (runId && String(runId).trim()) || 'no-runid';
  return `${rt}__${rid}`;
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
