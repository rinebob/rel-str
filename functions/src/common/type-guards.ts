/**
 * Shared type guards used across Cloud Functions.
 */

/** Type guard for a Firestore Timestamp value (as opposed to FieldValue). */
export function isTimestamp(value: unknown): value is FirebaseFirestore.Timestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  );
}
