**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-05  

# Implementation Plan: Spread Time Series Viewer — SHARED

## Overview

Shared types and helpers consumed by both the backend (Firebase Functions) and frontend (Angular app). Two new files in `shared/`.

## Components

### 1. `shared/options-common.ts`

Canonical source for `OptionType` enum and OCC contract ID helpers, shared between the options contract viewer and the spread viewer.

**Contents:**

```typescript
export enum OptionType {
  CALL = 'call',
  PUT = 'put',
}

export interface ParsedOccContractId {
  symbol: string;
  expiration: string;   // YYYY-MM-DD
  optionType: OptionType;
  strike: number;
}

export function parseOccContractId(occId: string): ParsedOccContractId | null;
export function buildOccContractId(symbol: string, expiration: string, optionType: OptionType, strike: number): string;
```

**Source:** Move `OptionType` from `functions/src/types/partner.ts` and `parseOccContractId` / `buildOccContractId` from `shared/options-contract-contracts.ts`. Those files will re-export from `options-common.ts` until the cleanup tasks remove the re-exports.

**Path alias:** Add `@options/common` to `tsconfig.paths` (if not already present) pointing to `shared/options-common.ts`.

### 2. `shared/spread-contracts.ts`

All spread-specific types, enums, and request/response interfaces.

**Contents:**

```typescript
import { OptionType } from './options-common';

// ── Enums ──────────────────────────────────────

export enum SpreadType {
  VERTICAL = 'vertical',
  STRADDLE = 'straddle',
  STRANGLE = 'strangle',
  IRON_CONDOR = 'iron_condor',
  CUSTOM = 'custom',
}

export enum DebitOrCredit {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum SpreadStatus {
  PENDING = 'pending',
  LOADING = 'loading',
  LOADED = 'loaded',
  ERROR = 'error',
}

// ── Spread Definition (immutable, persisted, sent to SA) ──────

export interface SpreadLeg {
  optionType: OptionType;
  strike: number;
  expiration: string;     // YYYY-MM-DD
  side: 'long' | 'short';
}

export interface SpreadDefinition {
  spreadType: SpreadType;
  symbol: string;
  legs: SpreadLeg[];
  startDate?: string;     // YYYY-MM-DD, optional
  endDate?: string;       // YYYY-MM-DD, optional
}

// ── Spread (runtime — lives in store) ──────────

export interface Spread extends SpreadDefinition {
  id: string;
  status: SpreadStatus;
  series?: SpreadObservation[];
  debitOrCredit?: DebitOrCredit;
  gaps?: string[];
  legMetadata?: LegMetadata[];
  error?: string;
}

// ── SA Response Types ──────────────────────────

export interface SpreadObservation {
  date: string;           // YYYY-MM-DD
  spreadPrice: number;
  legMarks: number[];     // per-leg mark prices
  volume?: number;
}

export interface LegMetadata {
  contractId: string;
  optionType: OptionType;
  strike: number;
  expiration: string;
  side: 'long' | 'short';
}

export interface SpreadTimeSeriesResponse {
  symbol: string;
  spreadType: SpreadType;
  debitOrCredit: DebitOrCredit;
  legs: LegMetadata[];
  series: SpreadObservation[];
  gaps: string[];
  startDate: string;
  endDate: string;
}

// ── Orchestrator Request ───────────────────────

export interface SubmitSpreadRunRequest {
  spreads: SpreadDefinition[];
}

export interface SubmitSpreadRunResponse {
  runId: string;
}

// ── Firestore Run/Job Doc Types ────────────────

export enum SpreadRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

export enum SpreadJobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  TRANSIENT_FAILURE = 'TRANSIENT_FAILURE',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
}

// ── Spread List Persistence (Firestore) ────────

export interface SpreadListDoc {
  userId: string;
  name: string;
  spreads: SpreadDefinition[];
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}
```

**Path alias:** Add `@spread/contracts` to `tsconfig.paths` pointing to `shared/spread-contracts.ts`.

### 3. `functions/src/types/partner.ts` (modified)

Add `SPREAD_TIME_SERIES` to `PartnerEndpointPath`:

```typescript
SPREAD_TIME_SERIES = 'partnerSpreadTimeSeries',
```

Remove the `OptionType` enum definition (now in `shared/options-common.ts`). Re-export from `@options/common` until cleanup tasks remove all re-exports.

### 4. `src/app/core/common/constants.ts` (modified)

Add to `CallableName`:

```typescript
SUBMIT_SPREAD_RUN = 'submitSpreadRun',
```

Add to `Collection`:

```typescript
SPREAD_RUNS = 'spread-runs',
SPREAD_LISTS = 'spread-lists',
```

### 5. `src/app/core/common/interfaces.ts` (modified)

Add to `AppRoutes`:

```typescript
SPREAD_CHART = 'spread-chart',
```

## Dependencies

- No external dependencies — pure TypeScript types and enums.
- `shared/options-common.ts` depends on nothing.
- `shared/spread-contracts.ts` imports `OptionType` from `options-common.ts`.

## Cross-Area Boundaries

- **BE** imports from `@options/common` and `@spread/contracts` for proxy, orchestrator, and worker type safety.
- **FE** imports from `@options/common` and `@spread/contracts` for services, store, and components.
- **Firestore** doc shapes are defined here so both BE (admin SDK writes) and FE (AngularFire reads) share the same interfaces.

## Risks

- **Path alias configuration:** Both `@options/common` and `@spread/contracts` need to be added to both the app `tsconfig.json` and the functions `tsconfig.json`. If aliases are misconfigured, imports will fail at build time.
- **OptionType migration:** Moving `OptionType` out of `partner.ts` could break existing imports. Re-export from `partner.ts` as a safety net until cleanup tasks complete.

## Implementation Order

1. Create `shared/options-common.ts` with `OptionType`, `parseOccContractId`, `buildOccContractId`
2. Add `@options/common` path alias to both `tsconfig.json` files
3. Re-export `OptionType` from `functions/src/types/partner.ts`
4. Create `shared/spread-contracts.ts` with all spread types
5. Add `@spread/contracts` path alias to both `tsconfig.json` files
6. Add `SPREAD_TIME_SERIES` to `PartnerEndpointPath`
7. Add `SUBMIT_SPREAD_RUN` to `CallableName`, `SPREAD_RUNS` + `SPREAD_LISTS` to `Collection`
8. Add `SPREAD_CHART` to `AppRoutes`
9. Verify build passes with re-exports in place
