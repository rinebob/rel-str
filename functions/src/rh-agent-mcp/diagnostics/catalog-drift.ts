/**
 * Catalog drift — diff the live `tools/list` response against the bundled
 * static catalog (`functions/.rh-mcp-tool-catalog.json`).
 *
 * The bundled catalog is a snapshot (`generated` date stamped at the top of
 * the JSON); the live server can add, remove, rename, or re-shape tools at
 * any time. The sweep (#684) and discovery doc (#689) read
 * `captures/00-drift.json` — a drifted catalog means captured params may not
 * match what the server actually accepts.
 *
 * Name normalization: live tools may carry the `mcp__robinhood-trading__`
 * prefix; both sides are stripped to short names before diffing.
 */
import {
  connectLocalRobinhoodMcpSession,
  type ConnectLocalRobinhoodMcpSessionOptions,
} from '../auth/robinhood-mcp-connection';
import { stripServerPrefix } from '../tools/robinhood-tools';
import { isPlainObject } from '@robinhood-mcp/utils';

export interface DriftToolEntry {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface RenamedPair {
  /** Short name in the bundled catalog. */
  from: string;
  /** Short name on the live server. */
  to: string;
}

export interface ChangedTool {
  tool: string;
  /** Human-readable leaf diffs, e.g. `properties.limit.type: string -> number`. */
  diffs: string[];
}

export interface ToolCatalogDrift {
  generatedAt: string;
  catalogGenerated?: string;
  catalogSource?: string;
  liveToolCount: number;
  catalogToolCount: number;
  /** Live tools not in the catalog (short names). */
  added: string[];
  /** Catalog tools absent from the live list. */
  removed: string[];
  /** removed↔added pairs with identical inputSchema AND description —
   *  probable renames. May contain multiple candidates per side when the
   *  match is ambiguous (e.g. two no-arg tools sharing an empty schema). */
  possiblyRenamed: RenamedPair[];
  /** Short names that collided after stripping the server prefix (live list
   *  carrying both `x` and `mcp__robinhood-trading__x`, or dupes within one
   *  side) — the Map keeps the last entry, so counts would otherwise hide it. */
  nameCollisions: string[];
  /** Same-name tools whose schema/description differs. */
  changed: ChangedTool[];
  /** Same-name tools with no detectable difference. */
  unchanged: string[];
  hasDrift: boolean;
}

export interface DriftMeta {
  catalogGenerated?: string;
  catalogSource?: string;
  now?: Date;
}

/** Schema keys whose array values are SETS per JSON Schema — reorder is
 *  semantically null, so canonicalize sorts them (any element type). */
const SET_VALUED_KEYS = new Set([
  'enum', 'required', 'type', 'oneOf', 'anyOf', 'allOf',
]);

/** Canonical JSON: recursively sorted object keys; arrays under set-valued
 *  schema keys sort regardless of element type. Everywhere else order is
 *  significant (`items` tuples, `default`/`examples` lists). */
function canonicalize(value: unknown, keyHint?: string): string {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalize(v));
    if (keyHint !== undefined && SET_VALUED_KEYS.has(keyHint)) {
      items.sort();
    }
    return `[${items.join(',')}]`;
  }
  if (isPlainObject(value)) {
    const pairs = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k], k)}`);
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(value);
}

const sortedSetDiff = (
  a: unknown,
  b: unknown,
): { added: string[]; removed: string[] } => {
  const left = new Set(Array.isArray(a) ? a.map(String) : []);
  const right = new Set(Array.isArray(b) ? b.map(String) : []);
  return {
    added: [...right].filter((x) => !left.has(x)).sort(),
    removed: [...left].filter((x) => !right.has(x)).sort(),
  };
};

/** Shallow leaf diff for a single property's subschema — reports type,
 *  enum, and description changes; falls back to a generic marker for
 *  anything deeper. */
function diffPropertySchema(
  key: string,
  from: unknown,
  to: unknown,
): string[] {
  const f = isPlainObject(from) ? (from as Record<string, unknown>) : {};
  const t = isPlainObject(to) ? (to as Record<string, unknown>) : {};
  const diffs: string[] = [];

  // `type` may be scalar or an array (e.g. ["null","array"]) — normalize to
  // an array so "string" == ["string"], then compare as a set.
  const typeArr = (v: unknown): unknown[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  if (canonicalize(typeArr(f.type), 'type') !== canonicalize(typeArr(t.type), 'type')) {
    diffs.push(
      `properties.${key}.type: ${JSON.stringify(f.type)} -> ${JSON.stringify(t.type)}`,
    );
  }
  const enumDiff = sortedSetDiff(f.enum, t.enum);
  if (enumDiff.added.length || enumDiff.removed.length) {
    const parts = [
      ...enumDiff.added.map((v) => `+${v}`),
      ...enumDiff.removed.map((v) => `-${v}`),
    ];
    diffs.push(`properties.${key}.enum: ${parts.join(', ')}`);
  }
  if (f.description !== t.description && (f.description !== undefined || t.description !== undefined)) {
    diffs.push(`properties.${key}.description: changed`);
  }

  // Generic check on the property minus keys the leaf diffs already cover —
  // leaf logic normalizes (e.g. scalar vs array `type`), the raw values
  // would phantom-diff. Runs even when leaf diffs fired so a change to
  // `minimum`/`pattern`/`items` alongside a type change still surfaces.
  const leafKeys = new Set(['type', 'enum', 'description']);
  const strip = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !leafKeys.has(k)));
  if (canonicalize(strip(f)) !== canonicalize(strip(t))) {
    diffs.push(`properties.${key}: other fields changed`);
  }
  return diffs;
}

function diffToolSchema(
  name: string,
  from: DriftToolEntry,
  to: DriftToolEntry,
): ChangedTool | undefined {
  const diffs: string[] = [];

  if (from.description !== to.description) {
    diffs.push('description: changed');
  }

  const fs = from.inputSchema;
  const ts = to.inputSchema;

  const req = sortedSetDiff(fs.required, ts.required);
  for (const r of req.added) diffs.push(`required: +${r}`);
  for (const r of req.removed) diffs.push(`required: -${r}`);

  // additionalProperties may be a schema object, not just a boolean.
  if (canonicalize(fs.additionalProperties) !== canonicalize(ts.additionalProperties)) {
    diffs.push(
      `additionalProperties: ${JSON.stringify(fs.additionalProperties)} -> ${JSON.stringify(ts.additionalProperties)}`,
    );
  }

  const fp = isPlainObject(fs.properties) ? fs.properties : {};
  const tp = isPlainObject(ts.properties) ? ts.properties : {};
  const propDiff = sortedSetDiff(Object.keys(fp), Object.keys(tp));
  for (const k of propDiff.added) diffs.push(`+properties.${k}`);
  for (const k of propDiff.removed) diffs.push(`-properties.${k}`);
  for (const key of Object.keys(fp)) {
    // Object.hasOwn, not `in` — a property literally named `constructor`/
    // `toString` would otherwise match the prototype chain and double-report.
    if (Object.hasOwn(tp, key)) {
      diffs.push(...diffPropertySchema(key, fp[key], tp[key]));
    }
  }

  // Catch-all for root-level changes outside the keys above (root `type`,
  // `$schema`, `$defs`, `minProperties`, etc.) — leaf diffs cover
  // properties/required/additionalProperties; this catches everything else.
  const comparedKeys = new Set(['properties', 'required', 'additionalProperties']);
  const remainder = (s: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(s).filter(([k]) => !comparedKeys.has(k)));
  if (canonicalize(remainder(fs)) !== canonicalize(remainder(ts))) {
    diffs.push('inputSchema: root changed beyond properties/required/additionalProperties');
  }

  return diffs.length ? { tool: name, diffs } : undefined;
}

export function diffToolCatalog(
  liveTools: readonly DriftToolEntry[],
  catalogTools: readonly DriftToolEntry[],
  meta: DriftMeta = {},
): ToolCatalogDrift {
  const toMap = (tools: readonly DriftToolEntry[]): Map<string, DriftToolEntry> => {
    const map = new Map<string, DriftToolEntry>();
    for (const t of tools) map.set(stripServerPrefix(t.name), t);
    return map;
  };
  const collisions = (tools: readonly DriftToolEntry[]): string[] => {
    const counts = new Map<string, number>();
    for (const t of tools) {
      const n = stripServerPrefix(t.name);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
  };
  const live = toMap(liveTools);
  const catalog = toMap(catalogTools);
  const nameCollisions = [
    ...new Set([...collisions(liveTools), ...collisions(catalogTools)]),
  ].sort();

  const added = [...live.keys()].filter((n) => !catalog.has(n)).sort();
  const removed = [...catalog.keys()].filter((n) => !live.has(n)).sort();

  // Rename hint: schema+description identical → probably the same tool
  // renamed. Emit every matching pair — multiple candidates on either side
  // is the ambiguity signal, better than silently picking the first match.
  const identityKey = (t: DriftToolEntry) =>
    `${canonicalize(t.inputSchema)}|${t.description ?? ''}`;
  const addedByKey = new Map<string, string[]>();
  for (const n of added) {
    const key = identityKey(live.get(n) as DriftToolEntry);
    addedByKey.set(key, [...(addedByKey.get(key) ?? []), n]);
  }
  const possiblyRenamed: RenamedPair[] = [];
  for (const n of removed) {
    const matches = addedByKey.get(identityKey(catalog.get(n) as DriftToolEntry));
    for (const to of matches ?? []) possiblyRenamed.push({ from: n, to });
  }

  const changed: ChangedTool[] = [];
  const unchanged: string[] = [];
  for (const [name, liveEntry] of live) {
    const cat = catalog.get(name);
    if (!cat) continue;
    const diff = diffToolSchema(name, cat, liveEntry);
    if (diff) changed.push(diff);
    else unchanged.push(name);
  }
  changed.sort((a, b) => a.tool.localeCompare(b.tool));
  unchanged.sort();

  return {
    generatedAt: (meta.now ?? new Date()).toISOString(),
    catalogGenerated: meta.catalogGenerated,
    catalogSource: meta.catalogSource,
    liveToolCount: live.size,
    catalogToolCount: catalog.size,
    added,
    removed,
    possiblyRenamed,
    changed,
    unchanged,
    nameCollisions,
    hasDrift:
      added.length > 0 ||
      removed.length > 0 ||
      changed.length > 0 ||
      nameCollisions.length > 0,
  };
}

/** Fetch the live `tools/list` via the local authenticated MCP session.
 *  Names are returned RAW (as the server sent them) — the server currently
 *  returns short names; callers that need normalization should strip the
 *  prefix (diffToolCatalog already does so internally). */
export async function fetchLiveToolList(
  options: ConnectLocalRobinhoodMcpSessionOptions = {},
): Promise<DriftToolEntry[]> {
  const connection = await connectLocalRobinhoodMcpSession(options);
  try {
    const tools = await connection.session.getToolDefinitions();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (isPlainObject(t.inputSchema)
        ? t.inputSchema
        : {}) as Record<string, unknown>,
    }));
  } finally {
    await connection.close().catch(() => undefined);
  }
}
