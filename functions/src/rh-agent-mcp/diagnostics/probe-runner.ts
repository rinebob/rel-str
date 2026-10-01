/**
 * Probe manifest runner core (#683, Blueprint #680).
 *
 * Injectable orchestration for the discovery sweep — the CLI sibling
 * (run-probe-manifest.ts) wires the real executor + readline prompt; tests
 * drive this module with fakes. Responsibilities:
 *
 * - sequential manifest iteration, one call in flight at a time
 * - read probes: unattended, ~300ms spacing; a failure or 429 backs off
 *   (jittered, 1s -> 30s cap) then asks retry/skip/abort
 * - mutation probes: hard stop per call — y/n/abort, no bypass flag; a
 *   failed mutation must be RE-CONFIRMED before any retry (the order may
 *   already be live — transports can time out after the server accepted)
 * - post-mutation settle poll: order-list read until no pending states
 * - group checkpoints between domain groups (skippable via `auto`)
 * - captures/{id}.json per probe — manifest args (never resolved env values)
 *   and the REDACTED response only; error strings are scrubbed of resolved
 *   env values before they reach disk; `parsed` never persists
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_SETTLE_PENDING,
  ENV_PLACEHOLDER,
  ORDER_LIST_TOOL,
  TERMINAL_ORDER_STATES,
  type ProbeManifestEntry,
  type ProbeSettleSpec,
} from './probe-manifest';
import { maskAccountNumber } from '@robinhood-mcp/utils';
import { isMutationTool } from '../tools/robinhood-tools';
import {
  extractOrderList,
  getToolLevelErrorMessage,
} from '../broker/broker-order-normalizer';
import {
  ToolExecutionErrorCategory,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';

export type { ProbeManifestEntry, ProbeSettleSpec } from './probe-manifest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProbeCallResult = ToolExecutionResult;

export type ProbeCaller = (
  tool: string,
  args: Record<string, unknown>,
  extraRedactFields?: string[],
) => Promise<ProbeCallResult>;

export type ProbePrompt = (message: string) => Promise<string>;

export type ProbeOutcome = 'success' | 'error' | 'skipped';

export interface SettleRecord {
  tool: string;
  attempts: number;
  /** Configured transitional states (the spec's list). */
  pendingStates: string[];
  /** Orders still pending on the last poll — ids + states. */
  pending?: Array<{ id?: string; state: string }>;
  /** Last settle-call error (scrubbed), when polling itself failed. */
  lastError?: string;
  settled: boolean;
}

/** One captures/{id}.json record. `response` is the redacted payload only. */
export interface ProbeCapture {
  id: string;
  tool: string;
  group: string;
  gate: ProbeManifestEntry['gate'];
  note?: string;
  /** Manifest-form args — `$ENV:NAME` intact; resolved values never persist. */
  args: Record<string, unknown>;
  capturedAt: string;
  outcome: ProbeOutcome;
  reason?: 'declined' | 'missing-env' | 'aborted';
  missingEnv?: string[];
  success?: boolean;
  category?: string;
  /** Scrubbed error text — resolved env values masked before disk. */
  error?: string;
  latencyMs?: number;
  response?: unknown;
  settle?: SettleRecord;
}

export interface ProbeRunResult {
  planned: ProbeManifestEntry[];
  captures: ProbeCapture[];
  aborted: boolean;
}

export interface RunProbePlanOptions {
  entries: ProbeManifestEntry[];
  caller: ProbeCaller;
  prompt: ProbePrompt;
  captureDir: string;
  env?: Record<string, string | undefined>;
  only?: string;
  group?: string;
  from?: string;
  dryRun?: boolean;
  /** Skip interactive group checkpoints (summaries still print). */
  auto?: boolean;
  /** Spacing between unattended read calls; default 300ms. */
  paceMs?: number;
  /** First failure backoff; doubles to a 30s cap. Default 1000ms. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /**
   * Live-catalog mutation check — defaults to the static set. The CLI passes
   * `definition.mutation || isMutationTool` so a live-flagged mutation can
   * never serve as an ungated settle tool.
   */
  isMutationTool?: (tool: string) => boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PACE_MS = 300;
const DEFAULT_BACKOFF_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
const DEFAULT_SETTLE_INTERVAL_MS = 2000;
const DEFAULT_SETTLE_TIMEOUT_MS = 60_000;
// Upper bounds — Node clamps setTimeout delays >~2^31ms to 1ms (a hot loop
// hammering a live API), and a huge timeoutMs makes the fail-closed prompt
// unreachable.
const MAX_SETTLE_INTERVAL_MS = 60_000;
const MAX_SETTLE_TIMEOUT_MS = 600_000;
const MAX_PACE_MS = 30_000;
const SAFE_PROBE_ID = /^[A-Za-z0-9_-]+$/;

/** Injectable-caller clamp: non-finite or ≤0 → fallback; absurd → max. */
function bounded(v: unknown, fallback: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.min(v, max)
    : fallback;
}

export function resolveEnvArgs(
  args: Record<string, unknown>,
  env: Record<string, string | undefined>,
): { args: Record<string, unknown>; missing: string[]; secrets: string[] } {
  const missing = new Set<string>();
  const secrets = new Set<string>();
  // Injectable callers can hand a cyclic args object — the resolution runs
  // outside the try, so a stack overflow here would escape runProbePlan
  // entirely (no capture, no checklist).
  const seen = new WeakMap<object, unknown>();
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const match = ENV_PLACEHOLDER.exec(value);
      if (!match) return value;
      const resolved = env[match[1]];
      if (resolved === undefined || resolved === '') {
        missing.add(match[1]);
        return value;
      }
      secrets.add(resolved);
      return resolved;
    }
    // WeakMap (not WeakSet): a shared/DAG subtree resolves once and every
    // reference gets the RESOLVED node; a WeakSet would alias the raw
    // manifest node on revisit and let an unresolved placeholder through.
    // Register the container before recursing so true cycles resolve to a
    // cyclic copy instead of overflowing outside the try.
    if (Array.isArray(value)) {
      const prev = seen.get(value);
      if (prev !== undefined) return prev;
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) out.push(walk(item));
      return out;
    }
    if (isPlainObjectSafe(value)) {
      const prev = seen.get(value);
      if (prev !== undefined) return prev;
      const out: Record<string, unknown> = {};
      seen.set(value, out);
      for (const [k, v] of Object.entries(value)) {
        // defineProperty: a literal "__proto__" key becomes an own property
        // instead of silently mutating the prototype (arg would be dropped).
        Object.defineProperty(out, k, {
          value: walk(v),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return value;
  };
  return { args: walk(args) as Record<string, unknown>, missing: [...missing], secrets: [...secrets] };
}

function isPlainObjectSafe(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Mask every resolved env-derived value inside text before it is logged or
 * persisted — server errors can echo request args (e.g. "account 12345678 not
 * agentic_allowed").
 */
export function scrubSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  // Longest first — masking a shorter secret first can fragment a longer one
  // (e.g. "5678" inside "12345678") so the longer replace finds nothing and
  // a partial account value persists.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    // Short values over-mask harmless text, but under-masking leaks — the
    // module contract says resolved env values never reach disk/logs.
    // maskAccountNumber already returns '••••' for ≤4 chars.
    out = out.split(secret).join(maskAccountNumber(secret));
  }
  return out;
}

/** Mutation-gate display: resolved args with env-derived values masked. */
export function maskResolvedArgs(
  manifestArgs: Record<string, unknown>,
  resolvedArgs: Record<string, unknown>,
): Record<string, unknown> {
  const walk = (manifest: unknown, resolved: unknown): unknown => {
    if (typeof manifest === 'string' && ENV_PLACEHOLDER.test(manifest) && typeof resolved === 'string') {
      return maskAccountNumber(resolved);
    }
    if (Array.isArray(manifest) && Array.isArray(resolved)) {
      return manifest.map((m, i) => walk(m, resolved[i]));
    }
    if (isPlainObjectSafe(manifest) && isPlainObjectSafe(resolved)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(resolved)) {
        // defineProperty: "__proto__" must become an own property — a plain
        // assignment would drop it and the gate display would omit an arg
        // that actually goes on the wire.
        Object.defineProperty(out, k, {
          value: walk(manifest[k], v),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return resolved;
  };
  return walk(manifestArgs, resolvedArgs) as Record<string, unknown>;
}

export function isRateLimitError(error: string | undefined): boolean {
  return !!error && /429|rate.?limit|retry.?after/i.test(error);
}

/**
 * Deep-scrub a redacted payload before persistence — free-text error values
 * (`error`, `text`, `detail`) can echo resolved env values that field-name
 * redaction misses. Scrubs string LEAVES rather than the serialized JSON —
 * a secret containing `"`/`\` would be escaped in the JSON text and survive
 * a raw substring match.
 */
function scrubResponse(redacted: unknown, scrub: (t: string) => string): unknown {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObjectSafe(v)) {
      const out: Record<string, unknown> = {};
      // Keys are scrubbed too — a response can be keyed BY a resolved env
      // value (account-keyed maps, error bodies keyed by the offending arg).
      for (const [k, x] of Object.entries(v)) {
        const base = scrub(k);
        // Two distinct keys can mask to the same string (e.g. ≤4-char values
        // → '••••'); suffix collisions rather than silently drop a field.
        let sk = base;
        for (let n = 2; Object.hasOwn(out, sk); n++) sk = `${base}~${n}`;
        // defineProperty: "__proto__" as a key must be an own property.
        Object.defineProperty(out, sk, {
          value: walk(x),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return v;
  };
  return walk(redacted ?? null);
}

const KNOWN_ORDER_STATES = new Set([...DEFAULT_SETTLE_PENDING, ...TERMINAL_ORDER_STATES]);

/** Values of an object's `state`/`status` fields — either may carry the
 * order state (a `state ?? status` pick would shadow a pending `status`
 * behind a terminal-looking `state`). */
function orderStateValues(v: Record<string, unknown>): string[] {
  return [v.state, v.status].filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** Any object bearing a KNOWN order state AND an order-id-like key at any
 * depth — positive evidence the response carries order data. Vocabulary +
 * shape restricted: `{status:'ok'}` health bodies and coincidental
 * `{meta:{status:'filled'}}` wrappers are NOT order evidence. */
function containsOrderState(value: unknown, seen = new WeakSet<object>()): boolean {
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.some((i) => containsOrderState(i, seen));
  }
  if (!isPlainObjectSafe(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const hasOrderId =
    typeof value.id === 'string' ||
    typeof value.order_id === 'string' ||
    typeof value.ref_id === 'string';
  if (hasOrderId && orderStateValues(value).some((s) => KNOWN_ORDER_STATES.has(s))) {
    return true;
  }
  return Object.values(value).some(
    (c) => typeof c === 'object' && c !== null && containsOrderState(c, seen),
  );
}

/**
 * Collect `{ id, state }` hits for objects whose `state`/`status` field is in
 * `pendingStates`. Walks any depth — the orders tools wrap results in
 * envelopes (`results`, `orders`, `data`).
 */
export function findPendingOrders(
  value: unknown,
  pendingStates: ReadonlySet<string>,
): Array<{ id?: string; state: string }> {
  const hits: Array<{ id?: string; state: string }> = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (seen.has(v)) return;
      seen.add(v);
      for (const item of v) walk(item);
      return;
    }
    if (!isPlainObjectSafe(v)) return;
    if (seen.has(v)) return;
    seen.add(v);
    // Either field can carry the order state — a pending `status` must not
    // hide behind a terminal-looking `state` (or vice versa).
    const matched = orderStateValues(v).find((s) => pendingStates.has(s));
    if (matched !== undefined) {
      const id = v.id ?? v.order_id;
      hits.push({ state: matched, ...(typeof id === 'string' ? { id } : {}) });
    }
    for (const child of Object.values(v)) {
      if (typeof child === 'object' && child !== null) walk(child);
    }
  };
  walk(value);
  return hits;
}

/**
 * @param resumeId — probe id printed as the `--from` hint. For aborts BEFORE
 * the probe ran pass the probe's own id; for aborts AFTER it fired pass the
 * NEXT probe's id — resuming at the probe itself would re-fire the mutation.
 */
export function formatAbortChecklist(
  entry: ProbeManifestEntry,
  resumeId: string | undefined,
): string {
  return [
    '*** RUN ABORTED — recovery checklist ***',
    `Last probe reached: [${entry.id}] ${entry.tool} (${entry.group})`,
    '1. Check open orders: run get_equity_orders / get_option_orders for the',
    '   account and CANCEL any probe leftovers (cancel_equity_order /',
    '   cancel_option_order).',
    '2. Check positions opened by probes this run',
    '   (get_equity_positions / get_option_positions).',
    '3. Captures written so far record every executed call — review the last',
    '   capture for the mutation response / order id.',
    resumeId !== undefined
      ? `4. Resume with --from ${resumeId} after cleanup — it re-executes that probe through a fresh gate.`
      : '4. All planned probes have run — nothing left to resume.',
  ].join('\n');
}

export function filterProbeEntries(
  entries: ProbeManifestEntry[],
  filter: { only?: string; group?: string; from?: string },
): { entries: ProbeManifestEntry[] } | { error: string } {
  const filtered = filter.only !== undefined || filter.group !== undefined || filter.from !== undefined;
  // Existence checks run against the FULL manifest so a disjoint combination
  // (--only in group A + --group B) reports 'empty probe set', not a
  // misleading "group not found".
  if (filter.only !== undefined && !entries.some((e) => e.id === filter.only)) {
    return { error: `--only id "${filter.only}" not found in manifest` };
  }
  if (filter.group !== undefined && !entries.some((e) => e.group === filter.group)) {
    return { error: `--group "${filter.group}" not found in manifest` };
  }
  let planned = entries;
  if (filter.only !== undefined) {
    planned = planned.filter((e) => e.id === filter.only);
  }
  if (filter.group !== undefined) {
    planned = planned.filter((e) => e.group === filter.group);
  }
  if (filter.from !== undefined) {
    const idx = planned.findIndex((e) => e.id === filter.from);
    if (idx < 0) {
      return { error: `--from id "${filter.from}" not found in the planned set` };
    }
    planned = planned.slice(idx);
  }
  if (filtered && planned.length === 0) {
    return { error: 'filters produced an empty probe set' };
  }
  return { entries: planned };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function baseCapture(entry: ProbeManifestEntry): ProbeCapture {
  return {
    id: entry.id,
    tool: entry.tool,
    group: entry.group,
    gate: entry.gate,
    ...(entry.note !== undefined ? { note: entry.note } : {}),
    args: entry.args,
    capturedAt: '',
    outcome: 'error',
  };
}

async function settlePoll(
  entry: ProbeManifestEntry,
  spec: ProbeSettleSpec,
  resolvedArgs: Record<string, unknown>,
  resolvedSettleArgs: Record<string, unknown> | undefined,
  opts: RunProbePlanOptions,
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
  secrets: string[],
): Promise<{ record: SettleRecord; aborted: boolean }> {
  // Injectable-caller hardening (loader already validates all of this):
  // the caller's states UNION with the defaults — a caller can only widen
  // what counts as pending; a narrowed or typo'd list would false-settle
  // while a real order is still open. Non-strings are dropped.
  const callerStates = Array.isArray(spec.pendingStates)
    ? spec.pendingStates.filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      )
    : [];
  const pendingStates = new Set([...DEFAULT_SETTLE_PENDING, ...callerStates]);
  // Caller-supplied states are persisted verbatim — an injectable caller
  // could compose them from env values, so scrub before they hit disk.
  const maskedStates = (extra: string[] = []): string[] =>
    [...pendingStates].map((s) => scrubSecrets(s, [...secrets, ...extra]));
  const intervalMs = bounded(
    spec.intervalMs,
    DEFAULT_SETTLE_INTERVAL_MS,
    MAX_SETTLE_INTERVAL_MS,
  );
  const timeoutMs = bounded(
    spec.timeoutMs,
    DEFAULT_SETTLE_TIMEOUT_MS,
    MAX_SETTLE_TIMEOUT_MS,
  );
  // The loader rejects mutation settle tools, but runProbePlan is injectable —
  // a direct caller's manifest must not fire an ungated mutation post-confirm.
  // Use the injectable check so the CLI's live-definition `mutation` flag
  // counts too (loader parity: both authorities, never under-gate).
  const isMutation = opts.isMutationTool ?? isMutationTool;
  if (isMutation(spec.tool)) {
    return {
      record: {
        tool: spec.tool,
        attempts: 0,
        pendingStates: maskedStates(),
        settled: false,
        lastError: `settle.tool "${spec.tool}" is a mutation — refusing to poll`,
      },
      aborted: true,
    };
  }
  // Loader parity for injectable callers: only an orders-list tool can ever
  // confirm settlement — a quotes/positions tool returning a `results`
  // container would count as order evidence and false-settle.
  if (!ORDER_LIST_TOOL.test(spec.tool)) {
    return {
      record: {
        tool: spec.tool,
        attempts: 0,
        pendingStates: maskedStates(),
        settled: false,
        lastError: `settle.tool "${spec.tool}" is not an orders-list tool — refusing to poll`,
      },
      aborted: true,
    };
  }
  // All poll args are PINNED at the pre-fire resolution — env may drift
  // between the gate and the poll, and re-resolving could silently point
  // the settle query at a different account scope (a pending order becomes
  // invisible → false-settle). Post-fire resolution runs only to catch a
  // vanished settle-only var and to widen the scrub set.
  const env = opts.env ?? process.env;
  const settleArgs = spec.args
    ? resolveEnvArgs(spec.args, env)
    : { args: {} as Record<string, unknown>, missing: [] as string[], secrets: [] as string[] };
  // One sorted pass over the union — two composed passes could fragment a
  // longer secret masked by the other set's shorter member. Includes
  // post-fire settle secrets (env may differ from the pre-flight resolve).
  const scrubAll = (text: string) =>
    scrubSecrets(text, [...secrets, ...settleArgs.secrets]);
  if (settleArgs.missing.length > 0) {
    // Missing settle-only env -> the poll would query garbage args and could
    // false-settle. Stop the run instead.
    return {
      record: {
        tool: spec.tool,
        attempts: 0,
        pendingStates: maskedStates(settleArgs.secrets),
        settled: false,
        lastError: `missing env for settle args: ${settleArgs.missing.join(', ')}`,
      },
      aborted: true,
    };
  }
  const pollArgs = spec.args
    ? { ...resolvedArgs, ...(resolvedSettleArgs ?? settleArgs.args) }
    : resolvedArgs;
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  try {
    for (;;) {
      attempts++;
      const res = await opts.caller(spec.tool, pollArgs, entry.redactFields);
      // RH embeds tool-level errors in transport-success bodies — an error
      // payload carries no order states and must not count as settled. Check
      // BOTH channels: `parsed` (JSON error body) and the raw `redacted`
      // envelope — `parsed` is undefined when the error text isn't JSON.
      const parsed = res.success ? res.parsed : undefined;
      const parsedUsable = isPlainObjectSafe(parsed) || Array.isArray(parsed);
      const toolError =
        (res.success ? res.toolError : undefined) ??
        (parsed !== undefined ? getToolLevelErrorMessage(parsed) : undefined) ??
        (res.success ? getToolLevelErrorMessage(res.redacted) : undefined);
      const source = parsedUsable ? parsed : res.success ? res.redacted : undefined;
      // "Settled" requires POSITIVE order evidence — a recognized list
      // container, a bare array that is empty or carries an order-evidenced
      // element, or an id-bearing known-state object. A shapeless body
      // (`{detail: 'Not found'}`, `{status: 'ok'}`, `[{unrelated: true}]`)
      // can never confirm the order left its transitional state.
      const orderEvidence =
        extractOrderList(source) !== null ||
        (Array.isArray(source) &&
          (source.length === 0 || source.some((x) => containsOrderState(x)))) ||
        (!Array.isArray(source) && containsOrderState(source));
      // Pending ids/states come from the (preferably unredacted) response —
      // an env-resolved order id could echo back raw, so scrub before
      // persisting to the capture or printing the detail line.
      const pending =
        res.success && toolError === undefined
          ? findPendingOrders(source, pendingStates).map((p) => ({
              ...(p.id !== undefined ? { id: scrubAll(p.id) } : {}),
              state: scrubAll(p.state),
            }))
          : [];
      // An unusable parsed payload (absent/null/primitive, or an unparseable
      // envelope error) — or a usable body with NO order-list/state shape —
      // can never confirm settlement — keep polling → operator at timeout,
      // never false-settle.
      const inconclusive =
        res.success && toolError === undefined && (!parsedUsable || !orderEvidence);
      // Injectable callers can violate the contract — a non-string
      // error/toolError would crash `scrubAll` mid-poll.
      const rawFailure = !res.success ? res.error : toolError;
      const failureText =
        rawFailure !== undefined
          ? typeof rawFailure === 'string'
            ? rawFailure
            : 'unknown error'
          : undefined;
      const record: SettleRecord = {
        tool: spec.tool,
        attempts,
        pendingStates: maskedStates(settleArgs.secrets),
        settled:
          res.success &&
          toolError === undefined &&
          pending.length === 0 &&
          !inconclusive,
        ...(pending.length > 0 ? { pending } : {}),
        ...(failureText !== undefined
          ? { lastError: scrubAll(failureText) }
          : inconclusive
            ? { lastError: 'unverifiable settle response — cannot confirm order states' }
            : {}),
      };
      if (record.settled) return { record, aborted: false };
      const detail =
        res.success && toolError === undefined
          ? `${pending.length} order(s) still pending (${pending.map((p) => `${p.id ?? '?'}:${p.state}`).join(', ')})` +
            (inconclusive ? ' — redacted-only response; cannot confirm states' : '')
          : `settle poll failed: ${scrubAll(failureText ?? 'unknown error')}`;
      if (Date.now() >= deadline) {
        const answer = (
          await opts.prompt(
            `settle timeout for ${entry.id}: ${detail} — still pending after ${timeoutMs}ms. ` +
              `'c' continue anyway / anything else aborts`,
          )
        ).trim().toLowerCase();
        // Fail closed: only an explicit 'c' proceeds past a settle timeout.
        return { record, aborted: answer !== 'c' && answer !== 'continue' };
      }
      log(`  settle: ${detail} — polling again in ${intervalMs}ms`);
      await sleep(intervalMs);
    }
  } catch (error) {
    // A throw escapes with post-fire settle secrets — scrub before it reaches
    // the outer catch (whose scrub set only covers pre-flight resolution).
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(scrubAll(msg));
  }
}

export async function runProbePlan(opts: RunProbePlanOptions): Promise<ProbeRunResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? ((line: string) => console.log(line));
  const env = opts.env ?? process.env;
  // Injectable-caller normalization — `??` alone lets NaN through (NaN
  // backoff → Math.min(NaN, cap) → sleep(NaN) → zero pacing).
  const paceMs = bounded(opts.paceMs, DEFAULT_PACE_MS, MAX_PACE_MS);
  const backoffBase = bounded(opts.backoffMs, DEFAULT_BACKOFF_MS, BACKOFF_CAP_MS);
  // Injectable two-authority mutation check — the declared gate alone can't
  // be trusted for non-loader callers (a generated manifest could mark a
  // mutation as gate:'read'). Same policy as the settlePoll guard.
  const isMutation = opts.isMutationTool ?? isMutationTool;

  const filtered = filterProbeEntries(opts.entries, {
    only: opts.only,
    group: opts.group,
    from: opts.from,
  });
  if ('error' in filtered) throw new Error(filtered.error);
  const planned = filtered.entries;

  const seenIds = new Set<string>();
  for (const e of planned) {
    // Shape check before anything dereferences the entry — a non-object or a
    // non-string tool would crash isMutation outside the per-entry try.
    if (
      !isPlainObjectSafe(e) ||
      typeof e.tool !== 'string' ||
      e.tool.length === 0 ||
      !isPlainObjectSafe(e.args) ||
      (e.redactFields !== undefined &&
        (!Array.isArray(e.redactFields) ||
          e.redactFields.some((f) => typeof f !== 'string')))
    ) {
      throw new Error(
        'probe entry must have a string tool, plain-object args, and string[] redactFields',
      );
    }
    // RegExp.test coerces — id:123 would test "123", pass, and collide with
    // id:"123" in seenIds' string keys. Loader parity: strings only.
    if (typeof e.id !== 'string' || !SAFE_PROBE_ID.test(e.id)) {
      throw new Error(`probe id "${String(e.id)}" is not filename-safe`);
    }
    // The loader checks dupes, but direct callers bypass it — two entries
    // sharing an id would silently overwrite captures/{id}.json.
    if (seenIds.has(e.id)) {
      throw new Error(`duplicate probe id "${e.id}"`);
    }
    seenIds.add(e.id);
  }

  if (opts.dryRun) {
    return { planned, captures: [], aborted: false };
  }

  // Union EVERY planned probe's resolved env values into each entry's scrub
  // set — a response can echo a different probe's secret in free text (e.g.
  // an account-keyed error body from an earlier probe's credential).
  const globalSecrets = new Set<string>();
  for (const e of planned) {
    // Injectable callers may omit requiredEnv or pass a non-array — a raw
    // TypeError (or a string iterated char-by-char) is worse than reduced
    // cross-entry scrub coverage; per-entry `secrets` still apply.
    const req = Array.isArray(e.requiredEnv) ? e.requiredEnv : [];
    for (const name of req) {
      if (typeof name !== 'string') continue;
      const v = env[name];
      if (v !== undefined && v !== '') globalSecrets.add(v);
    }
  }

  const captures: ProbeCapture[] = [];
  let aborted = false;
  let callCount = 0;

  const writeCapture = async (cap: ProbeCapture): Promise<void> => {
    cap.capturedAt = new Date().toISOString();
    await mkdir(opts.captureDir, { recursive: true });
    // Atomic-ish: tmp + rename so a crash never leaves a truncated JSON.
    const target = join(opts.captureDir, `${cap.id}.json`);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(cap, null, 2) + '\n', 'utf-8');
    await rename(tmp, target);
    // Ledger push AFTER the fs ops — a failed write must not record a capture
    // that never hit disk (and the catch path retries this same cap).
    if (!captures.includes(cap)) captures.push(cap);
  };

  let previousGroup: string | undefined;
  let groupOutcomes: ProbeOutcome[] = [];

  const flushGroup = async (group: string): Promise<boolean> => {
    const counts = groupOutcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    }, {});
    log(
      `-- group "${group}" complete: ` +
        Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
    );
    groupOutcomes = [];
    if (opts.auto) return true;
    const answer = (await opts.prompt(`checkpoint — group "${group}" done. [enter] continue / 'a' abort`))
      .trim()
      .toLowerCase();
    return answer !== 'a' && answer !== 'abort';
  };

  type GateResult = 'execute' | 'skip' | 'abort';
  const gateMutation = async (
    entry: ProbeManifestEntry,
    displayArgs: Record<string, unknown>,
    warning?: string,
  ): Promise<GateResult> => {
    log(`*** MUTATION probe ${entry.id}: ${entry.tool}`);
    if (warning) log(`    ${warning}`);
    log(`    args: ${JSON.stringify(displayArgs)}`);
    const answer = (
      await opts.prompt(
        `execute ${entry.id} (${entry.tool})? 'y' run / 'n' skip / 'abort' stop` +
          ' — verify no live order exists first' +
          (warning ? ` — ${warning}` : ''),
      )
    ).trim().toLowerCase();
    if (answer === 'abort' || answer === 'a') return 'abort';
    if (answer === 'y' || answer === 'yes') return 'execute';
    return 'skip';
  };

  for (let i = 0; i < planned.length; i++) {
    const entry = planned[i];
    const nextId = planned[i + 1]?.id ?? entry.id;

    if (previousGroup !== undefined && entry.group !== previousGroup) {
      if (!(await flushGroup(previousGroup))) {
        log(`abort at group boundary — resume with --from ${entry.id}`);
        aborted = true;
        break;
      }
    }
    previousGroup = entry.group;

    const cap = baseCapture(entry);
    // Two-authority classification: the declared gate OR the tool's mutation
    // classification — a non-loader caller marking a mutation 'read' must
    // still hit the gate. Under-gating is the failure mode to prevent.
    const mutationProbe = entry.gate === 'mutation' || isMutation(entry.tool);
    // Resolved outside the try so the catch can scrub error text — secrets
    // must never reach a committed capture even via a thrown exception.
    const { args: resolvedArgs, missing, secrets } = resolveEnvArgs(entry.args, env);
    // Settle-only env vars are checked pre-gate too — a missing one would
    // otherwise only surface AFTER a confirmed mutation already fired. Only
    // for mutations: the validator ignores (warns on) settle specs attached
    // to read probes, so they must not gate a runnable read.
    const settleEnv =
      mutationProbe && entry.settle?.args
        ? resolveEnvArgs(entry.settle.args, env)
        : {
            args: {} as Record<string, unknown>,
            missing: [] as string[],
            secrets: [] as string[],
          };
    const allMissing = [...new Set([...missing, ...settleEnv.missing])];
    const scrub = (text: string) =>
      scrubSecrets(text, [...secrets, ...settleEnv.secrets, ...globalSecrets]);
    // Last probe aborts have nothing to resume — never emit a --from that
    // could re-fire an executed mutation.
    const resumeId = i + 1 < planned.length ? nextId : undefined;
    try {
      if (allMissing.length > 0) {
        cap.outcome = 'skipped';
        cap.reason = 'missing-env';
        cap.missingEnv = allMissing;
        log(`[skip] ${entry.id}: missing env ${allMissing.join(', ')}`);
        await writeCapture(cap);
        groupOutcomes.push(cap.outcome);
        continue;
      }

      if (mutationProbe) {
        const gate = await gateMutation(entry, maskResolvedArgs(entry.args, resolvedArgs));
        if (gate === 'abort') {
          cap.outcome = 'skipped';
          cap.reason = 'aborted';
          aborted = true;
        } else if (gate === 'skip') {
          cap.outcome = 'skipped';
          cap.reason = 'declined';
          log(`[skip] ${entry.id}: declined by operator`);
        }
        if (gate !== 'execute') {
          await writeCapture(cap);
          groupOutcomes.push(cap.outcome);
          if (aborted) {
            // Gate abort — the probe never ran; resume at the probe itself.
            log(formatAbortChecklist(entry, entry.id));
            break;
          }
          continue;
        }
      } else if (callCount > 0) {
        // Unattended read pacing — never before the first call in the run.
        await sleep(paceMs);
      }

      // Call with failure backoff loop (reads AND confirmed mutations).
      let attempt = 0;
      for (;;) {
        callCount++;
        const started = Date.now();
        const result = await opts.caller(entry.tool, resolvedArgs, entry.redactFields);
        cap.latencyMs = Date.now() - started;
        // A transport-success tool-level error is a failed probe — record it
        // as an error but still keep the scrubbed payload for the discovery
        // doc. Check all three channels: executor-surfaced envelope flag,
        // parsed-body isError, and the raw redacted envelope (injectable
        // callers may not surface toolError).
        const toolErr = result.success
          ? (result.toolError ??
            getToolLevelErrorMessage(result.parsed) ??
            getToolLevelErrorMessage(result.redacted))
          : undefined;
        cap.success = result.success && toolErr === undefined;
        // `response` always reflects the LAST attempt's payload — a stale
        // payload from an earlier attempt must not pair with a later error.
        if (result.success) {
          cap.response = scrubResponse(result.redacted, scrub);
        } else {
          delete cap.response;
        }
        if (cap.success) {
          cap.outcome = 'success';
          // Success after retries must not carry stale failure fields.
          delete cap.error;
          delete cap.category;
          break;
        }
        const errText = result.success
          ? typeof toolErr === 'string'
            ? toolErr
            : 'unknown tool error'
          : typeof result.error === 'string'
            ? result.error
            : 'unknown error';
        cap.category = result.success
          ? ToolExecutionErrorCategory.MCP
          : result.category;
        cap.error = scrub(errText);
        attempt++;
        const backoff = Math.min(
          backoffBase * 2 ** (attempt - 1) + Math.floor(Math.random() * backoffBase),
          BACKOFF_CAP_MS,
        );
        const tag = isRateLimitError(errText) ? 'rate-limited' : 'failed';
        log(`[${tag}] ${entry.id}: ${cap.error} (backing off ${backoff}ms)`);
        await sleep(backoff);
        const mutationNote =
          mutationProbe
            ? ' — WARNING: the order may already be live; check get_equity_orders / get_option_orders before retrying'
            : '';
        const answer = (
          await opts.prompt(
            `probe ${entry.id} ${tag}: ${cap.error} — 'r' retry / 's' skip / 'a' abort${mutationNote}`,
          )
        ).trim().toLowerCase();
        if (answer === 'r' || answer === 'retry') {
          // A confirmed mutation re-passes the gate before retrying — the
          // previous call may have reached the server (e.g. timeout), so a
          // blind resend can double-place the order.
          if (mutationProbe) {
            const reGate = await gateMutation(
              entry,
              maskResolvedArgs(entry.args, resolvedArgs),
              'RETRY — verify no live order exists first (ref_id idempotency is not set in this manifest)',
            );
            if (reGate === 'execute') continue;
            cap.outcome = 'error';
            if (reGate === 'abort') aborted = true;
            break;
          }
          continue;
        }
        cap.outcome = 'error';
        if (answer === 'a' || answer === 'abort') aborted = true;
        else log(`[skip] ${entry.id}: recorded as error`);
        break;
      }

      // Post-mutation settle poll — the next probe can't start while an
      // order is in a transitional state. Runs after ANY attempted call:
      // a transport timeout may have reached the server, so a mutation that
      // recorded 'error' can still have a live order to wait out.
      if (
        mutationProbe &&
        entry.settle !== undefined &&
        cap.latencyMs !== undefined
      ) {
        const { record, aborted: settleAborted } = await settlePoll(
          entry,
          entry.settle,
          resolvedArgs,
          entry.settle.args ? settleEnv.args : undefined,
          opts,
          sleep,
          log,
          [...secrets, ...settleEnv.secrets, ...globalSecrets],
        );
        cap.settle = record;
        if (settleAborted) {
          aborted = true;
          if (record.lastError) log(`  settle aborted: ${record.lastError}`);
        } else {
          log(
            record.settled
              ? `  settle: cleared after ${record.attempts} attempt(s)`
              : `  settle: NOT settled after ${record.attempts} attempt(s) — continuing per operator`,
          );
        }
      }

      await writeCapture(cap);
      groupOutcomes.push(cap.outcome);
    } catch (error) {
      // Never lose the audit trail: a probe that reached RH must leave a
      // capture + (for mutations) the recovery checklist, even on a crash.
      // The recorded outcome is preserved — the thrown message appends to
      // `error` so a legitimate 'skipped' isn't re-labelled.
      const thrown = scrub(error instanceof Error ? error.message : String(error));
      if (cap.outcome !== 'success' && cap.outcome !== 'skipped') cap.outcome = 'error';
      cap.error = cap.error ? `${cap.error} | runner error: ${thrown}` : thrown;
      aborted = true;
      await writeCapture(cap).catch(() => undefined);
      if (!captures.includes(cap)) captures.push(cap);
      // Same resume policy as the post-try abort: a probe that already
      // succeeded resumes past itself; anything else resumes at the probe.
      const resumeAt = cap.outcome === 'success' ? resumeId : entry.id;
      if (mutationProbe) {
        log(formatAbortChecklist(entry, resumeAt));
      } else {
        log(
          resumeAt !== undefined
            ? `abort — resume with --from ${resumeAt}`
            : 'abort — last probe reached; nothing left to resume',
        );
      }
      break;
    }

    if (aborted) {
      // A probe that already succeeded (settle-abort) must not re-fire on
      // resume — start at the next probe. A failed probe resumes at itself.
      const resumeAt = cap.outcome === 'success' ? resumeId : entry.id;
      if (mutationProbe) {
        log(formatAbortChecklist(entry, resumeAt));
      } else {
        log(
          resumeAt !== undefined
            ? `abort — resume with --from ${resumeAt}`
            : 'abort — last probe reached; nothing left to resume',
        );
      }
      break;
    }
  }

  if (previousGroup !== undefined && groupOutcomes.length > 0 && !aborted) {
    const counts = groupOutcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    }, {});
    log(
      `-- group "${previousGroup}" complete: ` +
        Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(' '),
    );
  }

  return { planned, captures, aborted };
}
