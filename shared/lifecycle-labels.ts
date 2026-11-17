/**
 * Label-management shared contracts — request/response shapes for the
 * listRepoLabels / updateIssueLabels / manageRepoLabel callables, plus
 * the system-label guard the FE picker hides and the BE enforces
 * (Blueprint #1519 / task #1523).
 */

import type { LifecycleRepoRequest } from './lifecycle-contracts';

/** A repo label as returned by `GET /repos/{o}/{r}/labels`. */
export interface RepoLabel {
  name: string;
  /** 6-hex RGB without the leading '#'. */
  color: string;
  description: string | null;
}

export type ListRepoLabelsRequest = LifecycleRepoRequest;

export interface ListRepoLabelsResponse {
  labels: RepoLabel[];
  fetchedAt: string;
}

export interface UpdateIssueLabelsRequest extends LifecycleRepoRequest {
  issueNumber: number;
  /** Names missing from the repo's label set are created, then attached. */
  add?: string[];
  /** Absent labels are an idempotent no-op. */
  remove?: string[];
}

export interface UpdateIssueLabelsResponse {
  /** Label names on the issue after the update. */
  labels: string[];
  /** Repo labels minted on the way — the subset of `add` that was new. */
  created: string[];
}

export type ManageRepoLabelOp = 'create' | 'update' | 'delete';

export interface ManageRepoLabelRequest extends LifecycleRepoRequest {
  op: ManageRepoLabelOp;
  /** Required for all ops. */
  name: string;
  /** `update` only. */
  newName?: string;
  /** `create`/`update`; server defaults when absent on create. */
  color?: string;
  description?: string;
}

export interface ManageRepoLabelResponse {
  op: ManageRepoLabelOp;
  /** `delete` only — issues carrying the label at delete time, so the
   *  FE can confirm deleting an in-use label (GitHub detaches). Counted
   *  via the `issues?labels=` filter — eventually consistent: a label
   *  attached within the last few seconds may under-read. */
  usageCount?: number;
}

// ── System-label guard ────────────────────────────────────────────────────

/**
 * Lifecycle stage labels encode workflow state — they are never editable
 * through the label-management surface. `updateIssueLabels` rejects
 * matching names in both `add` and `remove` server-side; the FE picker
 * hides the wider `isSystemLabel` set.
 *
 * Deliberately a PATTERN, not the exact `STAGE_LABELS` list in
 * lifecycle-tree.ts: `5_FOO` would mint or erase workflow state just
 * like `5_IMPLEMENT`, so any `[1-8]_`-prefixed name is rejected.
 */
export const STAGE_LABEL_PATTERN = /^[1-8]_/;

/**
 * Labels the label manager may not create/update/delete and the FE
 * picker hides from attach/detach lists — they encode the workflow and
 * taxonomy rather than freeform tagging.
 *
 * MIRRORED, manually synced with `project-config.json`: `stageLabels`
 * (the pattern above), `fields.Category.options` (CATEGORY_LABELS), and
 * `domainLabels` (DOMAIN_LABELS — extended with repo-observed names the
 * stale config list does not yet carry). Update both together.
 */
/** Task-type + area labels (canonical source: proj REFERENCE.md). */
export const STRUCTURAL_LABELS = new Set([
  'IMPL', 'QA', 'BE', 'FE', 'SHARED', 'CONFIG', 'CHORE', 'DOCS', 'BUG',
  'TRIAGE',
  // Same workflow-type family observed on the repo label list.
  'REFACTOR', 'TESTING', 'BLOCKED', 'WONTFIX',
]);

/** Category field options (canonical source: project-config.json). */
export const CATEGORY_LABELS = new Set([
  'FEATURE', 'TECH DEBT', 'CORE', 'APP', 'PARTNER', 'INTERNAL', 'MAINT',
]);

export const DOMAIN_LABELS = new Set([
  // project-config.json domainLabels
  'SAVANT-TRADER', 'RS', 'OPTIONS', 'SPREAD-PRICING', 'RUN-DASHBOARD',
  'SIGNAL-REVIEW', 'CHART-REVIEW', 'ORDER', 'PORTFOLIO', 'BACKTEST',
  'MULTI-LEG-SPREAD', 'DATA-PIPELINE', 'STRAT-LIB', 'STRAT-MANAGE',
  'WORKFLOWS', 'SCREENSHOT',
  // Repo-observed domain labels not yet in the config list
  'DEV-TOOLS', 'DESIGN-SYSTEM', 'INDICATOR-LIB', 'PAPER-TRADING',
  'RH-AGENT', 'RH-MCP', 'RH-ACTUAL', 'RH-AGENT-OBSERVATION',
  'RH-FUNDAMENTALS', 'FLEX-CHART', 'GALLERY-VIEW',
  'HYBRID-QUOTE-PROVIDER', 'SAV-TRAD-NAV', 'SPREAD-VIEWER',
  'STRAT-BUILD-UI', 'STRATEGIES', 'SWING-ANALYSIS', 'WATCHLIST',
]);

/**
 * The full system-label vocabulary as one aggregate — every exact name
 * `isSystemLabel` rejects (stage-prefix matches come from
 * `STAGE_LABEL_PATTERN`, not this set). Exported per #1523 so the FE
 * picker and BE enforcement share the same constant.
 */
export const SYSTEM_LABEL_PATTERNS: ReadonlySet<string> = new Set([
  ...STRUCTURAL_LABELS,
  ...CATEGORY_LABELS,
  ...DOMAIN_LABELS,
]);

/**
 * Case-insensitive: GitHub resolves label names case-insensitively, so
 * `'impl'` attaches `'IMPL'` — the name-set check compares uppercased.
 */
export function isSystemLabel(name: string): boolean {
  return (
    STAGE_LABEL_PATTERN.test(name) ||
    SYSTEM_LABEL_PATTERNS.has(name.toUpperCase())
  );
}
