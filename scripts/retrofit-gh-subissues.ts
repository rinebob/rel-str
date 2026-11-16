/**
 * Retrofit GitHub native sub-issues (task #1524, SHARED Blueprint #1519).
 *
 * Legacy Topics declare their hierarchy in body markdown (`## Stage Issues`,
 * `## Blueprint Issues`, `## Threads`, `## Tasks`) but never got native
 * GitHub sub-issue links, so the getLifecycleTree BFS — which walks only
 * native `subIssues` — returns a gutted tree.
 *
 * This script diffs the declared hierarchy against actual native parentage:
 *   dry-run (default) — prints proposed edges, conflicts, unresolved refs.
 *   --apply           — links every proposed edge via GraphQL addSubIssue,
 *                       transiently reopening closed parents (restoring
 *                       their stateReason) as needed. Conflicts, blocked
 *                       cycles, and superseded declarations are always
 *                       report-only; the script never reparents.
 *
 * Usage:
 *   npx tsx scripts/retrofit-gh-subissues.ts                       # dry-run, both repos
 *   npx tsx scripts/retrofit-gh-subissues.ts --repo rinebob/rel-str
 *   npx tsx scripts/retrofit-gh-subissues.ts --only 137            # one anchor
 *   npx tsx scripts/retrofit-gh-subissues.ts --apply --only 137    # apply one anchor
 *
 * Full reports land in .devin/tmp/retrofit-gh-subissues-*.json.
 * Exit codes: 0 clean · 2 conflicts/blocked present · 3 apply failures.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SUPPORTED_REPOS } from '../functions/src/gh-lifecycle/config';
import { isTopicRoot } from '../shared/lifecycle-tree';
import {
  planRetrofit,
  applyEdges,
  type IntendedEdge,
  type RetrofitIssue,
  type RetrofitPlan,
  type ApplyResult,
} from '../shared/retrofit-hierarchy';

interface RepoRef {
  owner: string;
  repo: string;
}

const DEFAULT_REPOS: RepoRef[] = SUPPORTED_REPOS.map(({ owner, repo }) => ({ owner, repo }));

interface IssueLite {
  number: number;
  title: string;
  state: string;
}

// ── gh transport ──────────────────────────────────────────────────────────

/** Strict gh call — any non-zero exit throws. Mutations MUST use this:
 *  GraphQL `errors` on a mutation mean the write did not happen. */
function ghJson(args: string[]): unknown {
  const out = execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

/** Fetch-tolerant gh call — `gh api graphql` exits non-zero on GraphQL
 *  `errors` even when `data` carries the resolvable nodes (e.g. refs to
 *  deleted issues). Queries recover partial data; anything else throws. */
function ghJsonPartial(args: string[]): unknown {
  try {
    return ghJson(args);
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout) as { data?: unknown };
        if (parsed.data) return parsed;
      } catch {
        // stdout wasn't JSON — fall through to the real error.
      }
    }
    throw err;
  }
}

function listIssues(repo: RepoRef): IssueLite[] {
  return ghJson([
    'issue', 'list', '--repo', `${repo.owner}/${repo.repo}`,
    '--search', 'Topic: in:title', '--state', 'all', '--limit', '400',
    '--json', 'number,title,state',
  ]) as IssueLite[];
}

const ISSUE_FIELDS = 'id number title state stateReason body parent { number }';
const BATCH = 15;

/** Fetches full details (incl. native parent + stateReason) for issue
 *  numbers in one repo via aliased GraphQL batches. Missing/foreign
 *  numbers come back null. Implements the shared `IssueReader` seam. */
async function fetchDetails(repo: RepoRef, numbers: number[]): Promise<Map<number, RetrofitIssue | null>> {
  const out = new Map<number, RetrofitIssue | null>();
  for (let i = 0; i < numbers.length; i += BATCH) {
    const slice = numbers.slice(i, i + BATCH);
    const aliases = slice.map((n, k) => `i${k}: issue(number: ${n}) { ${ISSUE_FIELDS} }`).join(' ');
    const query = `query { repository(owner: "${repo.owner}", name: "${repo.repo}") { ${aliases} } }`;
    const res = ghJsonPartial(['api', 'graphql', '-f', `query=${query}`]) as {
      data: { repository: Record<string, {
        id: string; number: number; title: string; state: string;
        stateReason: string | null; body: string | null;
        parent: { number: number } | null;
      } | null> };
    };
    if (!res.data?.repository) {
      throw new Error(`repository ${repo.owner}/${repo.repo} did not resolve (check --repo, auth, or rate limit)`);
    }
    slice.forEach((n, k) => {
      const node = res.data.repository[`i${k}`];
      out.set(n, node ? {
        id: node.id, number: node.number, title: node.title,
        state: node.state, stateReason: node.stateReason ?? null,
        body: node.body ?? '', parentNumber: node.parent?.number ?? null,
      } : null);
    });
  }
  return out;
}

function gql(mutation: string): unknown {
  return ghJson(['api', 'graphql', '-f', `query=${mutation}`]);
}

function addSubIssue(parentId: string, childId: string): void {
  gql(`mutation { addSubIssue(input: { issueId: "${parentId}", subIssueId: "${childId}" }) { issue { number } } }`);
}

function setIssueState(issueId: string, open: boolean, stateReason?: string): void {
  if (open) {
    gql(`mutation { reopenIssue(input: { issueId: "${issueId}" }) { issue { number state } } }`);
  } else {
    const reason = stateReason ? `, stateReason: ${stateReason}` : '';
    gql(`mutation { closeIssue(input: { issueId: "${issueId}"${reason} }) { issue { number state stateReason } } }`);
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { repos: RepoRef[]; only: Set<number> | null; apply: boolean } {
  const repos: RepoRef[] = [];
  const only = new Set<number>();
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--repo') {
      const [owner, repo] = (argv[++i] ?? '').split('/');
      if (!owner || !repo) throw new Error('--repo expects owner/name');
      repos.push({ owner, repo });
    } else if (a === '--only') {
      for (const part of (argv[++i] ?? '').split(',')) {
        const n = parseInt(part, 10);
        if (Number.isFinite(n) && n > 0) only.add(n);
      }
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/retrofit-gh-subissues.ts [--repo owner/name]... [--only n[,n...]] [--apply]');
      process.exit(0);
    } else throw new Error(`unknown arg: ${a}`);
  }
  return { repos: repos.length ? repos : DEFAULT_REPOS, only: only.size ? only : null, apply };
}

function printPlan(repo: RepoRef, anchors: IssueLite[], plan: RetrofitPlan): void {
  const { diff } = plan;
  console.log(`\n=== ${repo.owner}/${repo.repo} ===`);
  console.log(`anchors scanned: ${anchors.length} · intended edges: ${plan.intended.length}`);
  console.log(`already correct: ${diff.alreadyCorrect.length} · proposed: ${diff.proposed.length} · conflicts: ${diff.conflicts.length} · blocked-cycles: ${plan.blocked.length} · unresolved: ${diff.unresolved.length} · superseded: ${plan.superseded.length}`);
  for (const e of diff.proposed) console.log(`  PROPOSE  #${e.child} under #${e.parent}`);
  for (const c of diff.conflicts) console.log(`  CONFLICT #${c.child} under #${c.parent} — already parented to #${c.actualParent}`);
  for (const b of plan.blocked) console.log(`  BLOCKED  #${b.child} under #${b.parent} — would create a cycle`);
  for (const u of diff.unresolved) console.log(`  UNRESOLVED #${u.child} under #${u.parent} — not found in repo`);
  for (const s of plan.superseded) console.log(`  SUPERSEDED #${s.child} under #${s.parent} — already declared under #${s.declaredBy}`);
  for (const s of plan.skippedAnchorChildren) console.log(`  SKIPPED  #${s.child} under #${s.parent} — child is a Topic root`);
}

async function main(): Promise<void> {
  const { repos, only, apply } = parseArgs(process.argv.slice(2));
  mkdirSync('.devin/tmp', { recursive: true });
  let conflicts = 0;
  let failures = 0;
  for (const repo of repos) {
    const anchors = listIssues(repo)
      .filter((i) => isTopicRoot(i.title))
      .filter((i) => !only || only.has(i.number));
    const plan = await planRetrofit(anchors.map((a) => a.number), (numbers) => fetchDetails(repo, numbers));
    printPlan(repo, anchors, plan);
    conflicts += plan.diff.conflicts.length + plan.blocked.length;
    let applied: ApplyResult = { applied: [], failed: [] };
    if (apply) {
      applied = applyEdges(plan.diff.proposed, plan.details, {
        addSubIssue,
        setIssueState,
        log: (m) => console.log(`  ${m}`),
      });
      failures += applied.failed.length;
      console.log(`applied: ${applied.applied.length} · failed: ${applied.failed.length}`);
      for (const f of applied.failed) console.log(`  FAILED   #${f.edge.child} under #${f.edge.parent} — ${f.error}`);
    }
    const reportPath = `.devin/tmp/retrofit-gh-subissues-${repo.owner}-${repo.repo}-${Date.now()}.json`;
    writeFileSync(reportPath, JSON.stringify({
      repo, apply, anchors: anchors.length, intended: plan.intended.length,
      diff: plan.diff, blocked: plan.blocked, superseded: plan.superseded,
      skippedAnchorChildren: plan.skippedAnchorChildren,
      applied: applied.applied, failed: applied.failed,
    }, null, 2));
    console.log(`report: ${reportPath}`);
  }
  if (failures) process.exit(3);
  if (conflicts) process.exit(2);
}

main().catch((err) => { console.error(err); process.exit(1); });
