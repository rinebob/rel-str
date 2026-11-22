import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  DsDialogRef,
  DsDialogService,
} from '../../../../shared/ds/ds-dialog';
import { StrategyManageStore } from '../../stores/strategy-manage.store';
import { ManageExportJsonComponent } from './manage-export-json.component';
import {
  MANAGE_TEMPLATES,
  MANAGE_VARIANTS,
  variantDirectionHolds,
} from '@manage/variant-catalog';
import type {
  ManageTemplate,
  ManageTemplateOptionLeg,
  ManageVariant,
  VariantLeg,
} from '@manage/variant-contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

/**
 * @task #1548 — FE: Create New Strategy dialog. Composes an ad hoc
 * named variant from a Manage Template: per-leg Δ/DTE inputs rendered
 * from the template's leg slots, a suggested editable name, Save →
 * ephemeral `sessionVariants` entry (the Create New Instance picker's
 * merged list), Export → registry-schema JSON dialog for copy-paste.
 *
 * Variant ids are deterministic — `{templateId}-{dte}-{Δ1}-{Δ2}` — so a
 * re-composed recipe collides with the catalog (rejected) or replaces a
 * session sibling by id. Saved ad hoc variants still carry the template
 * id and pass the ID generator's shape gate, so they mint normal
 * `SYM-CDS-…` instance ids.
 */

interface LegInput {
  delta: string;
  dte: string;
}

/** Prefilled Δ per option slot, direction-aware: debit long 0.65 /
 *  short 0.55; credit long 0.25 / short 0.35; directionless (e.g.
 *  strangle) 0.30 — signed per the leg type (puts negative). Values
 *  sit off the seeded catalog grid so the opening recipe is always
 *  novel (no `already exists in the catalog` collision). */
function defaultDelta(
  slot: ManageTemplateOptionLeg,
  direction: ManageTemplate['direction'],
): number {
  const abs =
    direction === 'debit'
      ? slot.side === TradeSide.SHORT
        ? 0.55
        : 0.65
      : direction === 'credit'
        ? slot.side === TradeSide.SHORT
          ? 0.35
          : 0.25
        : 0.3;
  return slot.type === OptionType.PUT ? -abs : abs;
}

@Component({
  selector: 'app-manage-create-strategy',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="title-row">
      <h2 class="title">Create New Strategy</h2>
      <button class="dialog-x" type="button" data-testid="dialog-x" aria-label="Close"
              (click)="ref.close(undefined)">
        <span class="dse-icon">close</span>
      </button>
    </div>
    <div class="content">
      <label class="dse-field">
        <span class="field-label">Template</span>
        <select class="dse-select" data-testid="template-select"
                [ngModel]="selectedTemplateId()"
                (ngModelChange)="selectTemplate($event)">
          @for (t of templates; track t.id) {
            <option [value]="t.id">{{ t.name }}</option>
          }
        </select>
      </label>

      <div class="legs" aria-label="Leg parameters">
        @for (slot of selectedTemplate().legs; track $index) {
          @if (slot.kind === 'option') {
            <div class="leg-row" data-testid="leg-row">
              <span class="leg-label">{{ slot.role }} {{ slot.type }}</span>
              <label class="dse-field leg-field">
                <span class="field-label">Δ target</span>
                <input class="field-input" [attr.data-testid]="'leg-delta-' + $index"
                       type="number" step="0.05" min="-1" max="1"
                       [ngModel]="legInputs()[$index]?.delta ?? ''"
                       (ngModelChange)="setLegInput($index, 'delta', $event)"
                       placeholder="0.50" />
              </label>
              <label class="dse-field leg-field">
                <span class="field-label">DTE</span>
                <input class="field-input" [attr.data-testid]="'leg-dte-' + $index"
                       type="number" step="1" min="1"
                       [ngModel]="legInputs()[$index]?.dte ?? ''"
                       (ngModelChange)="setLegInput($index, 'dte', $event)"
                       placeholder="30" />
              </label>
            </div>
          } @else {
            <div class="leg-row" data-testid="leg-row">
              <span class="leg-label">{{ slot.role }} — stock ({{ slot.side }})</span>
            </div>
          }
        }
      </div>

      <label class="dse-field">
        <span class="field-label">Name</span>
        <input class="field-input" data-testid="name-input"
               [ngModel]="name()"
               (ngModelChange)="onNameInput($event)" />
        <span class="field-hint">Suggested from the template convention — editable.</span>
      </label>

      @if (previewVariant(); as v) {
        <div class="variant-id" data-testid="variant-id">
          Variant id: <code>{{ v.id }}</code>
        </div>
      }
      @if (savedNote(); as s) {
        <div class="saved-note" data-testid="saved-note">Saved '{{ s }}' — in the instance picker now.</div>
      }
      @if (formError(); as e) {
        <div class="dialog-error" data-testid="form-error" role="alert">{{ e }}</div>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn outline" type="button" data-testid="export-btn"
              [disabled]="!canSubmit()" (click)="exportJson()">Export JSON</button>
      <button class="ds-btn fill" type="button" data-testid="dialog-save"
              [disabled]="!canSubmit()" (click)="save()">Save variant</button>
    </div>
  `,
  styleUrl: './manage-create-strategy.component.scss',
})
export class ManageCreateStrategyComponent {
  protected readonly store = inject(StrategyManageStore);
  protected readonly ref = inject(DsDialogRef);
  private readonly dialog = inject(DsDialogService);

  protected readonly templates = MANAGE_TEMPLATES;
  readonly selectedTemplateId = signal<string>(MANAGE_TEMPLATES[0].id);
  readonly legInputs = signal<LegInput[]>(this.freshLegInputs());
  readonly name = signal('');
  readonly nameTouched = signal(false);
  /** Post-save confirmation — the dialog stays open for a creation
   *  run; cleared on the next input edit. */
  readonly savedNote = signal<string | null>(null);

  readonly selectedTemplate = computed<ManageTemplate>(
    () =>
      MANAGE_TEMPLATES.find((t) => t.id === this.selectedTemplateId()) ??
      MANAGE_TEMPLATES[0],
  );

  /** Parsed numeric inputs per template slot (null for stock slots). */
  private readonly parsedLegs = computed(() =>
    this.selectedTemplate().legs.map((slot, i) => {
      if (slot.kind !== 'option') return null;
      const raw = this.legInputs()[i];
      return {
        slot,
        delta: Number(raw?.delta ?? ''),
        dte: Number(raw?.dte ?? ''),
        deltaRaw: raw?.delta ?? '',
        dteRaw: raw?.dte ?? '',
      };
    }),
  );

  private readonly parsedOptionLegs = computed(() =>
    this.parsedLegs().filter((p) => p !== null),
  );

  readonly suggestedName = computed(() => {
    const tpl = this.selectedTemplate();
    const parsed = this.parsedOptionLegs();
    const allValid =
      parsed.length > 0 &&
      parsed.every(
        (p) =>
          this.isDelta(p.delta) && Number.isInteger(p.dte) && p.dte > 0,
      );
    const dtes = new Set(parsed.map((p) => p.dte));
    if (!allValid || dtes.size !== 1) return tpl.name.toLowerCase();
    const deltas = parsed.map((p) => Math.round(Math.abs(p.delta) * 100));
    // Same segment order as the ids (dte, then Δs): 'call debit spread 30 50-40'.
    return `${tpl.name.toLowerCase()} ${parsed[0].dte} ${deltas.join('-')}`;
  });

  /** The variant the current inputs mint — unconditional: undefined
   *  only when the legs can't form a variant at all (invalid numbers or
   *  multi-expiry). `formError` reads its id for the catalog check, so
   *  it must not depend on `formError` in turn. */
  readonly draftVariant = computed<ManageVariant | undefined>(() => {
    const tpl = this.selectedTemplate();
    const parsed = this.parsedOptionLegs();
    if (parsed.length === 0) return undefined;
    if (
      parsed.some(
        (p) =>
          !this.isDelta(p.delta) || !Number.isInteger(p.dte) || p.dte <= 0,
      )
    )
      return undefined;
    const dtes = new Set(parsed.map((p) => p.dte));
    if (dtes.size !== 1) return undefined;
    const dte = parsed[0].dte;
    const deltas = parsed.map((p) => Math.round(Math.abs(p.delta) * 100));
    const legs: VariantLeg[] = tpl.legs.map((slot, i) =>
      slot.kind === 'option'
        ? {
            kind: 'option',
            type: slot.type,
            side: slot.side,
            targetDelta: Number(this.legInputs()[i]?.delta),
            dte: Number(this.legInputs()[i]?.dte),
          }
        : { kind: 'stock', side: slot.side },
    );
    return {
      id: `${tpl.id}-${dte}-${deltas.join('-')}`,
      name: this.name().trim(),
      templateId: tpl.id,
      dte,
      legs,
    };
  });

  /** The variant shown/saved/exported — gated on a clean form. */
  readonly previewVariant = computed<ManageVariant | undefined>(() =>
    this.formError() === null ? this.draftVariant() : undefined,
  );

  /** First validation error, or null. Order: option-leg presence →
   *  per-leg values → multi-expiry → direction ordering → catalog recipe
   *  collision → name — recipe collision precedes name because for a
   *  catalog-shaped recipe "already in the catalog" is the informative
   *  message. */
  readonly formError = computed<string | null>(() => {
    const parsed = this.parsedLegs();
    const optionCount = this.parsedOptionLegs().length;
    if (optionCount === 0) return 'This template has no option legs';
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (p === null) continue;
      const legNo = i + 1;
      if (p.deltaRaw.trim() === '') return `leg ${legNo}: Δ target is required`;
      if (!this.isDelta(p.delta))
        return `leg ${legNo}: Δ must be in (0,1], e.g. 0.50`;
      if (
        (p.slot.type === OptionType.CALL && p.delta < 0) ||
        (p.slot.type === OptionType.PUT && p.delta > 0)
      )
        return `leg ${legNo}: Δ sign must match the leg type — calls positive, puts negative`;
      if (Math.abs(p.delta * 100 - Math.round(p.delta * 100)) > 1e-6)
        return `leg ${legNo}: Δ is whole-percent precision (2 decimals max)`;
      if (p.dteRaw.trim() === '') return `leg ${legNo}: DTE is required`;
      if (!Number.isInteger(p.dte) || p.dte <= 0)
        return `leg ${legNo}: DTE must be a positive integer`;
    }
    const dtes = new Set(this.parsedOptionLegs().map((p) => p.dte));
    if (dtes.size > 1)
      return 'All legs must share the same DTE — multi-expiry variants cannot mint an instance ID yet';
    const draft = this.draftVariant();
    const dir = this.selectedTemplate().direction;
    if (dir && draft && !variantDirectionHolds(draft, dir))
      return dir === 'debit'
        ? 'debit spread: |long Δ| must exceed |short Δ|'
        : 'credit spread: |short Δ| must exceed |long Δ|';
    if (draft && MANAGE_VARIANTS.some((c) => c.id === draft.id))
      return `This recipe already exists in the catalog as ${draft.id}`;
    const n = this.name().trim();
    if (n === '') return 'A variant name is required';
    // Scoped by id: same name on a DIFFERENT recipe is the real
    // collision — re-saving the recipe the name belongs to is a no-op.
    if (
      this.store
        .variants()
        .some(
          (v) =>
            v.name.trim().toLowerCase() === n.toLowerCase() &&
            v.id !== draft?.id,
        )
    )
      return `Name '${n}' is already used by another variant`;
    return null;
  });

  /** Save is enabled only while the draft is valid AND differs from
   *  what's already registered — an identical variant (same recipe,
   *  same name) is already saved, so there's nothing to submit. Export
   *  shares the gate: the identical variant's JSON is reachable from
   *  its registry row instead. */
  readonly canSubmit = computed(() => {
    const v = this.previewVariant();
    return (
      v !== undefined &&
      !this.store
        .variants()
        .some((e) => JSON.stringify(e) === JSON.stringify(v))
    );
  });

  constructor() {
    // Suggestion tracks the inputs until the user edits the name field.
    effect(() => {
      const s = this.suggestedName();
      if (!this.nameTouched()) this.name.set(s);
    });
  }

  selectTemplate(id: string): void {
    this.selectedTemplateId.set(id);
    this.legInputs.set(this.freshLegInputs());
    this.nameTouched.set(false);
    this.savedNote.set(null);
  }

  /** `input[type=number]` + ngModel emits `number | null` via
   *  NumberValueAccessor — normalize to the string model the parser
   *  expects (empty ↔ ''). */
  setLegInput(
    index: number,
    key: keyof LegInput,
    value: string | number | null,
  ): void {
    const v = value === null || value === undefined ? '' : String(value);
    const tpl = this.selectedTemplate();
    // Verticals share one expiry — a DTE edit propagates to every
    // option leg so the multi-expiry error never surfaces from typing.
    const syncDte = key === 'dte' && tpl.uniformDte === true;
    this.legInputs.update((rows) =>
      rows.map((r, i) =>
        i === index || (syncDte && tpl.legs[i]?.kind === 'option')
          ? { ...r, [key]: v }
          : r,
      ),
    );
    this.savedNote.set(null);
  }

  onNameInput(value: string): void {
    this.name.set(value);
    this.nameTouched.set(true);
    this.savedNote.set(null);
  }

  save(): void {
    const v = this.previewVariant();
    if (!v) return;
    this.store.addSessionVariant(v);
    // Stay open — the user runs a creation session here; the saved
    // variant shows in the registry list below and the name
    // re-suggests for the next recipe.
    this.savedNote.set(v.name);
    this.nameTouched.set(false);
  }

  exportJson(): void {
    const v = this.previewVariant();
    if (v) this.exportVariant(v);
  }

  /** Registry-schema JSON for any stored variant — used by both the
   *  draft Export button and every registry row. */
  exportVariant(v: ManageVariant): void {
    this.dialog.open(ManageExportJsonComponent, {
      data: { name: v.name, json: JSON.stringify(v, null, 2) },
    });
  }

  private isDelta(v: number): boolean {
    const a = Math.abs(v);
    return Number.isFinite(a) && a > 0 && a <= 1;
  }

  private freshLegInputs(): LegInput[] {
    const tpl =
      MANAGE_TEMPLATES.find((t) => t.id === this.selectedTemplateId()) ??
      MANAGE_TEMPLATES[0];
    return tpl.legs.map((slot) =>
      slot.kind === 'option'
        ? { delta: String(defaultDelta(slot, tpl.direction)), dte: '30' }
        : { delta: '', dte: '' },
    );
  }
}
