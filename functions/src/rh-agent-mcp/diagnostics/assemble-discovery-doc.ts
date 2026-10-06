/**
 * Discovery-doc assembler (task #688).
 *
 * Pure functions: manifest × captures × live tools/list → the canonical
 * discovery markdown. The CLI wrapper is run-assemble-discovery-doc.ts.
 * Emitted doc is a DRAFT — task #689 hand-finishes it (safety notes, gap
 * callouts, curated response samples).
 */

import type { ToolCatalogDrift } from './catalog-drift';
import {
  getToolCategory,
  isFinancialMutationTool,
  isMutationTool,
  isSimulationTool,
} from '../tools/robinhood-tools';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LiveTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ManifestProbe {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  group: string;
  gate: string;
  note?: string;
}

export interface CaptureRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: string;
  capturedAt?: string;
  note?: string;
  response?: unknown;
  error?: unknown;
}

export type DriftReport = Partial<ToolCatalogDrift>;

export interface AssemblerInput {
  tools: LiveTool[];
  probes: ManifestProbe[];
  captures: CaptureRecord[];
  drift?: DriftReport;
  generatedAt: string;
}

// ── Safety classification ──────────────────────────────────────────────────

export function safetyClass(tool: string): string {
  if (isFinancialMutationTool(tool)) return 'financial mutation';
  if (isMutationTool(tool)) return 'account write';
  if (isSimulationTool(tool)) return 'simulation';
  return 'read-only';
}

// ── Response field tree ────────────────────────────────────────────────────

export interface FieldNode {
  types: Set<string>;
  children: Map<string, FieldNode>;
  /** Array element types + merged children of object items. */
  itemTypes: Set<string>;
  itemChildren: Map<string, FieldNode>;
}

const newNode = (): FieldNode => ({
  types: new Set(),
  children: new Map(),
  itemTypes: new Set(),
  itemChildren: new Map(),
});

function observe(node: FieldNode, value: unknown): void {
  if (value === null || value === undefined) {
    node.types.add('null');
  } else if (Array.isArray(value)) {
    node.types.add('array');
    for (const item of value) {
      if (item === null || item === undefined) node.itemTypes.add('null');
      else if (Array.isArray(item)) node.itemTypes.add('array');
      else if (typeof item === 'object') {
        node.itemTypes.add('object');
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          let child = node.itemChildren.get(k);
          if (!child) node.itemChildren.set(k, (child = newNode()));
          observe(child, v);
        }
      } else node.itemTypes.add(typeof item);
    }
  } else if (typeof value === 'object') {
    node.types.add('object');
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      let child = node.children.get(k);
      if (!child) node.children.set(k, (child = newNode()));
      observe(child, v);
    }
  } else {
    node.types.add(typeof value);
  }
}

/** Merge every success response into one field tree keyed by root field. */
export function buildFieldTree(responses: unknown[]): Map<string, FieldNode> {
  const roots = new Map<string, FieldNode>();
  for (const res of responses) {
    if (res !== null && typeof res === 'object' && !Array.isArray(res)) {
      for (const [k, v] of Object.entries(res as Record<string, unknown>)) {
        let child = roots.get(k);
        if (!child) roots.set(k, (child = newNode()));
        observe(child, v);
      }
    } else {
      let child = roots.get('(root)');
      if (!child) roots.set('(root)', (child = newNode()));
      observe(child, res);
    }
  }
  return roots;
}

const MAX_DEPTH = 7;
const MAX_KEYS = 40;

function typeLabel(n: FieldNode): string {
  const parts = [...n.types].sort();
  return parts
    .map((t) => {
      if (t !== 'array') return t;
      const inner = [...n.itemTypes].sort().join(' | ') || 'unknown';
      return `array<${inner}>`;
    })
    .join(' | ');
}

function renderChildren(
  children: Map<string, FieldNode>,
  depth: number,
  lines: string[],
  prefix: string,
): void {
  const keys = [...children.keys()];
  const shown = keys.slice(0, MAX_KEYS);
  for (const key of shown) {
    const n = children.get(key)!;
    lines.push(`${'  '.repeat(depth)}- \`${key}\`${prefix}: ${typeLabel(n)}`);
    if (depth < MAX_DEPTH) {
      if (n.children.size) renderChildren(n.children, depth + 1, lines, '');
      if (n.itemChildren.size) renderChildren(n.itemChildren, depth + 1, lines, '[]');
    }
  }
  if (keys.length > shown.length) {
    lines.push(`${'  '.repeat(depth)}- … (+${keys.length - shown.length} more fields)`);
  }
}

export function renderFieldTree(roots: Map<string, FieldNode>): string {
  const lines: string[] = [];
  renderChildren(roots, 0, lines, '');
  return lines.join('\n');
}

// ── Params table ───────────────────────────────────────────────────────────

function schemaType(prop: Record<string, unknown>): string {
  const t = prop.type;
  if (Array.isArray(t)) return (t as string[]).join(' \\| ');
  if (typeof t === 'string') return t;
  if (Array.isArray(prop.anyOf) || Array.isArray(prop.oneOf)) return 'union';
  return 'unknown';
}

function renderParamsTable(tool: LiveTool): string {
  const schema = tool.inputSchema ?? {};
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);
  const names = Object.keys(props);
  if (!names.length) return '_No parameters._';
  const lines = [
    '| param | type | required | description |',
    '|---|---|---|---|',
  ];
  for (const name of names) {
    const p = props[name];
    const raw = typeof p.description === 'string' ? p.description : '';
    const flat = raw.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
    const desc = flat.length > 160 ? flat.slice(0, 157) + '…' : flat;
    lines.push(`| ${name} | ${schemaType(p)} | ${required.has(name) ? 'yes' : 'no'} | ${desc} |`);
  }
  return lines.join('\n');
}

// ── Coverage matrix ────────────────────────────────────────────────────────

function toolStatus(probes: ManifestProbe[], captures: CaptureRecord[]): string {
  if (!probes.length) return 'missing';
  if (!captures.length) return 'unprobed';
  if (captures.some((c) => c.outcome === 'success')) return 'probed';
  if (captures.every((c) => c.outcome === 'skipped')) return 'declined';
  return 'error-only';
}

// ── Main assembler ─────────────────────────────────────────────────────────

const CATEGORY_ORDER = [
  'Account & Performance',
  'Market Data & Research',
  'Options',
  'Crypto',
  'Alerts',
  'SEC Filings',
  'Scanners',
  'Watchlists',
  'Orders',
];

export function assembleDiscoveryDoc(input: AssemblerInput): string {
  const probesByTool = new Map<string, ManifestProbe[]>();
  for (const p of input.probes) {
    const list = probesByTool.get(p.tool) ?? [];
    list.push(p);
    probesByTool.set(p.tool, list);
  }
  const capturesByTool = new Map<string, CaptureRecord[]>();
  for (const c of input.captures) {
    const list = capturesByTool.get(c.tool) ?? [];
    list.push(c);
    capturesByTool.set(c.tool, list);
  }

  const byCategory = new Map<string, LiveTool[]>();
  for (const t of input.tools) {
    const cat = getToolCategory(t.name) ?? 'Other';
    const list = byCategory.get(cat) ?? [];
    list.push(t);
    byCategory.set(cat, list);
  }

  const out: string[] = [];
  out.push('# Robinhood MCP — Canonical Tool Discovery');
  out.push('');
  out.push(`> **Generated draft** (${input.generatedAt}) — assembled from ` +
    `\`probe-manifest.json\` × \`captures/\` × live \`tools/list\`. ` +
    'Hand-finished by task #689: safety notes, gap callouts, curated samples.');
  out.push('');

  // Coverage matrix
  out.push('## Coverage matrix');
  out.push('');
  out.push('| tool | category | params (req/total) | probes | outcomes | status |');
  out.push('|---|---|---|---|---|---|');
  for (const t of input.tools) {
    const probes = probesByTool.get(t.name) ?? [];
    const captures = capturesByTool.get(t.name) ?? [];
    const schema = t.inputSchema ?? {};
    const total = Object.keys((schema.properties ?? {}) as object).length;
    const req = ((schema.required ?? []) as string[]).length;
    const outcomes = captures.length
      ? ['success', 'error', 'skipped']
          .map((o) => {
            const n = captures.filter((c) => c.outcome === o).length;
            return n ? `${n} ${o}` : null;
          })
          .filter(Boolean)
          .join(', ')
      : '—';
    out.push(
      `| ${t.name} | ${getToolCategory(t.name) ?? 'Other'} | ${req}/${total} | ` +
      `${probes.length || '—'} | ${outcomes} | ${toolStatus(probes, captures)} |`,
    );
  }
  out.push('');

  // Drift
  if (input.drift) {
    const d = input.drift;
    out.push('## Drift — bundled catalog vs live tools/list');
    out.push('');
    out.push(`- Live tools: **${d.liveToolCount ?? '?'}** · catalog: **${d.catalogToolCount ?? '?'}** · generated ${d.generatedAt ?? '?'}`);
    if (d.added?.length) out.push(`- Added on live: ${d.added.map((x) => `\`${x}\``).join(', ')}`);
    if (d.removed?.length) out.push(`- Removed: ${d.removed.map((x) => `\`${x}\``).join(', ')}`);
    if (d.possiblyRenamed?.length) {
      out.push(`- Possibly renamed: ${d.possiblyRenamed.map((r) => `\`${r.from}→${r.to}\``).join(', ')}`);
    }
    if (d.changed?.length) {
      out.push(`- Changed schemas: ${d.changed.map((c) => `\`${c.tool}\``).join(', ')}`);
    }
    if (!d.hasDrift) out.push('- No drift detected.');
    out.push('');
  }

  // Per-category tool sections
  const cats = [...byCategory.keys()].sort(
    (a, b) =>
      (CATEGORY_ORDER.indexOf(a) === -1 ? CATEGORY_ORDER.length : CATEGORY_ORDER.indexOf(a)) -
      (CATEGORY_ORDER.indexOf(b) === -1 ? CATEGORY_ORDER.length : CATEGORY_ORDER.indexOf(b)),
  );
  for (const cat of cats) {
    out.push(`## ${cat}`);
    out.push('');
    for (const t of byCategory.get(cat)!.sort((a, b) => a.name.localeCompare(b.name))) {
      const probes = probesByTool.get(t.name) ?? [];
      const captures = capturesByTool.get(t.name) ?? [];
      const status = toolStatus(probes, captures);
      const successes = captures.filter((c) => c.outcome === 'success' && c.response !== undefined);
      const errors = captures.filter((c) => c.outcome === 'error');

      out.push(`### ${t.name}`);
      out.push('');
      out.push(`**Safety:** ${safetyClass(t.name)} · **Status:** ${status}`);
      if (t.description) out.push(`\n${t.description}`);
      out.push('');
      out.push('**Parameters (live inputSchema):**');
      out.push('');
      out.push(renderParamsTable(t));
      out.push('');
      if (successes.length) {
        out.push(`**Response field tree** (union over ${successes.length} success capture(s)):`);
        out.push('');
        out.push(renderFieldTree(buildFieldTree(successes.map((c) => c.response))));
        out.push('');
      }
      if (errors.length) {
        const kinds = new Map<string, number>();
        for (const e of errors) {
          const msg = JSON.stringify(e.response ?? e.error ?? '').slice(0, 120);
          kinds.set(msg, (kinds.get(msg) ?? 0) + 1);
        }
        out.push(`**Errors observed:** ${errors.length} capture(s), ${kinds.size} distinct shape(s)`);
        out.push('');
      }
      if (captures.length) {
        out.push('**Captures:**');
        out.push('');
        for (const c of captures) {
          const note = c.note ?? probes.find((p) => p.id === c.id)?.note ?? '';
          out.push(`- [${c.id}](captures/${c.id}.json) — ${c.outcome}${note ? ` — ${note}` : ''}`);
        }
        out.push('');
      } else if (probes.length) {
        out.push('_No captures — probes authored but not yet executed._');
        out.push('');
      } else {
        out.push('_No captures — missing probes._');
        out.push('');
      }
      const notes = probes.map((p) => p.note).filter(Boolean);
      if (notes.length) {
        out.push('**Notes:**');
        out.push('');
        for (const n of new Set(notes)) out.push(`- ${n}`);
        out.push('');
      }
    }
  }

  return out.join('\n');
}
