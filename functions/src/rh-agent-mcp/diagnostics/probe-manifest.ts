/**
 * Probe manifest format + loader/validator for the RH MCP tool discovery
 * run (#681, Blueprint #680).
 *
 * The manifest is the single source of truth for the discovery doc: every
 * probe entry is `{ id, tool, args, group, gate, redactFields?, note? }`.
 * `account_number` and other account-scoped values are NEVER stored — args
 * carry `"$ENV:NAME"` placeholders that the runner resolves from
 * `process.env` at call time. The loader annotates `requiredEnv` so dry-run
 * and validation never need credentials. Placeholders only work for
 * string-typed schema params (they pass validation as literal strings).
 */

import { readFile } from 'node:fs/promises';
import { isPlainObject } from '@robinhood-mcp/utils';
import {
  isMutationTool,
  listObservationTools,
  stripServerPrefix,
} from '../tools/robinhood-tools';
import { validateToolArgs } from '../tools/schema-validation';
import type { RobinhoodToolDefinition } from '@robinhood-mcp/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProbeGate = 'read' | 'mutation';

export interface ProbeManifestEntry {
  /** Unique probe id — doubles as the capture filename stem. */
  id: string;
  /** Short tool name (no `mcp__robinhood-trading__` prefix). */
  tool: string;
  /** Tool arguments; may contain `$ENV:NAME` string placeholders. */
  args: Record<string, unknown>;
  /** Free grouping for sessions/coverage (e.g. 'account', 'equity-orders'). */
  group: string;
  /** 'read' runs unattended; 'mutation' halts for a per-call y/n/abort. */
  gate: ProbeGate;
  /** Extra field names passed through to the response redactor. */
  redactFields?: string[];
  /** Curator note carried into the discovery doc. */
  note?: string;
  /** Env vars referenced via `$ENV:` placeholders in args (loader-computed). */
  requiredEnv: string[];
}

export interface ManifestIssue {
  /** Probe id when the issue is entry-scoped. */
  probeId?: string;
  message: string;
}

export interface ProbeManifestResult {
  ok: boolean;
  entries: ProbeManifestEntry[];
  errors: ManifestIssue[];
  warnings: ManifestIssue[];
}

export interface ValidateProbeManifestOptions {
  /**
   * Authoritative tool set for the tool-name + inputSchema cross-check.
   * Required for the sync validator — the runner passes the live
   * `tools/list` result; `loadProbeManifest` defaults it to the bundled
   * catalog via `listObservationTools()`.
   */
  knownTools: Iterable<RobinhoodToolDefinition>;
}

export interface LoadProbeManifestOptions {
  /** Pre-parsed manifest content — skips the file read (tests, drift tools). */
  data?: unknown;
  /** See ValidateProbeManifestOptions; defaults to the bundled catalog. */
  knownTools?: Iterable<RobinhoodToolDefinition>;
}

// ---------------------------------------------------------------------------
// Env placeholders
// ---------------------------------------------------------------------------

const ENV_PLACEHOLDER = /^\$ENV:([A-Z0-9_]+)$/;
/** Capture-file-safe probe ids: `captures/{id}.json` is derived verbatim. */
const SAFE_PROBE_ID = /^[A-Za-z0-9_-]+$/;

function collectEnvPlaceholders(
  value: unknown,
  into: Set<string>,
  malformed: Set<string>,
): void {
  if (typeof value === 'string') {
    const match = ENV_PLACEHOLDER.exec(value);
    if (match) {
      into.add(match[1]);
    } else if (value.includes('$ENV:')) {
      // Starts-with / partial / lowercase placeholders would otherwise pass
      // schema validation and be sent to the API as literal strings.
      malformed.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEnvPlaceholders(item, into, malformed);
    return;
  }
  if (isPlainObject(value)) {
    for (const v of Object.values(value)) collectEnvPlaceholders(v, into, malformed);
  }
}

/**
 * Top-level args keys not declared in the tool's inputSchema. The arg
 * validator runs `removeAdditional: true`, so a typo'd optional param would
 * be silently stripped and the probe would record coverage it never
 * exercised. Flag whenever a declared `properties` map exists and
 * `additionalProperties` isn't explicitly true — that mirrors what ajv will
 * actually drop at run time. Loose schemas (no `properties` map, or
 * additionalProperties: true) can't distinguish typo from intent, so we
 * skip them.
 */
function unknownArgKeys(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): string[] {
  if (!isPlainObject(schema.properties)) return [];
  if (schema.additionalProperties === true) return [];
  const properties = schema.properties;
  const patterns = isPlainObject(schema.patternProperties)
    ? Object.keys(schema.patternProperties).map((p) => new RegExp(p))
    : [];
  return Object.keys(args).filter(
    (key) =>
      !Object.hasOwn(properties, key) && !patterns.some((p) => p.test(key)),
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_GATES: ReadonlySet<string> = new Set<ProbeGate>(['read', 'mutation']);

function toToolMap(
  provided: Iterable<RobinhoodToolDefinition>,
): Map<string, RobinhoodToolDefinition> {
  const map = new Map<string, RobinhoodToolDefinition>();
  // Live tools/list results may carry the `mcp__robinhood-trading__` prefix —
  // normalize keys so manifest entries always use short names.
  for (const t of provided) map.set(stripServerPrefix(t.name), t);
  return map;
}

export function validateProbeManifest(
  data: unknown,
  options: ValidateProbeManifestOptions,
): ProbeManifestResult {
  const errors: ManifestIssue[] = [];
  const warnings: ManifestIssue[] = [];
  const entries: ProbeManifestEntry[] = [];

  if (!isPlainObject(data) || !Array.isArray(data.probes)) {
    return {
      ok: false,
      entries,
      errors: [{ message: 'Manifest must be an object with a "probes" array' }],
      warnings,
    };
  }

  const tools = toToolMap(options.knownTools);
  const seenIds = new Set<string>();
  const scoped = (message: string, probeId?: string) =>
    probeId ? `[${probeId}] ${message}` : message;
  const fail = (message: string, probeId?: string) =>
    errors.push({ probeId, message: scoped(message, probeId) });
  const warn = (message: string, probeId?: string) =>
    warnings.push({ probeId, message: scoped(message, probeId) });

  for (const raw of data.probes) {
    let entryFailed = false;
    const entryFail = (message: string, probeId?: string) => {
      entryFailed = true;
      fail(message, probeId);
    };

    if (!isPlainObject(raw)) {
      fail('Probe entry must be an object');
      continue;
    }

    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined;
    if (!id) {
      entryFail('Probe entry missing non-empty string id');
    } else if (!SAFE_PROBE_ID.test(id)) {
      entryFail(`Probe id "${id}" must be filename-safe ([A-Za-z0-9_-] only)`, id);
    } else if (seenIds.has(id)) {
      entryFail(`Duplicate probe id "${id}"`, id);
    } else {
      seenIds.add(id);
    }

    const tool = typeof raw.tool === 'string' ? raw.tool : undefined;
    const definition = tool ? tools.get(tool) : undefined;
    if (!tool) {
      entryFail('Probe entry missing string tool', id);
    } else if (!definition) {
      entryFail(`Unknown tool "${tool}"`, id);
    }

    if (!isPlainObject(raw.args)) {
      entryFail('Probe args must be a plain object', id);
    }

    const group = typeof raw.group === 'string' && raw.group.length > 0 ? raw.group : undefined;
    if (!group) entryFail('Probe entry missing non-empty string group', id);

    const gate = raw.gate;
    if (typeof gate !== 'string' || !VALID_GATES.has(gate)) {
      entryFail(`Probe gate must be 'read' or 'mutation', got ${JSON.stringify(gate)}`, id);
    } else if (tool && definition) {
      // Mutability is OR-ed across both authorities — the injected
      // definition flag (live tools/list) AND the static name set — so a
      // disagreement can only over-gate, never let a mutation run unattended.
      const mutation = definition.mutation === true || isMutationTool(tool);
      if (mutation && gate !== 'mutation') {
        entryFail(`Mutation tool "${tool}" cannot be gated 'read' — it would run unattended`, id);
      } else if (!mutation && gate === 'mutation') {
        warn(`Read-only tool "${tool}" over-gated 'mutation' — will prompt needlessly`, id);
      }
    }

    if (raw.redactFields !== undefined) {
      const rf = raw.redactFields;
      if (!Array.isArray(rf) || rf.some((f) => typeof f !== 'string')) {
        entryFail('redactFields must be an array of strings', id);
      }
    }
    if (raw.note !== undefined && typeof raw.note !== 'string') {
      entryFail('note must be a string', id);
    }

    // Load-time arg check against the tool's inputSchema — a typo'd param
    // fails here instead of mid-session. $ENV placeholders stay strings so
    // they type-check without resolving credentials.
    if (definition && isPlainObject(raw.args)) {
      const unknownKeys = unknownArgKeys(definition.inputSchema, raw.args);
      if (unknownKeys.length > 0) {
        entryFail(
          `args contain keys not in "${tool}" inputSchema: ${unknownKeys.join(', ')}`,
          id,
        );
      }
      const validation = validateToolArgs(definition.inputSchema, raw.args);
      if (!validation.valid) {
        entryFail(`args fail inputSchema for "${tool}": ${validation.error}`, id);
      }
      const malformedEnv = new Set<string>();
      collectEnvPlaceholders(raw.args, new Set<string>(), malformedEnv);
      for (const bad of malformedEnv) {
        entryFail(`malformed $ENV placeholder "${bad}" — use "$ENV:NAME" (uppercase, whole value)`, id);
      }
    }

    if (entryFailed || !id || !tool || gate === undefined || group === undefined) continue;

    const requiredEnv = new Set<string>();
    collectEnvPlaceholders(raw.args, requiredEnv, new Set<string>());

    entries.push({
      id,
      tool,
      args: raw.args as Record<string, unknown>,
      group,
      gate: gate as ProbeGate,
      ...(raw.redactFields !== undefined ? { redactFields: raw.redactFields as string[] } : {}),
      ...(raw.note !== undefined ? { note: raw.note as string } : {}),
      requiredEnv: [...requiredEnv],
    });
  }

  return { ok: errors.length === 0, entries, errors, warnings };
}

export async function loadProbeManifest(
  path: string,
  options: LoadProbeManifestOptions = {},
): Promise<ProbeManifestResult> {
  const knownTools = options.knownTools ?? (await listObservationTools());
  if (options.data !== undefined) {
    return validateProbeManifest(options.data, { knownTools });
  }
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      entries: [],
      errors: [
        {
          message: `Cannot read manifest ${path}: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      warnings: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      entries: [],
      errors: [
        {
          message: `Manifest ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      warnings: [],
    };
  }
  return validateProbeManifest(parsed, { knownTools });
}

// ---------------------------------------------------------------------------
// Dry-run plan output
// ---------------------------------------------------------------------------

export function formatProbePlan(entries: ProbeManifestEntry[]): string {
  return entries
    .map((e) => `[${e.gate}] ${e.id} - ${e.tool} (${e.group})`)
    .join('\n');
}
