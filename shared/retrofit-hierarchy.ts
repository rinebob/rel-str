/**
 * Retrofit-hierarchy — pure parse/diff/plan/apply logic for the native
 * sub-issue retrofit (task #1524). Reads declared hierarchy out of legacy
 * issue-body structural sections, diffs it against actual native parentage,
 * and applies the safe edges. No I/O — the CLI script injects the gh
 * transport; the spec injects fixtures.
 *
 * `isTopicRoot` lives in ./lifecycle-tree — the BE root filter and the
 * retrofit anchors share one rule.
 */

/** A reference to an issue declared inside a structural body section.
 *  `indent` is the normalized nesting level (0 = top-level bullet). */
export interface DeclaredRef {
  issue: number;
  indent: number;
}

/** Sections whose bullets declare child issues. Everything else (`## Docs`,
 *  `## Description`, prose) is ignored. `Tasks` is a superset of the spec's
 *  section list — thread bodies declare lane children there. */
const STRUCTURAL_SECTIONS = /^(stage issues|blueprint issues|threads|tasks)$/i;

/** Extracts ordered issue refs from structural sections of an issue body.
 *  Handles `#N` refs and `/issues/N` link targets; a bullet with several refs
 *  yields one ref per issue at the same indent. */
export function extractDeclaredRefs(body: string): DeclaredRef[] {
  const refs: DeclaredRef[] = [];
  let inSection = false;
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/) ?? line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);
    if (heading) {
      inSection = STRUCTURAL_SECTIONS.test(heading[1].replace(/:$/, ''));
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (!bullet) continue;
    const indent = Math.floor(bullet[1].replace(/\t/g, '  ').length / 2);
    const inBullet = new Set<number>();
    for (const m of bullet[2].matchAll(/(?:\/issues\/|#)(\d+)/g)) {
      const issue = parseInt(m[1], 10);
      if (!inBullet.has(issue)) {
        inBullet.add(issue);
        refs.push({ issue, indent });
      }
    }
  }
  return refs;
}

/** An intended native sub-issue edge: `child` should nest under `parent`. */
export interface IntendedEdge {
  parent: number;
  child: number;
}

/** Resolves declared refs into parent→child edges. Top-level bullets nest
 *  under the anchor; indented bullets nest under the enclosing bullet's
 *  issue. First declaration wins on duplicates; self-edges are skipped. */
export function resolveEdges(anchor: number, refs: DeclaredRef[]): IntendedEdge[] {
  const edges: IntendedEdge[] = [];
  const seen = new Set<number>();
  const stack: { indent: number; issue: number }[] = [];
  for (const ref of refs) {
    while (stack.length && stack[stack.length - 1].indent >= ref.indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].issue : anchor;
    if (ref.issue !== anchor && !seen.has(ref.issue)) {
      seen.add(ref.issue);
      edges.push({ parent, child: ref.issue });
    }
    stack.push({ indent: ref.indent, issue: ref.issue });
  }
  return edges;
}

export interface ConflictEdge extends IntendedEdge {
  actualParent: number;
}

export interface EdgeDiff {
  proposed: IntendedEdge[];
  alreadyCorrect: IntendedEdge[];
  conflicts: ConflictEdge[];
  unresolved: IntendedEdge[];
}

/** Partitions intended edges against actual parentage (`parentOf` maps a
 *  child issue → its current parent number, or null when unparented).
 *  Children missing from the map are reported as unresolved, not skipped. */
export function diffEdges(intended: IntendedEdge[], parentOf: Map<number, number | null>): EdgeDiff {
  const diff: EdgeDiff = { proposed: [], alreadyCorrect: [], conflicts: [], unresolved: [] };
  for (const e of intended) {
    if (!parentOf.has(e.child)) {
      diff.unresolved.push(e);
    } else {
      const actual = parentOf.get(e.child)!;
      if (actual === e.parent) diff.alreadyCorrect.push(e);
      else if (actual === null) diff.proposed.push(e);
      else diff.conflicts.push({ ...e, actualParent: actual });
    }
  }
  return diff;
}

export interface BlockedEdge extends IntendedEdge {
  /** The ancestor that proved the cycle — always `child` itself. */
  via: number;
}

/** Partitions `proposed` into appliable edges and cycle-blocked ones. An
 *  edge (p,c) cycles when c is reachable from p by walking ancestors;
 *  `ancestorOf` resolves each node's parent (live or would-be-proposed) so
 *  callers can lazily fetch intermediate nodes the first walk never saw —
 *  matching GitHub's own circular-dependency check. */
export async function partitionBlockedCycles(
  proposed: IntendedEdge[],
  ancestorOf: (n: number) => Promise<number | null>,
): Promise<[IntendedEdge[], BlockedEdge[]]> {
  const kept: IntendedEdge[] = [];
  const blocked: BlockedEdge[] = [];
  for (const e of proposed) {
    let cur = await ancestorOf(e.parent);
    let hops = 0;
    let cycles = false;
    while (cur !== null && hops++ < 500) {
      if (cur === e.child) { cycles = true; break; }
      cur = await ancestorOf(cur);
    }
    if (cycles) blocked.push({ ...e, via: e.child });
    else kept.push(e);
  }
  return [kept, blocked];
}

/** The fetched shape the plan needs — the CLI's GraphQL reader produces it. */
export interface RetrofitIssue {
  id: string;
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  body: string;
  parentNumber: number | null;
}

/** Read side of the transport seam — injected so specs feed fixtures.
 *  Contract: every requested number must appear in the returned map
 *  (absent/unresolvable issues map to null). Callers dedupe repeated
 *  fetches of the same number by writing null for missing keys. */
export type IssueReader = (numbers: number[]) => Promise<Map<number, RetrofitIssue | null>>;

/** An edge whose child was already declared under an earlier issue —
 *  reported so declared-cycle/first-declarer drops aren't silent. */
export interface SupersededEdge extends IntendedEdge {
  declaredBy: number;
}

export interface RetrofitPlan {
  intended: IntendedEdge[];
  diff: EdgeDiff;
  blocked: BlockedEdge[];
  superseded: SupersededEdge[];
  skippedAnchorChildren: IntendedEdge[];
  details: Map<number, RetrofitIssue>;
}

/** BFS over declared structural sections: anchors → their sections →
 *  declared descendants → their own sections … until exhausted. Edges whose
 *  child is itself an anchor are skipped (never nest a Topic root under a
 *  descendant); a child declared twice keeps its first declarer and the
 *  loser is reported as superseded. */
export async function planRetrofit(
  anchors: number[],
  read: IssueReader,
): Promise<RetrofitPlan> {
  const fetched = new Map<number, RetrofitIssue | null>();
  const intended: IntendedEdge[] = [];
  const superseded: SupersededEdge[] = [];
  const skippedAnchorChildren: IntendedEdge[] = [];
  const declaredBy = new Map<number, number>(anchors.map((a) => [a, a]));
  const anchorSet = new Set(anchors);
  const queue = [...anchors];

  while (queue.length) {
    const batch = queue.splice(0, queue.length).filter((n) => !fetched.has(n));
    if (!batch.length) continue;
    const details = await read(batch);
    for (const [n, d] of details) {
      fetched.set(n, d);
      if (!d) continue;
      for (const e of resolveEdges(n, extractDeclaredRefs(d.body))) {
        if (anchorSet.has(e.child)) {
          skippedAnchorChildren.push(e);
          continue;
        }
        const existing = declaredBy.get(e.child);
        if (existing !== undefined && existing !== e.parent) {
          superseded.push({ ...e, declaredBy: existing });
          continue;
        }
        if (existing !== undefined) continue;
        declaredBy.set(e.child, e.parent);
        intended.push(e);
        if (!fetched.has(e.child)) queue.push(e.child);
      }
    }
  }

  const parentOf = new Map<number, number | null>();
  const details = new Map<number, RetrofitIssue>();
  for (const [n, d] of fetched) if (d) details.set(n, d);
  for (const e of intended) {
    if (!parentOf.has(e.child)) {
      const d = fetched.get(e.child);
      if (d) parentOf.set(e.child, d.parentNumber);
    }
  }

  const diff = diffEdges(intended, parentOf);
  // Blocked-cycle pass — ancestors are proposed parents where declared, else
  // live parents fetched lazily so chains through undeclared nodes resolve.
  const proposedParent = new Map(diff.proposed.map((e) => [e.child, e.parent]));
  const ancestorOf = async (n: number): Promise<number | null> => {
    if (proposedParent.has(n)) return proposedParent.get(n)!;
    if (!fetched.has(n)) {
      for (const [k, d] of await read([n])) {
        fetched.set(k, d);
        if (d) details.set(k, d);
      }
      // A reader that omits the key entirely (contract violation) must not
      // re-fetch on every hop — mark it definitively absent.
      if (!fetched.has(n)) fetched.set(n, null);
    }
    return fetched.get(n)?.parentNumber ?? null;
  };
  const [kept, blocked] = await partitionBlockedCycles(diff.proposed, ancestorOf);
  diff.proposed = kept;
  return { intended, diff, blocked, superseded, skippedAnchorChildren, details };
}

/** Mutation ops the apply pass needs — injected so the seam is spec-able.
 *  Implementations wrap `gh api graphql` calls in the CLI script. */
export interface MutationOps {
  addSubIssue(parentNodeId: string, childNodeId: string): void;
  /** `stateReason` is echoed back on re-close so a NOT_PLANNED/DUPLICATE
   *  parent isn't silently rewritten to COMPLETED. */
  setIssueState(issueNodeId: string, open: boolean, stateReason?: string): void;
  log(message: string): void;
}

export interface ApplyResult {
  applied: IntendedEdge[];
  failed: { edge: IntendedEdge; error: string }[];
}

/** Applies proposed edges in order. A closed parent is transiently reopened
 *  before linking and re-closed afterwards — the re-close runs in a finally
 *  so a mid-sequence failure never leaves the parent reopened, and it
 *  restores the original `stateReason`. */
export function applyEdges(
  proposed: IntendedEdge[],
  details: Map<number, { id: string; state: string; stateReason: string | null }>,
  ops: MutationOps,
): ApplyResult {
  const applied: IntendedEdge[] = [];
  const failed: { edge: IntendedEdge; error: string }[] = [];
  for (const edge of proposed) {
    const parent = details.get(edge.parent);
    const child = details.get(edge.child);
    if (!parent || !child) {
      failed.push({ edge, error: 'missing fetched detail' });
      continue;
    }
    const wasClosed = parent.state === 'CLOSED';
    try {
      if (wasClosed) {
        ops.setIssueState(parent.id, true);
        ops.log(`reopened closed parent #${edge.parent}`);
      }
      ops.addSubIssue(parent.id, child.id);
      applied.push(edge);
      ops.log(`linked #${edge.child} under #${edge.parent}`);
    } catch (err) {
      failed.push({ edge, error: String(err) });
    } finally {
      if (wasClosed) {
        try {
          ops.setIssueState(parent.id, false, parent.stateReason ?? undefined);
          ops.log(`re-closed parent #${edge.parent}`);
        } catch (err) {
          ops.log(`WARN: could not re-close parent #${edge.parent}: ${String(err)}`);
        }
      }
    }
  }
  return { applied, failed };
}
