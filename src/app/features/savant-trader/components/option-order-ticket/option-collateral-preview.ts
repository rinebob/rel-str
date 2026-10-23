/**
 * STO collateral preview (Topic #1177 / task #1190) — the advisory
 * `review_option_order` preflight the option ticket fires for sell-to-open
 * orders. Owns the stale-result guard, the parsed estimate, and the
 * rendered line; the component decides WHEN to preview (manual + sell +
 * resolved contract + account + unblocked) and passes the wire args.
 *
 * Deliberately silent: a failed, rejected, or unparseable review renders
 * nothing and never gates submit — RH enforces collateral at place.
 */
import { Injectable, computed, inject, signal } from '@angular/core';

import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import {
  parseStoCollateral,
  stoCollateralText,
  type StoCollateral,
} from '../../utils/option-collateral.util';

@Injectable()
export class OptionCollateralPreview {
  private readonly mcpService = inject(RobinhoodMcpObservationService);

  /** The parsed estimate — null means "render nothing". */
  readonly collateral = signal<StoCollateral | null>(null);

  /** The rendered advisory line — 'Locks ~$4,000 cash', 'Requires ~100
   *  NFLX shares held', or the unlimited-risk warning. */
  readonly text = computed(() => stoCollateralText(this.collateral()));

  /** Monotonic guard — a late resolution must not overwrite a newer
   *  estimate (same seq pattern the component's other fetches use). */
  private seq = 0;

  /** Inputs no longer warrant an estimate — drop it and invalidate any
   *  in-flight call. */
  clear(): void {
    ++this.seq;
    this.collateral.set(null);
  }

  /** Advisory STO collateral estimate — review_option_order is the same
   *  simulation preflight the execution path runs before place. Only the
   *  collateral block is surfaced; a failed or erroring review clears
   *  the line and changes nothing else. */
  async preview(args: Record<string, unknown>): Promise<void> {
    const seq = ++this.seq;
    try {
      const result = await this.mcpService.executeTool('review_option_order', { args });
      if (seq !== this.seq) return;
      // toolError = transport-success + MCP envelope isError — a rejected
      // review still isn't a collateral estimate.
      this.collateral.set(
        result.success && !result.toolError ? parseStoCollateral(result.parsed) : null,
      );
    } catch {
      if (seq === this.seq) this.collateral.set(null);
    }
  }
}
