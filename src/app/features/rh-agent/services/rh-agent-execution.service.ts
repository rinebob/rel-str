/**
 * RH Agent Execution Service
 *
 * Orchestrates the single logical action of "executing" accepted occurrence
 * decisions: it atomically creates a trade record and stamps the source
 * occurrence decision as executed. Keeping this in one place prevents the
 * Order page from owning transaction choreography and avoids half-applied
 * state if one of the two writes fails.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  runTransaction,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection, Subcollection } from '../../../core/common/constants';
import { requireUserId, buildRhAgentTradeId } from './rh-agent-firestore-helpers';
import { RhAgentTrade, RhAgentTradeStatus, TradeInputRow } from './rh-agent.types';
import { buildStopPrice } from '../utils/rh-agent.utils';

export interface ExecutionRowInput {
  /** The row being executed. */
  row: TradeInputRow;
  /** Exact occurrence decision ID that produced this row. */
  occurrenceDecisionId: string;
}

export interface ExecutionResult {
  /** Trades that were created. */
  trades: RhAgentTrade[];
  /** Occurrence decision IDs that were marked executed. */
  decisionIds: string[];
}

@Injectable({
  providedIn: 'root',
})
export class RhAgentExecutionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /**
   * Atomically create trade records and mark the linked occurrence decisions
   * as executed. Both operations live in the same Firestore transaction so the
   * system cannot end up with an executed decision but no trade, or vice versa.
   */
  executeTradeRows(
    runId: string,
    marketDate: string,
    inputs: ExecutionRowInput[]
  ): Observable<ExecutionResult> {
    if (inputs.length === 0) return of({ trades: [], decisionIds: [] });

    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        from(
          runInInjectionContext(this.injector, async () => {
            const trades: RhAgentTrade[] = [];
            const decisionIds: string[] = [];
            const nowIso = new Date().toISOString();

            for (const input of inputs) {
              const row = input.row;
              if (row.entryPrice <= 0) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: entryPrice must be positive`);
              }
              if (row.positionSize <= 0) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: positionSize must be positive`);
              }
              if (row.stopLossPercent < 0) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: stopLossPercent must be non-negative`);
              }
              if (!input.occurrenceDecisionId) {
                throw new Error(`[RhAgentExecutionService] Cannot execute ${row.symbol}: missing occurrenceDecisionId`);
              }
            }

            await runTransaction(this.firestore, async (transaction) => {
              for (const input of inputs) {
                const row = input.row;
                const symbol = row.symbol.toUpperCase();
                const tradeId = buildRhAgentTradeId(symbol, marketDate, row.timeframe, row.signalType);
                const tradeDocRef = doc(
                  this.firestore,
                  Collection.RH_TRADES,
                  symbol,
                  Subcollection.TRADES,
                  tradeId
                );
                const decisionDocRef = doc(
                  this.firestore,
                  Collection.RH_OCCURRENCE_DECISIONS,
                  input.occurrenceDecisionId
                );

                const quantity = row.entryPrice > 0
                  ? Math.floor(row.positionSize / row.entryPrice)
                  : 0;

                const trade: RhAgentTrade = {
                  id: tradeId,
                  userId,
                  runId,
                  marketDate,
                  occurrenceDecisionId: input.occurrenceDecisionId,
                  symbol,
                  direction: row.direction,
                  timeframe: row.timeframe,
                  signalType: row.signalType,
                  barDate: row.barDate,
                  status: RhAgentTradeStatus.OPEN,
                  entryAt: nowIso,
                  entryPrice: row.entryPrice,
                  positionSize: row.positionSize,
                  quantity,
                  stopPrice: buildStopPrice(row.entryPrice, row.stopLossPercent, row.direction),
                  createdAt: nowIso,
                };

                transaction.set(tradeDocRef, { ...trade, updatedAt: nowIso });
                transaction.update(decisionDocRef, {
                  executedAt: nowIso,
                  updatedAt: nowIso,
                });

                trades.push(trade);
                decisionIds.push(input.occurrenceDecisionId);
              }
            });

            return { trades, decisionIds };
          })
        )
      )
    );
  }
}
