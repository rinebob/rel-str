/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1547 — FE: Create New Instance dialog
 *
 * Create New Instance dialog — variant × symbols × mode/trigger/stop.
 *
 * Picks a named variant (catalog seeds + this session's ad hoc variants,
 * merged by the store), a mode (paper only in v1 — real is disabled at the
 * option), a trigger (daily | signal), and a stop type (paper is always
 * 'ALL'; real never offers 'ALL'). Symbols parse from a free-text list —
 * one instance is created per symbol. Each row previews its generated
 * instance ID (`generateManageInstanceId` — the dedup key); an id that
 * already exists marks the row duplicate.
 *
 * Filter-submit (#1605): Create is enabled whenever at least one row is
 * clean and writes exactly the clean subset — flagged rows (duplicates,
 * invalid symbols) stay in the field for the user to trim or cancel.
 * The dialog closes only when every submitted symbol landed; a partial
 * create stays open with a "Created N — M left" notice. A hard failure
 * (service error, mode/stop violation) stays open with the error inline.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { StrategyManageStore } from '../../stores/strategy-manage.store';
import type {
  CreateInstancesResult,
  CreateManageInstanceInput,
} from '../../services/strategy-manage.service';
import {
  INSTANCE_TRIGGERS,
  MANAGE_ADHOC_VARIANT_REF,
  type InstanceMode,
  type InstanceTrigger,
  type StopType,
} from '@manage/instance-contracts';
import { generateManageInstanceId, STOP_CODES } from '@manage/instance-id';
import {
  getManageTemplate,
  MANAGE_CUSTOM_TEMPLATE_ID,
  MANAGE_VARIANTS,
} from '@manage/variant-catalog';
import type { ManageVariant } from '@manage/variant-contracts';

/** One parsed symbol's preview row — minted id, or why it can't mint. */
interface SymbolPreview {
  symbol: string;
  id?: string;
  duplicate?: boolean;
  error?: string;
}

const SYMBOL_PATTERN = /^[A-Z0-9]+(\.[A-Z0-9]+)*$/;

/** Cap on symbols per create — the write runs in one Firestore transaction
 *  (reads + writes scale with the input count), so a pasted list of
 *  hundreds would stall both the preview and the commit. */
const MAX_CREATE_SYMBOLS = 50;

@Component({
  selector: 'app-manage-create-instance',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">Create New Instance</h2>
    <div class="content">
      <label class="dse-field">
        <span class="field-label">Variant</span>
        <select class="dse-select" data-testid="variant-select"
                [(ngModel)]="selectedVariantId">
          @for (v of store.variants(); track v.id) {
            <option [value]="v.id">{{ v.name }}</option>
          }
        </select>
      </label>

      <div class="field-row">
        <label class="dse-field">
          <span class="field-label">Mode</span>
          <select class="dse-select" data-testid="mode-select"
                  [(ngModel)]="mode">
            <option value="paper">Paper</option>
            <option value="real" [disabled]="true">Real (disabled in v1)</option>
          </select>
        </label>

        <label class="dse-field">
          <span class="field-label">Trigger</span>
          <select class="dse-select" data-testid="trigger-select"
                  [(ngModel)]="trigger">
            @for (t of triggers; track t) {
              <option [value]="t">{{ t === 'daily' ? 'Daily' : 'Signal' }}</option>
            }
          </select>
        </label>

        <label class="dse-field">
          <span class="field-label">Stop type</span>
          @if (mode() === 'paper') {
            <select class="dse-select" data-testid="stop-type-select" disabled>
              <option>ALL</option>
            </select>
          } @else {
            <select class="dse-select" data-testid="stop-type-select"
                    [(ngModel)]="stopType">
              @for (s of stopTypeOptions(); track s) {
                <option [value]="s">{{ s }}</option>
              }
            </select>
          }
        </label>
      </div>

      <label class="dse-field">
        <span class="field-label">Symbols</span>
        <input class="field-input" data-testid="symbols-input"
               [ngModel]="symbolsText()"
               (ngModelChange)="symbolsText.set($event)"
               placeholder="QQQ, SPY"
               aria-describedby="symbols-hint" />
        <span class="field-hint" id="symbols-hint">
          Comma or space separated — one instance is created per symbol.
        </span>
        @if (symbolsError(); as e) {
          <span class="preview-error" data-testid="symbols-error">{{ e }}</span>
        }
      </label>

      @if (previews().length) {
        <ul class="id-preview" aria-label="Instance ID preview">
          @for (p of previews(); track p.symbol) {
            <li [class.dup]="p.duplicate" [class.bad]="!!p.error"
                [attr.data-testid]="'id-preview-' + p.symbol">
              <b>{{ p.symbol }}</b> →
              @if (p.error) {
                <span class="preview-error">{{ p.error }}</span>
              } @else {
                <code>{{ p.id }}</code>
                @if (p.duplicate) { <span class="preview-error">— already exists</span> }
              }
            </li>
          }
        </ul>
      }

      @if (notice(); as n) {
        <div class="dialog-notice" data-testid="dialog-notice" role="status">{{ n }}</div>
      }
      @if (error(); as err) {
        <div class="dialog-error" data-testid="dialog-error" role="alert">{{ err }}</div>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn outline" type="button" data-testid="dialog-cancel"
              [disabled]="pending()" (click)="ref.close(undefined)">Cancel</button>
      <button class="ds-btn fill" type="button" data-testid="dialog-create"
              [disabled]="!canCreate() || pending()" (click)="create()">
        @if (pending()) { <span class="dse-spinner" style="--spinner-size: 18px" role="progressbar" aria-label="Loading"></span> }
        Create {{ cleanPreviews().length === 1 ? 'instance' : cleanPreviews().length + ' instances' }}
      </button>
    </div>
  `,
  styleUrl: './manage-create-instance.component.scss',
})
export class ManageCreateInstanceComponent {
  protected readonly ref = inject(
    DsDialogRef<ManageCreateInstanceComponent, true | undefined>,
  );
  protected readonly store = inject(StrategyManageStore);

  readonly selectedVariantId = signal(this.store.variants()[0]?.id ?? '');
  readonly mode = signal<InstanceMode>('paper');
  readonly trigger = signal<InstanceTrigger>('daily');
  readonly stopType = signal<StopType>('ALL');
  readonly symbolsText = signal('');
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);
  /** Post-partial-create summary — "Created N — M left below". */
  readonly notice = signal<string | null>(null);

  readonly triggers = INSTANCE_TRIGGERS;

  /** Paper runs the composite 'ALL'; real never offers it (the mode/stop
   *  invariant the ID grammar enforces). */
  readonly stopTypeOptions = computed<StopType[]>(() =>
    this.mode() === 'paper'
      ? ['ALL']
      : Object.keys(STOP_CODES).filter((s) => s !== 'ALL'),
  );

  readonly selectedVariant = computed<ManageVariant | null>(
    () => this.store.variants().find((v) => v.id === this.selectedVariantId()) ?? null,
  );

  /** Parsed, normalized (uppercase), deduped symbol list — raw tokens that
   *  fail the ticker charset surface in the preview instead of minting. */
  private readonly symbols = computed(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of this.symbolsText().split(/[\s,]+/)) {
      const sym = raw.trim().toUpperCase();
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    }
    return out;
  });

  /** Over-cap guard — blocks create before the transaction is attempted. */
  readonly symbolsError = computed(() =>
    this.symbols().length > MAX_CREATE_SYMBOLS
      ? `Too many symbols — ${this.symbols().length} parsed, max ${MAX_CREATE_SYMBOLS} per create`
      : null,
  );

  /** Live per-symbol preview — the minted ALL-CAPS id, 'duplicate' when it
   *  collides with an existing instance, or the reason it can't mint. */
  readonly previews = computed<SymbolPreview[]>(() => {
    const variant = this.selectedVariant();
    const existing = new Set(this.store.instances().map((i) => i.id));
    return this.symbols().map((symbol) => {
      if (!SYMBOL_PATTERN.test(symbol)) {
        return { symbol, error: `'${symbol}' is not a valid symbol` };
      }
      if (!variant) {
        return { symbol, error: 'pick a variant' };
      }
      const template = variant.templateId === MANAGE_CUSTOM_TEMPLATE_ID
        ? undefined
        : getManageTemplate(variant.templateId);
      if (!template && variant.templateId !== MANAGE_CUSTOM_TEMPLATE_ID) {
        return {
          symbol,
          error: `template '${variant.templateId}' did not resolve`,
        };
      }
      try {
        const id = generateManageInstanceId({
          symbol,
          variant,
          template,
          mode: this.mode(),
          stopType: this.stopType(),
        });
        return { symbol, id, duplicate: existing.has(id) };
      } catch (e) {
        return { symbol, error: e instanceof Error ? e.message : String(e) };
      }
    });
  });

  /** Rows that can actually mint — the submit filter (#1605). */
  readonly cleanPreviews = computed(() =>
    this.previews().filter((p) => p.id && !p.error && !p.duplicate),
  );

  readonly canCreate = computed(
    () =>
      this.selectedVariant() !== null &&
      this.symbols().length > 0 &&
      !this.symbolsError() &&
      this.cleanPreviews().length > 0,
  );

  constructor() {
    // Mode flip invalidates the current stopType (paper↔real option sets
    // are disjoint) — reset to the first valid option for the new mode.
    effect(() => {
      const opts = this.stopTypeOptions();
      if (!opts.includes(this.stopType())) this.stopType.set(opts[0]);
    });
  }

  /** Submit the clean subset — flagged rows stay in the field (#1605).
   *  Catalog variants stamp their registry id as `variantRef`; anything
   *  not in the seeded catalog is a session-composed ad hoc variant and
   *  stamps the adhoc sentinel. */
  async create(): Promise<void> {
    if (!this.canCreate() || this.pending()) return;
    const variant = this.selectedVariant()!;
    const variantRef = MANAGE_VARIANTS.includes(variant)
      ? variant.id
      : MANAGE_ADHOC_VARIANT_REF;
    const clean = this.cleanPreviews();
    const inputs: CreateManageInstanceInput[] = clean.map((p) => ({
      id: p.id!,
      variantRef,
      variant,
      symbol: p.symbol,
      mode: this.mode(),
      trigger: this.trigger(),
      stopType: this.stopType(),
    }));

    this.pending.set(true);
    this.error.set(null);
    this.notice.set(null);
    // Block backdrop/Escape dismiss mid-write — a "canceled" dialog whose
    // transaction still commits is a worse surprise than a locked overlay.
    this.ref.disableClose = true;
    let outcome: CreateInstancesResult | string;
    try {
      outcome = await this.store.createInstances(inputs);
    } finally {
      this.pending.set(false);
      this.ref.disableClose = false;
    }
    if (typeof outcome === 'string') {
      this.error.set(outcome);
      return;
    }
    // Consume the created symbols; leftovers (flagged rows + race skips)
    // stay in the field for the user to trim or cancel.
    const createdSymbols = new Set(
      clean
        .filter((p) => p.id !== undefined && outcome.created.includes(p.id))
        .map((p) => p.symbol),
    );
    const remaining = this.symbols().filter((s) => !createdSymbols.has(s));
    if (remaining.length === 0) {
      this.ref.close(true);
      return;
    }
    this.symbolsText.set(remaining.join(' '));
    this.notice.set(
      `Created ${outcome.created.length} — ${remaining.length} left below`,
    );
  }
}
