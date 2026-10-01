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
  getToolCategory,
  isFinancialMutationTool,
  isMutationTool,
  isSimulationTool,
  listObservationTools,
  stripServerPrefix,
} from '../tools/robinhood-tools';
import { validateToolArgs } from '../tools/schema-validation';
import type { RobinhoodToolDefinition } from '@robinhood-mcp/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProbeGate = 'read' | 'mutation';

/**
 * Transitional (non-terminal) RH order states — the settle poll keeps
 * waiting while any order reports one of these. Runner UNIONs a caller's
 * `pendingStates` with this set: callers can widen, never narrow (a narrowed
 * or typo'd list would false-settle while an order is still open).
 */
export const DEFAULT_SETTLE_PENDING: readonly string[] = [
  'new',
  'queued',
  'confirmed',
  'unconfirmed',
  'partially_filled',
  'pending_cancelled',
];

/** Terminal RH order states — union with DEFAULT_SETTLE_PENDING is the known
 *  order-state vocabulary used for settle "order evidence" checks. */
export const TERMINAL_ORDER_STATES: readonly string[] = [
  'filled',
  'cancelled',
  'rejected',
  'failed',
  'voided',
  // Real RH state: partial-fill then cancel race — documented in
  // docs/topics/176-savant-trader/research-...-order-states.md
  'partially_filled_rest_cancelled',
  // The live tools/list uses the single-L spelling on some order tools.
  'canceled',
];

/**
 * Settle-poll tools must list orders — a quotes/position tool returning a
 * `results`/`data.results` container would count as "order evidence" and
 * false-settle while the placed order is still transitional.
 */
export const ORDER_LIST_TOOL = /^get_\w*orders?$/;

/**
 * Post-mutation settle polling (#683). After a `place_*` probe the runner
 * calls `tool` (an orders-list read, e.g. `get_equity_orders`) with the
 * probe's resolved args until no order reports a `state`/`status` inside
 * `pendingStates` — RH permits only one open order per position, so the next
 * probe must wait for the previous one to leave the transitional states.
 */
export interface ProbeSettleSpec {
  /** Orders-list tool to poll (must be a known read-only tool). */
  tool: string;
  /**
   * Args merged over the probe's resolved args for the settle call. Use this
   * when mutation args would silently change the settle tool's filter (e.g. a
   * `state` or `order_id` key colliding with the poll's schema).
   */
  args?: Record<string, unknown>;
  /**
   * Additional transitional states — UNIONED with `DEFAULT_SETTLE_PENDING`
   * at run time (a caller can widen the pending set, never narrow it).
   */
  pendingStates?: string[];
  /** Poll spacing; default 2000ms. */
  intervalMs?: number;
  /** Give up after this; timeout prompts the operator. Default 60000ms. */
  timeoutMs?: number;
}

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
  /** Post-mutation settle polling spec (mutation probes only). */
  settle?: ProbeSettleSpec;
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

export const ENV_PLACEHOLDER = /^\$ENV:([A-Z0-9_]+)$/;
/** Capture-file-safe probe ids: `captures/{id}.json` is derived verbatim. */
const SAFE_PROBE_ID = /^[A-Za-z0-9_-]+$/;

function collectEnvPlaceholders(
  value: unknown,
  into: Set<string>,
  malformed: Set<string>,
  seen: WeakSet<object> = new WeakSet(),
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
  // Cyclic pre-parsed objects can arrive via the `data:` seam — skip
  // revisited nodes instead of overflowing the validator.
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) collectEnvPlaceholders(item, into, malformed, seen);
    return;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const v of Object.values(value)) collectEnvPlaceholders(v, into, malformed, seen);
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
  return Object.keys(args).flatMap((key) => {
    if (!Object.hasOwn(properties, key) && !patterns.some((p) => p.test(key))) {
      return [key];
    }
    // Recurse into object properties and arrays of objects — a typo'd nested
    // key would silently drop at run time just like a top-level one.
    const propSchema = properties[key];
    const value = args[key];
    if (isPlainObject(propSchema) && isPlainObject(value)) {
      return unknownArgKeys(propSchema, value).map((k) => `${key}.${k}`);
    }
    if (
      isPlainObject(propSchema) &&
      Array.isArray(value) &&
      isPlainObject(propSchema.items)
    ) {
      return value.flatMap((item, idx) =>
        isPlainObject(item)
          ? unknownArgKeys(
              propSchema.items as Record<string, unknown>,
              item,
            ).map((k) => `${key}[${idx}].${k}`)
          : [],
      );
    }
    return [];
  });
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
  // normalize keys so manifest entries always use short names. Injectable
  // callers may hand malformed entries (missing name/inputSchema) — skip or
  // normalize rather than throwing inside validation.
  for (const t of provided) {
    if (!isPlainObject(t) || typeof t.name !== 'string') continue;
    map.set(stripServerPrefix(t.name), {
      ...t,
      inputSchema: isPlainObject(t.inputSchema)
        ? t.inputSchema
        : ({} as Record<string, unknown>),
    });
  }
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

    let settle: ProbeSettleSpec | undefined;
    if (raw.settle !== undefined) {
      if (!isPlainObject(raw.settle) || typeof raw.settle.tool !== 'string') {
        entryFail('settle must be an object with a string tool', id);
      } else {
        const s = raw.settle;
        const settleDef = tools.get(s.tool as string);
        if (!settleDef) {
          entryFail(`settle.tool "${String(s.tool)}" is not a known tool`, id);
        } else if (settleDef.mutation === true || isMutationTool(s.tool as string)) {
          entryFail(`settle.tool "${String(s.tool)}" is a mutation — settle polling must be a read`, id);
        } else if (!ORDER_LIST_TOOL.test(s.tool as string)) {
          // A non-orders read can return a `results` container that counts
          // as order evidence at run time — false-settle on every poll.
          entryFail(
            `settle.tool "${String(s.tool)}" is not an orders-list tool (get_*_orders) — its response can never confirm settlement`,
            id,
          );
        }
        if (gate === 'read') {
          warn(`settle on read-gated probe "${id}" is ignored (post-mutation only)`, id);
        }
        if (s.args !== undefined && !isPlainObject(s.args)) {
          entryFail('settle.args must be a plain object', id);
        } else if (isPlainObject(s.args) && settleDef) {
          // Same strictness as probe args: typo'd keys would silently change
          // the settle poll's filter, and placeholders get collected into
          // requiredEnv so a missing settle-only var can't false-settle.
          const sArgs = s.args as Record<string, unknown>;
          const unknownKeys = unknownArgKeys(settleDef.inputSchema, sArgs);
          if (unknownKeys.length > 0) {
            entryFail(
              `settle.args contain keys not in "${String(s.tool)}" inputSchema: ${unknownKeys.join(', ')}`,
              id,
            );
          }
          // settle.args is a MERGE layer over probe args at run time —
          // validate required/type constraints against the merged set the
          // poll will actually send, not the partial override alone.
          const mergedArgs = isPlainObject(raw.args)
            ? { ...(raw.args as Record<string, unknown>), ...sArgs }
            : sArgs;
          const sValidation = validateToolArgs(settleDef.inputSchema, mergedArgs);
          if (!sValidation.valid) {
            entryFail(
              `settle args fail inputSchema for "${String(s.tool)}" (merged with probe args): ${sValidation.error}`,
              id,
            );
          }
          const malformedEnv = new Set<string>();
          collectEnvPlaceholders(sArgs, new Set<string>(), malformedEnv);
          for (const bad of malformedEnv) {
            entryFail(`malformed $ENV placeholder "${bad}" in settle.args — use "$ENV:NAME" (uppercase, whole value)`, id);
          }
        }
        if (
          s.pendingStates !== undefined &&
          (!Array.isArray(s.pendingStates) ||
            s.pendingStates.length === 0 ||
            s.pendingStates.some((x) => typeof x !== 'string'))
        ) {
          entryFail('settle.pendingStates must be a non-empty string array', id);
        } else if (Array.isArray(s.pendingStates)) {
          // The runner unions these with the defaults — entries outside the
          // transitional vocabulary are typos or terminal states (noise).
          const known = new Set<string>(DEFAULT_SETTLE_PENDING);
          for (const st of s.pendingStates) {
            if (!known.has(st)) {
              warn(
                `settle.pendingStates "${st}" is not a known transitional order state — the default pending set still applies (union)`,
                id,
              );
            }
          }
        }
        for (const key of ['intervalMs', 'timeoutMs'] as const) {
          const v = s[key];
          // Infinity is reachable via the data: seam — it must not become an
          // infinite poll (timeoutMs) or a hot loop (intervalMs clamps to ~1ms).
          if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) {
            entryFail(`settle.${key} must be a positive finite number`, id);
          }
        }
        // A probe arg that is also a settle-tool param silently scopes the
        // poll unless settle.args overrides it — warn so the author must
        // acknowledge the collision.
        if (gate === 'mutation' && settleDef && isPlainObject(raw.args)) {
          const settleProps =
            (settleDef.inputSchema as { properties?: Record<string, unknown> })
              .properties ?? {};
          const overrides = isPlainObject(s.args)
            ? (s.args as Record<string, unknown>)
            : {};
          for (const k of Object.keys(raw.args)) {
            if (Object.hasOwn(settleProps, k) && !Object.hasOwn(overrides, k)) {
              warn(
                `probe arg "${k}" is also a "${String(s.tool)}" param — it scopes the settle poll for "${id}"; add a settle.args override if unintended`,
                id,
              );
            }
          }
        }
        settle = {
          tool: s.tool as string,
          ...(s.args !== undefined ? { args: s.args as Record<string, unknown> } : {}),
          ...(s.pendingStates !== undefined ? { pendingStates: s.pendingStates as string[] } : {}),
          ...(s.intervalMs !== undefined ? { intervalMs: s.intervalMs as number } : {}),
          ...(s.timeoutMs !== undefined ? { timeoutMs: s.timeoutMs as number } : {}),
        };
      }
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
    if (settle?.args) {
      collectEnvPlaceholders(settle.args, requiredEnv, new Set<string>());
    }

    entries.push({
      id,
      tool,
      args: raw.args as Record<string, unknown>,
      group,
      gate: gate as ProbeGate,
      ...(raw.redactFields !== undefined ? { redactFields: raw.redactFields as string[] } : {}),
      ...(raw.note !== undefined ? { note: raw.note as string } : {}),
      ...(settle !== undefined ? { settle } : {}),
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

/**
 * Attach mutation/simulation/financialMutation/category flags to raw
 * name+description+inputSchema entries (live tools/list or catalog rows).
 * Shared by the runner CLI and the offline verify script.
 */
export function toToolDefinitions(
  tools: Iterable<{ name: string; description?: string; inputSchema: Record<string, unknown> }>,
): RobinhoodToolDefinition[] {
  return [...tools].map((t) => {
    const name = stripServerPrefix(t.name);
    return {
      name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
      mutation: isMutationTool(name),
      simulation: isSimulationTool(name),
      financialMutation: isFinancialMutationTool(name),
      category: getToolCategory(name),
    };
  });
}
