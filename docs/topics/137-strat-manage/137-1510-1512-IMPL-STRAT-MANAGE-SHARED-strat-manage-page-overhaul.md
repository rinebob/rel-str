**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1512  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# IMPL (SHARED) — OpsStrat Manage Page Overhaul

## Scope

Shared contracts, types, enums, the variant/template JSON artifact schema,
and the new instance-ID generator — everything FE and BE need to agree on
before either area builds.

## Design

### 1. Contracts file — `shared/manage-instance-contracts.ts`

New file (don't overload `options-strategy-engine-contracts.ts`; the old
`StrategyInstanceConfig` stays for legacy consumers until migration):

```ts
export type InstanceMode = 'paper' | 'real';
export type InstanceTrigger = 'daily' | 'signal';
export type InstanceRunState = 'UNSTARTED' | 'ACTIVE' | 'STOPPED';
export const STOP_TYPE_ALL = 'ALL';
/** 'ALL' for paper; a concrete stop code for real (never 'ALL'). */
export type StopType = typeof STOP_TYPE_ALL | (string & {});
//   + isValidModeStopType(mode, stopType) — the invariant predicate
//   + MANAGE_ADHOC_VARIANT_REF = 'adhoc'
```

- `InstanceRunState` replaces the UI-facing use of `LifecycleState` for
  manage instances. `UNSTARTED` is new; `STOPPED` inherits today's
  PAUSED/STOPPED semantics (no new opens; existing positions still managed).
  Blueprint decision: reuse `lifecycleState` field name with the new value
  set, or new `runState` field — prefer new field name `runState` to avoid
  silent enum reinterpretation on the same wire field.
- Invariant (documented + validated in the BE create path and the FE form):
  `mode === 'paper' ⇒ stopType === 'ALL'`; `mode === 'real' ⇒ stopType !==
  'ALL'`.

### 2. Variant/template contracts — `shared/manage-variant-contracts.ts`

As built (#1538): concrete legs reuse the canonical `VariantLeg` union
(`OptionLeg`/`StockLeg`) from `options-replay-contracts.ts` (Thread #1270) —
one leg model for replay + live/paper, no parallel leg type. Template legs
are a parallel kind-discriminated union carrying `role` + `side` + Δ/DTE
**bands** (shape only). Primary export names are `ManageTemplate` /
`ManageVariant` / `ManageTemplateLeg` (CONTEXT.md flags bare
"template"/"variant" as overloaded); `StrategyTemplate`, `NamedVariant`, and
`VariantLeg` are re-exported as aliases so the AC names resolve from this
module.

```ts
export type ManageTemplateLeg = ManageTemplateOptionLeg | ManageTemplateStockLeg;
//   option slot: { kind:'option', role, type, side, deltaMin, deltaMax, dteMin, dteMax }
//   stock slot:  { kind:'stock', role, side }

export interface ManageTemplate {
  id: string;              // e.g. 'cds', 'ic'
  name: string;            // 'call debit spread'
  code: string;            // ID segment, e.g. 'CDS', 'IC'
  legs: ManageTemplateLeg[];  // shape only — bands, no pinned Δ/DTE
}
export interface ManageVariant {
  id: string;              // registry id
  name: string;            // 'call debit spread 50-40 30'
  templateId: string;
  legs: VariantLeg[];      // concrete Δ + DTE per leg (replay union)
  dte: number;             // primary/shared DTE for the ID segment
}
```

Final field names track the external artifact (open question #4); the
contract is defined to mirror it 1:1.

### 3. JSON artifact — `shared/manage-variant-catalog.json` (or `.ts`)

- External workstream drops the file into `shared/`; FE imports it directly
  (bundle-time, typed via the contracts above) and BE imports the same file
  for variant resolution — same pattern as `options-replay-templates.ts`.
- A `.ts` registry wrapper (`shared/manage-variant-catalog.ts`) exporting
  `MANAGE_TEMPLATES` / `MANAGE_VARIANTS` is preferred over raw JSON import:
  typing + unit tests for free, same precedent.

### 4. Instance record — `shared/manage-instance-contracts.ts`

```ts
export interface ManageInstance {
  id: string;                    // {SYM}-{SPREAD}-{DTE}-{ΔLEGS}-{STOP}
  variantRef: string;            // registry id or 'adhoc'
  variant: NamedVariant;         // embedded snapshot (self-describing)
  symbol: string;
  mode: InstanceMode;
  trigger: InstanceTrigger;
  stopType: StopType;
  runState: InstanceRunState;
  userId: string;
  paperAccountId?: string;
  createdAt: string;
  updatedAt: string;
  lastFiredAt?: string;
  deletedAt?: string;
}
```

Persisted on `st-strategy-instances/{id}` (reused root, new schema — legacy
docs already deleted). `variantRef` dangling for ad hoc variants is fine
because `variant` is embedded.

### 5. ID generator — `shared/manage-instance-id.ts`

`{SYMBOL}-{SPREADCODE}-{DTE}-{ΔLEGS}-{STOP}`, ALL CAPS:

- `SPREADCODE` from the template's `code` field — `CUSTOM` for ad hoc
  variants (`templateId === 'custom'`).
- `ΔLEGS` = leg deltas in template-defined order joined with `-`
  (e.g., `50-40`). Encoded as `round(|Δ|*100)` **per option leg**,
  `STK` per stock leg — so a 4-leg iron condor emits four deltas, not
  the shorts-only `30-10` reading the PRD example (`SPY-IC-45-30-10-ALL`)
  implies. Per-leg encoding is collision-safer for a dedup key: two ICs
  differing only in wing width share their short deltas and would mint
  identical ids under the shorts-only reading.
- `STOP` = `ALL` or the human-readable stop code (vocabulary TBD — the
  `STOP_CODES` map is seeded with `ALL` + `T8` placeholder).
- As-built guards (#1542): `mode` must be a known `InstanceMode`
  (`isValidModeStopType` treats any non-'paper' string as real);
  every segment is hyphen-free and charset-checked (symbol
  `[A-Z0-9.]+`, codes `[A-Z0-9]+`); mode⇒stop is validated via
  `isValidModeStopType`; stop codes must be own-keys of the frozen
  `STOP_CODES` (hasOwnProperty — `in` leaks Object.prototype keys);
  option-leg deltas must be finite |Δ| ∈ (0,1] ('NaN'/'1e+23'
  segments otherwise); legs must positionally match the passed
  template's **shape** via `variantMatchesTemplateShape` — kind,
  option `type`/`side`, count (a put spread under `cds` would mint a
  byte-identical id to the call spread). Delta/DTE **bands are
  authoring policy, not identity**: ad hoc variants keep their
  template's `templateId` and may exceed bands — they mint normally
  (the Create dialog + BE create path own band validation);
  multi-expiry
  (diagonal) variants **throw** — the grammar's single DTE segment
  can't distinguish them from their same-expiry siblings, so a
  diagonal needs a grammar extension before it can instantiate;
  `variant.dte` must agree with the legs; the passed template must
  match `variant.templateId`.
- Replaces `generateInstanceId` for manage instances; keep the old function
  for any remaining legacy readers.

## Task breakdown (SHARED)

1. **S1 — Contracts + run-state/stop-type model** — new contracts file(s),
   `ManageInstance`, variant/template types, invariants documented.
2. **S2 — Variant catalog module** — `shared/` registry file with seed
   entries (1 template + 2 variants for dev), loader + lookup helpers.
3. **S3 — ID generator** — `manage-instance-id.ts` + tests covering
   multi-leg codes, delta ordering, `ALL`/real stop suffixes, caps.
