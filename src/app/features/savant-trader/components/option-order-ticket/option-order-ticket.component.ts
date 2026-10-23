/**
 * Option Order Ticket Component
 *
 * The Option tab of the gallery ticket dialog (Topic #942 / task #963).
 * Single-leg buy-to-open order entry: expiration/strike/call-put selects
 * or an OCC paste resolve to a tradable instrument, the resolved contract
 * lazily stages an OptionOrderTicket on first resolution, and edits write
 * back through updateTicket. Submit persists the form fields, opens the
 * shared confirm dialog, and hands off to OrderTicketStore.submitTicket.
 *
 * v1 scope: one leg, limit|market order types. Signal cards stage
 * buy-to-open only; manual mode (#1190) adds a buy-to-open/sell-to-open
 * toggle with an advisory STO collateral preview.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  WritableSignal,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { OptionType, buildOccContractId } from '@options-contract/contracts';
import { RobinhoodMcpClient } from '../../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import {
  OptionInstrument,
  OptionQuote,
} from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { PortfolioService } from '../../services/portfolio.service';
import { OrderConfirmDialogComponent } from '../order-confirm-dialog/order-confirm-dialog.component';
import {
  InstrumentType,
  OptionLeg,
  OptionOrderTicket,
  OrderTicketStatus,
  TradingConfig,
} from '../../services/order-ticket.types';
import { StSignalItem } from '../../services/types';
import { SignalDirection } from '../../common/constants';
import {
  DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT,
  chainsToExpirations,
  fatfingerBlock,
  parseOptionPaste,
  premiumNotional,
  selectsToInstrumentArgs,
} from '../../utils/option-contract.util';
import { stDocId } from '../../services/order-ticket-st-mapper';
import {
  manualOptionLane,
  signalOptionLane,
} from '../../utils/option-stage-lane.util';
import { buildOptionOrderWireArgs } from '../../utils/option-order-wire.util';
import { OptionCollateralPreview } from './option-collateral-preview';
import {
  DEFAULT_DOLLAR_AMOUNT,
  NO_ACCOUNT_SNACKBAR,
} from '../../utils/signal-order-staging.util';
import { formatError } from '../../utils/format-error.util';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import { BucketStatus } from '@portfolio-allocation/contracts';
import { GuardrailWarning } from '../../utils/order-guardrails.util';

/** A resolved, orderable contract — what a leg gets built from. */
interface ResolvedContract {
  /** OCC contract id — leg display + ticket doc-id discriminator. */
  occSymbol: string;
  /** RH instrument UUID — the ordering identity. */
  optionId: string;
  /** Mark price (last trade, previousClose fallback); null when the
   *  quote call failed — the contract is still resolved and orderable. */
  mark: number | null;
  /** The full option quote (mark/bid/ask/prev close) for the display
   *  line — null when the quote call failed. */
  quote: OptionQuote | null;
}

type OptionOrderType = 'limit' | 'market';
type OptionTimeInForce = 'gfd' | 'gtc';

@Component({
  selector: 'app-option-order-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [OptionCollateralPreview],
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './option-order-ticket.component.html',
  styleUrl: './option-order-ticket.component.scss',
})
export class OptionOrderTicketComponent {
  private readonly mcpClient = inject(RobinhoodMcpClient);
  /** Advisory STO collateral preview — owns the review_option_order call,
   *  stale guard, and rendered line (#1190). */
  protected readonly collateral = inject(OptionCollateralPreview);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly portfolio = inject(PortfolioService);
  private readonly allocStore = inject(AllocationStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** Set when the component is destroyed — a stage that resolves
   *  post-destroy must discard its persisted ticket rather than emit
   *  into the void (the host's createdTicketIds tracking is gone, so
   *  the STAGED doc would leak; #1017 r2 — same fix shape the manual
   *  path took). */
  private destroyed = false;

  /** Underlying ticker the option trades on (the card's symbol). */
  readonly symbol = input.required<string>();

  /** The card's FULL occurrence set — decisionIds land on the staged
   *  ticket, and the guard matches existing card tickets by them. */
  readonly signals = input<StSignalItem[]>([]);

  /** The viewed run id — decision ids are scoped to it. Optional (#1190):
   *  absent or '' means manual mode — no card, no signal provenance. */
  readonly runId = input<string>('');

  /** Live trading config — supplies the account number and the
   *  optionMaxPremiumCashPercent fatfinger cap. */
  readonly tradingConfig = input<TradingConfig | null>(null);

  /** Manual mode (#1190): no run id → no card provenance exists, so the
   *  ticket stages via buildManualOptionTicket (source MANUAL) instead of
   *  the signal builder, the adopt/block guard keys on {contract, side}
   *  rather than card decisionIds, and the BTO/STO toggle renders. */
  readonly manual = computed(() => !this.runId());

  /** Emitted when a ticket is staged (created:true) or an existing STAGED
   *  card ticket is adopted (created:false) — the host uses the id for
   *  ticket binding and the created flag for discard-on-close (#964). */
  readonly staged = output<{ ticketId: string; created: boolean }>();

  // ------------------------------------------------------------------
  // Contract selection state
  // ------------------------------------------------------------------

  readonly expirations = signal<string[]>([]);
  readonly chainsLoading = signal(false);
  readonly chainsError = signal<string | null>(null);

  readonly selectedExpiration = signal<string>('');
  readonly instruments = signal<OptionInstrument[]>([]);
  readonly instrumentsLoading = signal(false);
  readonly instrumentsError = signal<string | null>(null);

  readonly selectedStrike = signal<number | null>(null);
  readonly contractType = signal<'call' | 'put'>('call');

  /** Position-effect-OPEN direction — 'buy' (BTO, debit) or 'sell'
   *  (STO, credit). Manual mode only: signal cards stage buy-to-open by
   *  design (a long put on a SHORT card is still a buy), so the toggle
   *  renders only when `manual()` and signal mode ignores this value. */
  readonly orderSide = signal<'buy' | 'sell'>('buy');

  readonly resolving = signal(false);
  readonly resolvedContract = signal<ResolvedContract | null>(null);
  readonly resolveError = signal<string | null>(null);

  /** Persistent staging-block message — a live option ticket already on
   *  the card blocks staging; the snackbar is transient, so the reason
   *  the resolved contract can't be submitted also renders inline. */
  readonly stageError = signal<string | null>(null);

  readonly pasteText = signal('');
  readonly pasteError = signal<string | null>(null);

  // ------------------------------------------------------------------
  // Order form state
  // ------------------------------------------------------------------

  readonly orderType = signal<OptionOrderType>('limit');
  /** Defaults to 1 contract — submit is enabled as soon as a contract
   *  resolves; the stepper goes 1 → 2 on the first up-click. */
  readonly quantity = signal<string>('1');
  readonly limitPrice = signal<string>('');
  readonly timeInForce = signal<OptionTimeInForce>('gfd');
  readonly selectedBucketId = signal<string>('');

  // ------------------------------------------------------------------
  // Ticket + account state
  // ------------------------------------------------------------------

  /** The staged ticket id — set on first resolution (staged or adopted). */
  readonly ticketId = signal<string | null>(null);

  /** The bound ticket, live from the store — status/error render in place. */
  readonly ticket = computed<OptionOrderTicket | null>(() => {
    const id = this.ticketId();
    if (!id) return null;
    const t = this.ticketStore.tickets()[id];
    return t && t.instrumentType === InstrumentType.OPTION ? t : null;
  });

  /** Available cash for the fatfinger cap — fetched once per account. */
  readonly availableCash = signal<number | null>(null);

  private chainsRequestedFor: string | null = null;
  private cashRequestedFor: string | null = null;
  private directionDefaulted = false;
  private chainsSeq = 0;
  private cashSeq = 0;
  private instrumentsSeq = 0;
  private resolveSeq = 0;
  /** True while limitPrice holds a quote default (not user input) — a
   *  new contract's mark may overwrite it; a typed price never is. */
  private priceAutoFilled = false;
  /** Serializes ensureStagedTicket — two rapid resolutions could otherwise
   *  both pass the bound/matches checks while the first stageTicketAndWait
   *  is still in flight and double-stage (#963 review). */
  private stagingLock: Promise<OptionOrderTicket | null> | null = null;
  /** Tickets staged by this component instance — a ticket staged by a
   *  stale-suppressed frame and later adopted still counts as created
   *  here, so the adopt emit's `created` flag tells the host the truth
   *  for discard-on-close. */
  private readonly sessionStagedIds = new Set<string>();

  // ------------------------------------------------------------------
  // Derived state
  // ------------------------------------------------------------------

  readonly accountNumber = computed(() => this.tradingConfig()?.accountNumber ?? '');

  /** Contract identity line built live from the selects — "exp sym
   *  strike TYPE" with placeholders for unchosen segments (#965-era
   *  header rework: symbol context moved to the dialog header). */
  readonly contractLine = computed(
    () =>
      `${this.selectedExpiration() || '—'} ${this.symbol()} ` +
      `${this.selectedStrike() ?? '—'} ${this.contractType().toUpperCase()}`,
  );

  /** OCC contract id from the select triplet — computable before the
   *  instrument resolves (the paste field and leg id use the same
   *  builder). Null until the triplet is complete. */
  readonly occId = computed<string | null>(() => {
    const exp = this.selectedExpiration();
    const strike = this.selectedStrike();
    if (!exp || strike === null) return null;
    return buildOccContractId(
      this.symbol(),
      exp,
      this.contractType() === 'call' ? OptionType.CALL : OptionType.PUT,
      strike,
    );
  });
  private readonly defaultDollarAmount = computed(() => this.tradingConfig()?.defaultDollarAmount ?? DEFAULT_DOLLAR_AMOUNT);

  /** Strikes at the selected expiration for the selected contract type —
   *  unique, sorted ascending. The broad fetch is type-unfiltered, so the
   *  list narrows on call/put (a put-only strike can't be offered with
   *  Call selected — that combination would resolve to nothing). */
  readonly strikes = computed<number[]>(() => {
    const type = this.contractType();
    const set = new Set<number>();
    for (const i of this.instruments()) {
      if (i.type !== type) continue;
      if (i.strikePrice !== null && Number.isFinite(i.strikePrice)) set.add(i.strikePrice);
    }
    return [...set].sort((a, b) => a - b);
  });

  /** ACTIVE buckets for the account the STAGED ticket will fill into —
   *  the ticket's account, not the live config's (a config change
   *  between staging and submit can't show buckets the fill can't land
   *  in — same reasoning as the equity ticket). */
  readonly bucketOptions = computed(() =>
    (this.allocStore.byAccount()[this.ticket()?.accountNumber ?? this.accountNumber()]?.buckets ?? [])
      .filter((b) => b.status === BucketStatus.ACTIVE));

  /** Whole-contract quantity (non-negative integer), 0 when invalid. */
  private readonly contractsQuantity = computed(() => {
    const n = Number(this.quantity());
    return Number.isInteger(n) && n > 0 ? n : 0;
  });

  /** Per-contract price the premium estimate uses: the limit price on
   *  limit orders, the mark on market orders. */
  private readonly premiumBasis = computed<number | null>(() => {
    if (this.orderType() === 'limit') {
      const p = parseFloat(this.limitPrice());
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    return this.resolvedContract()?.mark ?? null;
  });

  /** Estimated total premium — qty × basis × 100, cent-rounded. */
  readonly estimatedPremium = computed<number | null>(() => {
    const qty = this.contractsQuantity();
    const basis = this.premiumBasis();
    if (qty <= 0 || basis === null) return null;
    return premiumNotional(qty, basis);
  });

  /** The configured fatfinger cap percent (default 25) — NaN-safe:
   *  Firestore can persist a NaN config value, which `??` doesn't catch. */
  readonly maxPremiumPct = computed(() => {
    const pct = this.tradingConfig()?.optionMaxPremiumCashPercent;
    return Number.isFinite(pct) ? pct! : DEFAULT_OPTION_MAX_PREMIUM_CASH_PERCENT;
  });

  /** Fatfinger cap — premium exceeds the configured fraction of
   *  available cash. Only evaluated when BOTH legs of the comparison are
   *  known; a failed snapshot pushes a confirm-dialog warning instead
   *  (the cap can't run on missing data). Inert on the sell side — it's
   *  a debit cap; STO risk is collateral, which the preview line covers. */
  readonly fatfingerExceeded = computed(() => {
    if (this.orderSide() === 'sell') return false;
    const premium = this.estimatedPremium();
    const cash = this.availableCash();
    if (premium === null || cash === null) return false;
    return fatfingerBlock(
      premium,
      cash,
      this.tradingConfig()?.optionMaxPremiumCashPercent,
    );
  });

  // The collateral advisory line is `collateral.text()` — the preview
  // helper's computed, bound directly in the template (no wrapper).

  /** The TIF that will actually be sent — market orders pin gfd. */
  readonly effectiveTimeInForce = computed<OptionTimeInForce>(() =>
    this.orderType() === 'market' ? 'gfd' : this.timeInForce(),
  );

  readonly isSubmitting = computed(() => this.ticket()?.status === OrderTicketStatus.SUBMITTING);
  readonly ticketError = computed(() => this.ticket()?.error ?? null);

  /** Submit gate — resolved contract, integer quantity, limit needs a
   *  positive price, fatfinger pass, account configured. `resolving` is
   *  part of the gate: the resolved contract on screen must be the one
   *  the dialog confirms — a resolution completing between submit-click
   *  and confirm would otherwise re-leg the stored ticket under the
   *  dialog and submit a contract the user never saw. */
  readonly canSubmit = computed(() => {
    const t = this.ticket();
    if (!t || t.status !== OrderTicketStatus.STAGED) return false;
    if (this.resolving() || this.stageError()) return false;
    if (!this.resolvedContract() || !this.accountNumber()) return false;
    if (this.contractsQuantity() <= 0) return false;
    if (this.orderType() === 'limit' && this.premiumBasis() === null) return false;
    return !this.fatfingerExceeded();
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
    });

    // Load option chains once per symbol — manual mode resolves against
    // the same pickers (#1190), so there is no manual gate here anymore.
    effect(() => {
      const sym = this.symbol();
      if (!sym || this.chainsRequestedFor === sym) return;
      this.chainsRequestedFor = sym;
      untracked(() => void this.loadChains(sym));
    });

    // Fetch the account snapshot once — the fatfinger cap needs cash.
    effect(() => {
      const acct = this.accountNumber();
      if (!acct || this.cashRequestedFor === acct) return;
      this.cashRequestedFor = acct;
      untracked(() => void this.loadCash(acct));
    });

    // Warm the allocation store for the bucket picker — same account the
    // picker reads (the bound ticket's, falling back to the config's).
    effect(() => {
      const acct = this.ticket()?.accountNumber ?? this.accountNumber();
      if (acct) untracked(() => this.allocStore.ensureAccount(acct));
    });

    // Sensible default for the call/put toggle: SHORT cards default to
    // put (a long put is still buy-to-open). One-time default — later
    // signal updates don't clobber a user's pick.
    effect(() => {
      const sigs = this.signals();
      if (!sigs.length || this.directionDefaulted) return;
      this.directionDefaulted = true;
      untracked(() => {
        if (sigs[0].direction === SignalDirection.SHORT) {
          this.contractType.set('put');
        }
      });
    });

    // Expiration → strikes. The broad instrument list populates the
    // strike select; resolution itself re-fetches narrowly.
    effect(() => {
      const exp = this.selectedExpiration();
      const sym = this.symbol();
      if (!exp || !sym) {
        // Invalidate any in-flight broad fetch — a late completion must
        // not repopulate strikes while no expiration is selected.
        ++this.instrumentsSeq;
        this.instrumentsLoading.set(false);
        this.instruments.set([]);
        return;
      }
      untracked(() => void this.loadInstruments(sym, exp));
    });

    // The single resolution path — selects and paste both land here.
    effect(() => {
      const exp = this.selectedExpiration();
      const strike = this.selectedStrike();
      const type = this.contractType();
      const sym = this.symbol();
      if (!exp || strike === null || !sym) {
        // Incomplete triplet — clear the stale contract so the summary
        // and submit gate match what's actually selected. Bump the seq
        // AND clear resolving: an in-flight resolution must not land a
        // ghost contract after the user deselects (the finally only
        // clears resolving on a seq match, so clear it here too).
        ++this.resolveSeq;
        this.resolving.set(false);
        this.resolvedContract.set(null);
        this.resolveError.set(null);
        this.stageError.set(null);
        if (this.priceAutoFilled) {
          this.limitPrice.set('');
          this.priceAutoFilled = false;
        }
        return;
      }
      untracked(() => void this.resolveAndStage(sym, exp, strike, type));
    });

    // Manual BTO/STO flip — opposite sides are different ticket
    // identities (OPT-MAN-{BTO|STO}), so a flip re-runs the stage/adopt
    // guard for the already-resolved contract without an MCP refetch.
    effect(() => {
      const side = this.orderSide();
      const c = this.resolvedContract();
      if (!this.manual() || !c || this.resolving()) return;
      untracked(() =>
        void this.ensureStagedTicket(
          { occSymbol: c.occSymbol, optionId: c.optionId },
          this.resolveSeq,
        ),
      );
    });

    // STO collateral preview — advisory review_option_order for the
    // sell-side order when a contract resolves. Silent: failure renders
    // nothing and never gates submit — RH enforces collateral at place.
    // Tracked deps are exactly what RH's collateral math reads (contract,
    // qty, side, account) — orderType/limitPrice/tif are call args but
    // don't move the collateral number, so they stay untracked. A
    // blocked stage or missing account makes the estimate meaningless —
    // don't burn the review call.
    effect(() => {
      const side = this.orderSide();
      const c = this.resolvedContract();
      const qty = this.quantity();
      const acct = this.accountNumber();
      const blocked = this.stageError() || this.resolving();
      if (!this.manual() || side !== 'sell' || !c || !acct || blocked) {
        this.collateral.clear();
        return;
      }
      untracked(() =>
        void this.collateral.preview(
          buildOptionOrderWireArgs({
            // The bound ticket's account wins (an adopted ticket can
            // carry a different account) — untracked so a ticket patch
            // doesn't refire the advisory call.
            accountNumber: this.ticket()?.accountNumber ?? acct,
            legs: [{ optionId: c.optionId, side: 'sell', positionEffect: 'open' }],
            type: this.orderType(),
            quantity: qty,
            timeInForce: this.effectiveTimeInForce(),
            price:
              this.orderType() === 'limit' && this.limitPrice()
                ? this.limitPrice()
                : undefined,
            chainSymbol: this.symbol(),
            underlyingType: 'equity',
          }),
        ),
      );
    });

    // Retry staging when a block cause clears without a triplet change —
    // a live ticket going terminal or the account becoming configured
    // surface as `stageError`, and the
    // user shouldn't have to wiggle a select to escape. Runs the guard
    // only (no MCP refetch — the contract is already resolved) and only
    // while blocked, so store churn elsewhere costs nothing.
    effect(() => {
      const blocked = this.stageError();
      const c = this.resolvedContract();
      this.ticketStore.tickets(); // live → terminal transitions
      this.accountNumber(); // account configured
      if (!blocked || !c || this.resolving()) return;
      // Inherit the current seq — a deselect during the lock wait bumps
      // it and aborts this frame's writes inside ensureStagedTicket.
      untracked(() =>
        void this.ensureStagedTicket(
          { occSymbol: c.occSymbol, optionId: c.optionId },
          this.resolveSeq,
        ),
      );
    });
  }

  // ------------------------------------------------------------------
  // Data loads
  // ------------------------------------------------------------------

  private async loadChains(symbol: string): Promise<void> {
    const seq = ++this.chainsSeq;
    this.chainsLoading.set(true);
    this.chainsError.set(null);
    try {
      const chains = await this.mcpClient.getOptionChains(symbol.toUpperCase());
      if (seq === this.chainsSeq) this.expirations.set(chainsToExpirations(chains));
    } catch (err) {
      if (seq === this.chainsSeq) this.chainsError.set(formatError(err));
    } finally {
      if (seq === this.chainsSeq) this.chainsLoading.set(false);
    }
  }

  private async loadInstruments(symbol: string, expiration: string): Promise<void> {
    const seq = ++this.instrumentsSeq;
    this.instrumentsLoading.set(true);
    this.instrumentsError.set(null);
    try {
      const list = await this.mcpClient.getOptionInstruments({
        chainSymbol: symbol.toUpperCase(),
        expirationDates: [expiration],
      });
      if (seq === this.instrumentsSeq) this.instruments.set(list);
    } catch (err) {
      if (seq === this.instrumentsSeq) {
        this.instruments.set([]);
        this.instrumentsError.set(formatError(err));
      }
    } finally {
      if (seq === this.instrumentsSeq) this.instrumentsLoading.set(false);
    }
  }

  private async loadCash(accountNumber: string): Promise<void> {
    const seq = ++this.cashSeq;
    // Clear first — on an account switch the previous account's cash must
    // not leak into the fatfinger check while the new snapshot loads (or
    // suppress the cash-unavailable warning if it fails).
    this.availableCash.set(null);
    try {
      const snap = await this.portfolio.getSnapshot(accountNumber, this.defaultDollarAmount());
      // Stale fetch for a superseded account must not land — A→B→A
      // switches would otherwise price the cap on the wrong cash.
      if (seq === this.cashSeq && snap) this.availableCash.set(snap.cash);
    } catch (err) {
      console.error('[OptionOrderTicket] cash snapshot failed:', err);
    }
  }

  // ------------------------------------------------------------------
  // Contract resolution + staging
  // ------------------------------------------------------------------

  /** Narrow-fetch the selected contract, fetch its mark, then lazily
   *  stage (or adopt + re-leg) the card's option ticket. `seq` guards
   *  against out-of-order completions when the user changes selects fast. */
  private async resolveAndStage(
    symbol: string,
    expiration: string,
    strike: number,
    type: 'call' | 'put',
  ): Promise<void> {
    const seq = ++this.resolveSeq;
    this.resolving.set(true);
    this.resolveError.set(null);
    try {
      const instruments = await this.mcpClient.getOptionInstruments(
        selectsToInstrumentArgs(symbol, expiration, strike, type),
      );
      if (seq !== this.resolveSeq) return;
      // v1 takes the first match — adjusted contracts (post-split) can
      // coexist at the same strike/type but the payload carries no field
      // to prefer one over another.
      const instrument = instruments[0];
      if (!instrument) {
        this.resolvedContract.set(null);
        this.resolveError.set('Contract not found or not currently tradable');
        return;
      }
      const occSymbol = buildOccContractId(
        symbol,
        expiration,
        type === 'call' ? OptionType.CALL : OptionType.PUT,
        strike,
      );

      let quote: OptionQuote | null = null;
      let mark: number | null = null;
      try {
        const quotes: Map<string, OptionQuote> = await this.mcpClient.getOptionQuotes([
          instrument.instrumentId,
        ]);
        quote = quotes.get(instrument.instrumentId) ?? null;
        mark = quote?.lastTradePrice ?? quote?.previousClose ?? null;
      } catch (err) {
        // The contract is still resolved + orderable — the mark is a
        // display convenience and the market-order premium estimate.
        console.warn('[OptionOrderTicket] quote fetch failed:', err);
      }
      if (seq !== this.resolveSeq) return;

      this.resolvedContract.set({
        occSymbol,
        optionId: instrument.instrumentId,
        mark,
        quote,
      });
      // The quote fills the limit-price default — a price the user typed
      // is theirs, so only an empty field or a previous auto-fill gets
      // overwritten. An auto-fill when the new contract's quote is gone
      // must clear too: contract A's mark must not sit in the field
      // looking like contract B's.
      if (mark !== null && (!this.limitPrice() || this.priceAutoFilled)) {
        this.limitPrice.set(mark.toFixed(2));
        this.priceAutoFilled = true;
      } else if (mark === null && this.priceAutoFilled) {
        this.limitPrice.set('');
        this.priceAutoFilled = false;
      }
      await this.ensureStagedTicket(
        { occSymbol, optionId: instrument.instrumentId },
        seq,
      );
    } catch (err) {
      if (seq === this.resolveSeq) {
        this.resolvedContract.set(null);
        this.resolveError.set(formatError(err));
      }
    } finally {
      if (seq === this.resolveSeq) this.resolving.set(false);
    }
  }

  /** Lazy staging (IMPL-948): first resolution creates the ticket via
   *  stageTicketAndWait; an existing STAGED card ticket is adopted and
   *  re-legged (refId preserved); a live card ticket blocks. The guard
   *  matters because createTicket .set()s unconditionally — overwriting
   *  a live ticket's doc would wipe refId/result.orderId. */
  private async ensureStagedTicket(
    contract: { occSymbol: string; optionId: string },
    seq?: number,
  ): Promise<OptionOrderTicket | null> {
    // Serialize — a second resolution that arrives while a stage is in
    // flight waits, then re-enters and takes the bound-ticket (re-leg)
    // path instead of double-staging.
    if (this.stagingLock) {
      await this.stagingLock;
      // Re-check freshness after the wait — a deselect or newer
      // resolution during it bumps the seq and this frame must not land
      // writes for a contract that's no longer selected.
      if (seq !== undefined && seq !== this.resolveSeq) return null;
      return this.ensureStagedTicket(contract, seq);
    }
    const pending = this.doEnsureStagedTicket(contract, seq);
    this.stagingLock = pending;
    try {
      return await pending;
    } finally {
      if (this.stagingLock === pending) this.stagingLock = null;
    }
  }

  private async doEnsureStagedTicket(
    contract: { occSymbol: string; optionId: string },
    seq?: number,
  ): Promise<OptionOrderTicket | null> {
    // Freshness — every write/emit below must belong to the resolution
    // the selects currently describe.
    const stale = () => seq !== undefined && seq !== this.resolveSeq;
    if (stale()) return null;

    // The lane owns every axis that differs between the flows — leg
    // side, adopt/block probe, block message, can-stage, builder — so
    // the path below is mode-free (a manual BTO→STO flip is just a
    // different lane, not a branch).
    const lane = this.manual()
      ? manualOptionLane({
          symbol: this.symbol(),
          side: this.orderSide(),
          ticketsBySymbol: () => this.ticketStore.ticketsBySymbol(),
        })
      : signalOptionLane({
          symbol: this.symbol(),
          signals: this.signals(),
          runId: this.runId(),
          ticketsBySymbol: () => this.ticketStore.ticketsBySymbol(),
        });
    const leg: OptionLeg = {
      side: lane.side,
      symbol: contract.occSymbol,
      optionId: contract.optionId,
      positionEffect: 'open',
    };
    const now = new Date().toISOString();

    // Already bound — same ticket, re-leg in place when the contract
    // moved. A manual side flip OR contract retarget is a different
    // ticket identity (OPT-MAN-{BTO|STO}-{occ}), so a mismatched bound
    // ticket falls through to the guard + stage path instead of being
    // re-legged — re-legging past the probe would bypass the live-block
    // on a live same-side ticket for the target contract.
    const bound = this.ticket();
    if (bound && bound.legs[0]?.side === lane.side && lane.isSameIdentity(bound, contract)) {
      if (bound.status === OrderTicketStatus.STAGED && bound.legs[0]?.optionId !== contract.optionId) {
        this.ticketStore.updateTicket(bound.id, { legs: [leg], error: undefined, updatedAt: now });
      }
      // A bound ticket is a consistent state — any stale block error
      // from a side-flip detour must not linger (the retry effect can
      // re-enter here without ever clearing it).
      this.stageError.set(null);
      return bound;
    }
    // The bound ticket is the other identity's — unbind it before the
    // guard so a live-block below leaves no stale submittable ticket on
    // screen. Uniform across lanes: signal-mode bound tickets are always
    // 'buy', so the signal path never reaches this. Keyed on the bound
    // ID, not the resolved ticket — a ticket that vanished from the map
    // is precisely the stale state this must clear.
    if (this.ticketId()) this.ticketId.set(null);

    // Guard — the lane's probe: card tickets by provenance for signal,
    // source-agnostic {contract, side} for manual. The lane decides
    // which matches block: the card's live-or-FILLED set for signal,
    // none for manual (parallel orders are user intent).
    const matches = lane.probe(contract.occSymbol);
    const blocker = matches.find((t) => lane.isBlocking(t));
    if (blocker) {
      const msg = lane.blockMessage(blocker);
      if (this.stageError() !== msg) this.snackBar.open(msg, 'Dismiss', { duration: 5000 });
      this.stageError.set(msg);
      return null;
    }
    const adoptable = matches.find((t) => t.status === OrderTicketStatus.STAGED);
    if (adoptable) {
      this.ticketId.set(adoptable.id);
      // Skip the write when nothing would change — same contract, no
      // stale error to clear.
      if (adoptable.legs[0]?.optionId !== contract.optionId || adoptable.error) {
        this.ticketStore.updateTicket(adoptable.id, { legs: [leg], error: undefined, updatedAt: now });
      }
      // Hydrate the bucket pick from the adopted ticket — otherwise a
      // ticket that already carries bucketId would be stripped on submit
      // (selectedBucketId '' → updateTicket deletes the key).
      if (!this.selectedBucketId() && adoptable.bucketId) {
        this.selectedBucketId.set(adoptable.bucketId);
      }
      this.stageError.set(null);
      this.staged.emit({
        ticketId: adoptable.id,
        created: this.sessionStagedIds.has(adoptable.id),
      });
      return adoptable;
    }

    if (!lane.canStage()) {
      return null;
    }
    if (!this.accountNumber()) {
      const msg = NO_ACCOUNT_SNACKBAR;
      if (this.stageError() !== msg) this.snackBar.open(msg, 'Dismiss', { duration: 4000 });
      this.stageError.set(msg);
      return null;
    }

    const ctx = {
      accountNumber: this.accountNumber(),
      now: new Date(),
      buildRefId: () => crypto.randomUUID(),
    };
    const ticket = lane.build(contract, ctx);
    if (!ticket) return null;
    // Same-minute id collision — the option twin of the equity service's
    // guard (manual-order.service.ts): ids are minute-keyed, so a
    // same-id doc that isn't the STAGED twin the probe already adopted
    // is a ticket the .set() would clobber. Probe both key spellings —
    // a hydrated twin sits under liv_{id}.
    const allTickets = this.ticketStore.tickets();
    if (allTickets[ticket.id] ?? allTickets[stDocId(ticket.id)]) {
      this.snackBar.open(
        `${this.symbol()}: a ticket for this contract was just staged — try again in a moment`,
        'Dismiss',
        { duration: 4000 },
      );
      return null;
    }
    const persisted = await this.ticketStore.stageTicketAndWait(ticket);
    if (!persisted) return null;
    // The dialog closed mid-stage — the emit would land on a destroyed
    // binding and the host's createdTicketIds never sees the id; the
    // persisted STAGED doc would leak. Discard it instead (#1017 r2).
    if (this.destroyed) {
      this.ticketStore.discardIfStaged(ticket.id);
      return null;
    }
    this.sessionStagedIds.add(ticket.id);
    // Emit BEFORE the stale bail — the host's discard-on-close tracks
    // created tickets by this event; suppressing it orphans a persisted
    // STAGED doc the card can never clean up (#964 review).
    this.staged.emit({ ticketId: ticket.id, created: true });
    // The stage committed (can't be un-rung) — but a deselect during the
    // write means the ticket stays unbound rather than binding a ghost;
    // a later resolution adopts it via the card guard (and the adopt
    // emit reports created:true from sessionStagedIds).
    if (stale()) return ticket;
    this.ticketId.set(ticket.id);
    this.stageError.set(null);
    return ticket;
  }

  // ------------------------------------------------------------------
  // User actions
  // ------------------------------------------------------------------

  onExpirationChange(event: Event): void {
    this.selectedExpiration.set((event.target as HTMLSelectElement).value);
  }

  onStrikeChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const n = Number(raw);
    this.selectedStrike.set(raw === '' || !Number.isFinite(n) ? null : n);
  }

  /** Paste an OCC contract id → populate the selects to match. The
   *  resolution effect runs the identical selects path. */
  onImportPaste(): void {
    const parsed = parseOptionPaste(this.pasteText());
    if (!parsed) {
      this.pasteError.set('Not a valid OCC contract id');
      return;
    }
    if (parsed.symbol !== this.symbol().toUpperCase()) {
      this.pasteError.set(
        `Contract is for ${parsed.symbol} — this ticket trades ${this.symbol().toUpperCase()}`,
      );
      return;
    }
    this.pasteError.set(null);
    // Set the triplet — the effects do the rest (broad strike list +
    // narrow resolution + staging). An identical re-paste sets nothing
    // new (equal-value signals don't re-notify), so retry explicitly —
    // that's the escape hatch after a resolveError on the same contract.
    if (
      this.selectedExpiration() === parsed.expiration &&
      this.selectedStrike() === parsed.strike &&
      this.contractType() === parsed.type
    ) {
      void this.resolveAndStage(this.symbol(), parsed.expiration, parsed.strike, parsed.type);
      return;
    }
    this.selectedExpiration.set(parsed.expiration);
    this.selectedStrike.set(parsed.strike);
    this.contractType.set(parsed.type);
  }

  onPasteInput(event: Event): void {
    this.pasteText.set((event.target as HTMLInputElement).value);
    if (this.pasteError()) this.pasteError.set(null);
  }

  setOrderType(type: OptionOrderType): void {
    this.orderType.set(type);
    if (type === 'market') this.timeInForce.set('gfd');
  }

  setInputValue(field: WritableSignal<string>, event: Event): void {
    field.set((event.target as HTMLInputElement).value);
  }

  /** User-typed limit price — stops the quote auto-fill from owning the
   *  field (the next resolution's mark must not clobber it). */
  onLimitPriceInput(event: Event): void {
    this.priceAutoFilled = false;
    this.setInputValue(this.limitPrice, event);
  }

  onQuantityInput(event: Event): void {
    const n = Math.max(0, parseInt((event.target as HTMLInputElement).value, 10) || 0);
    this.quantity.set(n > 0 ? String(n) : '');
  }

  qtyUp(): void {
    this.quantity.set(String(this.contractsQuantity() + 1));
  }

  qtyDown(): void {
    const n = this.contractsQuantity() - 1;
    this.quantity.set(n > 0 ? String(n) : '');
  }

  onBucketChange(event: Event): void {
    this.selectedBucketId.set((event.target as HTMLSelectElement).value);
  }

  retryChains(): void {
    const sym = this.symbol();
    this.chainsRequestedFor = null; // allow the effect to refire
    if (sym) void this.loadChains(sym);
  }

  retryInstruments(): void {
    const exp = this.selectedExpiration();
    const sym = this.symbol();
    if (exp && sym) void this.loadInstruments(sym, exp);
  }

  /** Persist the form, confirm, submit. The store submits the STORED
   *  ticket, so the fields land via updateTicket first (the local patch
   *  applies synchronously — the same optimistic pattern the equity
   *  ticket's saveEdits uses). */
  async onSubmit(): Promise<void> {
    const t = this.ticket();
    if (!t || !this.canSubmit()) {
      if (this.fatfingerExceeded()) {
        this.snackBar.open(
          `Premium exceeds the configured cash cap (${this.maxPremiumPct()}%)`,
          'Dismiss',
          { duration: 5000 },
        );
      }
      return;
    }

    this.ticketStore.updateTicket(t.id, {
      quantity: String(this.contractsQuantity()),
      price: this.orderType() === 'limit' ? this.limitPrice() || undefined : undefined,
      orderType: this.orderType(),
      timeInForce: this.effectiveTimeInForce(),
      bucketId: this.selectedBucketId() || undefined,
      updatedAt: new Date().toISOString(),
    });

    // Re-read the patched ticket for the confirm dialog — the option
    // summary renders stored quantity/price/legs.
    const current = this.ticket();
    if (!current) return;

    const warnings: GuardrailWarning[] = [];
    if (this.orderType() === 'market' && this.resolvedContract()?.mark == null) {
      warnings.push({ severity: 'warning', message: 'Mark unavailable — premium not estimated' });
    }
    if (this.availableCash() === null && this.estimatedPremium() !== null) {
      warnings.push({ severity: 'warning', message: 'Cash snapshot unavailable — fatfinger cap not evaluated' });
    }

    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { ticket: current, warnings },
          width: '400px',
        })
        .afterClosed(),
    );
    if (confirmed) {
      // Verify the stored ticket still carries the confirmed contract —
      // a late resolution or external write must not submit a different
      // leg than the one in the dialog.
      const latest = this.ticket();
      const confirmedLeg = current.legs[0];
      if (
        !latest ||
        latest.status !== OrderTicketStatus.STAGED ||
        latest.legs[0]?.optionId !== confirmedLeg?.optionId
      ) {
        this.snackBar.open(
          'Contract changed while confirming — re-confirm to submit',
          'Dismiss',
          { duration: 5000 },
        );
        return;
      }
      this.ticketStore.submitTicket(t.id);
    }
  }
}
