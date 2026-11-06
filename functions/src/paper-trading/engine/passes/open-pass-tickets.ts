/**
 * Open-pass order-ticket staging (#984/#1002) — canonical `program`/`auto`
 * ticket emitted before brokerage execution; `idSeed = positionId` so a
 * re-fired pass re-emits the same doc. The contract detail lives on the
 * position doc sharing that id — ticket terms carry the strategy-level
 * terms (underlying/side/quantity), not legs (RH optionId is a
 * live-ordering identity the paper sim lacks).
 */

import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { TradeSide } from '@common';
import { buildAccountId } from '@paper-trading/ids';
import type { StStrategyInstance } from '@st/strategy-instances';
import type { StOrderTicketEmitter } from '../../../order-tickets/st-order-ticket-writer';
import { createLogger } from '../logging';

const logger = createLogger('OpenPass');

export type OpenPassTicketEmitter = Pick<
  StOrderTicketEmitter,
  'emit' | 'markFilled' | 'markFailed'
>;

/** Instance config plus the ticket-staging fields `StStrategyInstance`
 *  owns canonically — optional here because legacy docs predate the
 *  #1006 mode migration. */
export type OpenPassInstanceConfig = StrategyInstanceConfig &
  Partial<Pick<StStrategyInstance, 'mode' | 'paperAccountId'>>;

/** Stage the entry ticket. Fail-soft: an emit failure must never block
 *  the open — returns null so execution proceeds unticketed. */
export async function stageOpenTicket(
  tickets: OpenPassTicketEmitter | undefined,
  config: OpenPassInstanceConfig,
  positionId: string,
  instanceId: string,
  date: string,
): Promise<string | null> {
  if (!tickets) return null;
  try {
    return await tickets.emit({
      mode: config.mode === 'live' ? 'live' : 'paper',
      idSeed: positionId,
      origin: { type: 'program', instanceId },
      auto: true,
      terms: {
        symbol: config.symbol,
        side: config.side === TradeSide.SHORT ? 'sell' : 'buy',
        instrument: 'option',
        quantity: 1,
        orderType: 'market',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
      },
      accountTarget: config.paperAccountId ?? buildAccountId(config.userId),
      userId: config.userId,
      now: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      `st_open_pass_ticket_emit ${instanceId}/${date}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
