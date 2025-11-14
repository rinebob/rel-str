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

/**
 * Format an ISO timestamp into yyyy-mm-dd-hhmm in ET (America/New_York).
 */
function formatDayTimeET(iso?: string): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    } as any);
    const parts = fmt.formatToParts(d);
    const val = (t: string) => String(parts.find(p => p.type === t)?.value || '');
    const y = val('year');
    const m = val('month');
    const day = val('day');
    const hh = val('hour');
    const mm = val('minute');
    if (!y || !m || !day || !hh || !mm) return undefined;
    return `${y}-${m}-${day}-${hh}${mm}`;
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
  const { isHeartbeat, ptSegment, runId, messageId: _messageId, publishTime, eventType } = args as any;
  if (isHeartbeat) {
    // Always start with date/time in ET; if time unknown, use '-xxxx'; then suffix with '-heartbeat'.
    const dtHb = formatDayTimeET(publishTime) || (ptSegment ? `${ptSegment}-xxxx` : undefined) || 'unknown-xxxx';
    return `${dtHb}-heartbeat`;
  }

  // Preferred non-heartbeat format (ET): yyyy-mm-dd-hhmm-phase[-optional]. If time unknown, use 'yyyy-mm-dd-xxxx'.
  const dt = formatDayTimeET(publishTime) || (ptSegment ? `${ptSegment}-xxxx` : undefined);
  if (dt) {
    const et = typeof eventType === 'string' ? eventType.toLowerCase() : '';
    const phase = et.endsWith('-pre') ? 'pre' : et.endsWith('-post') ? 'post' : 'unknown';
    const suffix = toKebabRunType(runId || undefined);
    return suffix ? `${dt}-${phase}-${suffix}` : `${dt}-${phase}`;
  }

  // Fallback (legacy) when publishTime/ptSegment is unavailable: use runId only.
  const rid = (runId && String(runId).trim()) || 'no-runid';
  // Legacy format (updated): runId (messageId is stored on the doc, not in the ID)
  return `${rid}`;
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
