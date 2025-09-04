

// Helper to convert Date/number to timestamp for safe comparison
export function toTimestamp(val: unknown): number {
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    return NaN;
}