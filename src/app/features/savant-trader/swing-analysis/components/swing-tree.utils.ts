/**
 * swing-tree.utils.ts — pure helpers for the nested tree swing table.
 *
 * `buildTreeSwings` merges large swings (parents, config 0) and small swings
 * (children, config 1) into tree rows for dual-mode rendering.
 *
 * Assignment rule: a small swing belongs to the large swing active at the
 * small swing's start — `small.start.time` within `[large.start, large.end]`.
 * Large swings are consecutive segments sharing endpoint pivots, so a small
 * swing starting exactly on a shared pivot belongs to the LATER large swing
 * (the one that begins at that instant and will contain the small swing's
 * development).
 *
 * Small swings outside every parent's range (before the first parent starts
 * or after the last ends) become orphan top-level rows so no data is dropped.
 */
import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

/** A top-level tree row: a large swing with its contained small swings,
 *  or an orphan small swing (no containing parent). */
export interface TreeSwingRow extends Swing {
  /** Small swings whose start time falls inside this swing's range. */
  children: Swing[];
  /** True when this row is an unassigned small swing (no containing parent). */
  isOrphan: boolean;
}

/**
 * Build tree rows from large and small swing arrays.
 *
 * Returns top-level rows sorted chronologically by start time — large swings
 * carry their assigned small swings in `children` (sorted chronologically);
 * unassigned small swings appear as orphan rows (`isOrphan: true`,
 * `children: []`). Does not mutate inputs.
 */
export function buildTreeSwings(largeSwings: Swing[], smallSwings: Swing[]): TreeSwingRow[] {
  const parents: TreeSwingRow[] = largeSwings.map((s) => ({ ...s, children: [], isOrphan: false }));
  // "Later" in the assignment rule means later in TIME — sort defensively so
  // the end-scan below is correct even for unsorted input.
  parents.sort((a, b) => a.start.time - b.start.time);
  const orphans: TreeSwingRow[] = [];

  for (const small of smallSwings) {
    let assigned = false;
    // Scan from the end so a small swing starting exactly on a shared pivot
    // boundary is assigned to the LATER large swing.
    for (let i = parents.length - 1; i >= 0; i--) {
      const p = parents[i];
      if (small.start.time >= p.start.time && small.start.time <= p.end.time) {
        p.children.push(small);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      orphans.push({ ...small, children: [], isOrphan: true });
    }
  }

  // Children stay chronological regardless of input ordering.
  for (const p of parents) {
    p.children.sort((a, b) => a.start.time - b.start.time);
  }

  return [...parents, ...orphans].sort((a, b) => a.start.time - b.start.time);
}
