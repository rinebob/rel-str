/**
 * All spread-specific types, enums, and request/response interfaces.
 * Pure type definitions with no runtime dependencies — importable by both
 * the Firebase functions backend and the Angular frontend.
 */

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
  expiration: string;
  side: 'long' | 'short';
}

export interface SpreadDefinition {
  spreadType: SpreadType;
  symbol: string;
  legs: SpreadLeg[];
  startDate?: string;
  endDate?: string;
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
  date: string;
  spreadPrice: number;
  legMarks: number[];
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
  createdAt: unknown;
  updatedAt: unknown;
}
