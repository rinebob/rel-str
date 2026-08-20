/**
 * @topic #137 — Strategy Builder UI
 *
 * Component tests for StrategyBuilderFormComponent (dialog version).
 * Verifies field rendering, validation, ID preview, edit pre-fill, and
 * save dispatch. The store is mocked; the dialog is tested via
 * MAT_DIALOG_DATA injection.
 */

jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal, ɵresolveComponentResources } from '@angular/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { StrategyBuilderFormComponent } from './strategy-builder-form.component';
import { StrategyBuilderStore } from '../../stores/strategy-builder.store';
import { OptionType, PositionSpreadType, StrategyFrequency } from '@options/common';
import { TradeSide } from '@common';
import {
  ExitPolicy,
  LifecycleState,
  type StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';

// ── Resolve external templateUrl/styleUrl from disk ──────────────────────────

const componentDir = __dirname;

beforeAll(async () => {
  await ɵresolveComponentResources(async (url: string) => {
    const text = readFileSync(resolve(componentDir, url), 'utf-8');
    return { text: async () => text };
  });
});

// ── Mock store factory ───────────────────────────────────────────────────────

function createMockStore(overrides: Record<string, any> = {}) {
  const instances = signal<StrategyInstanceConfig[]>(overrides.instances ?? []);
  const isLoading = signal(overrides.isLoading ?? false);
  const error = signal<string | null>(overrides.error ?? null);
  const selectedInstance = signal<StrategyInstanceConfig | null>(overrides.selectedInstance ?? null);

  return {
    instances,
    isLoading,
    error,
    selectedInstance,
    activeInstances: signal<StrategyInstanceConfig[]>([]),
    pausedInstances: signal<StrategyInstanceConfig[]>([]),
    stoppedInstances: signal<StrategyInstanceConfig[]>([]),
    load: jest.fn(),
    create: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
    toggleLifecycle: jest.fn(),
    selectForEdit: jest.fn(),
    clearSelection: jest.fn(),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeInstance(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    id: '250816-QQQM-CSP-020-28-D',
    symbol: 'QQQM',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.2,
    dteMin: 21,
    dteMax: 30,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
    lifecycleState: LifecycleState.ACTIVE,
    marketRegime: undefined,
    userId: 'test-user',
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
    ...overrides,
  };
}

// ── Test setup ───────────────────────────────────────────────────────────────

describe('StrategyBuilderFormComponent', () => {
  let fixture: ComponentFixture<StrategyBuilderFormComponent>;
  let component: StrategyBuilderFormComponent;
  let mockStore: ReturnType<typeof createMockStore>;
  let mockDialogRef: { close: jest.Mock };

  async function configureWithStore(storeOverrides: Record<string, any> = {}, dialogData: { instance: StrategyInstanceConfig | null } = { instance: null }) {
    mockStore = createMockStore(storeOverrides);
    mockDialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [StrategyBuilderFormComponent],
      providers: [
        provideNoopAnimations(),
        { provide: StrategyBuilderStore, useValue: mockStore },
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StrategyBuilderFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  // ── Component creation + field rendering ──────────────────────────────────

  it('creates the component', async () => {
    await configureWithStore();
    expect(component).toBeTruthy();
  });

  it('renders spread type dropdown', async () => {
    await configureWithStore();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('mat-select[formControlName="spreadType"]')).toBeTruthy();
  });

  it('renders symbol, frequency, and open time inputs', async () => {
    await configureWithStore();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('input[formControlName="symbol"]')).toBeTruthy();
    expect(native.querySelector('mat-select[formControlName="frequency"]')).toBeTruthy();
    expect(native.querySelector('input[formControlName="openTimePT"]')).toBeTruthy();
  });

  // ── Symbol uppercase normalization ────────────────────────────────────────

  it('normalizes symbol input to uppercase', async () => {
    await configureWithStore();
    component.form.controls.symbol.setValue('qqqm');
    expect(component.form.controls.symbol.value).toBe('QQQM');
  });

  // ── Live ID preview ───────────────────────────────────────────────────────

  it('generates a live ID preview from form values', async () => {
    await configureWithStore();
    component.form.patchValue({
      spreadType: PositionSpreadType.CASH_SECURED_PUT,
      symbol: 'QQQM',
      frequency: StrategyFrequency.DAILY,
      targetDelta: 0.2,
      dteMin: 21,
      dteMax: 30,
    });
    const preview = component.idPreview();
    expect(preview).toContain('QQQM');
    expect(preview).toContain('CSP');
    expect(preview).toContain('-D');
  });

  it('shows placeholder when form fields are incomplete', async () => {
    await configureWithStore();
    component.form.controls.symbol.setValue('');
    expect(component.idPreview()).toBe('—');
  });

  it('includes open time segment in the ID preview', async () => {
    await configureWithStore();
    component.form.patchValue({
      spreadType: PositionSpreadType.CASH_SECURED_PUT,
      symbol: 'SCHB',
      frequency: StrategyFrequency.DAILY,
      openTimePT: '07:30',
      targetDelta: 0.3,
      dteMin: 30,
      dteMax: 45,
    });
    const preview = component.idPreview();
    expect(preview).toContain('-0730');
  });

  // ── Phase config + DTE validation ─────────────────────────────────────────

  it('renders phase config fields', async () => {
    await configureWithStore();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('input[formControlName="targetDelta"]')).toBeTruthy();
    expect(native.querySelector('input[formControlName="dteMin"]')).toBeTruthy();
    expect(native.querySelector('input[formControlName="dteMax"]')).toBeTruthy();
  });

  it('validates DTE max must be greater than DTE min', async () => {
    await configureWithStore();
    component.form.patchValue({ dteMin: 30, dteMax: 20 });
    expect(component.form.invalid).toBe(true);
  });

  it('accepts DTE max greater than DTE min', async () => {
    await configureWithStore();
    component.form.patchValue({ dteMin: 21, dteMax: 30, symbol: 'QQQM' });
    expect(component.form.valid).toBe(true);
  });

  it('validates delta must be between 0 and 1', async () => {
    await configureWithStore();
    component.form.patchValue({ targetDelta: 1.5 });
    expect(component.form.controls.targetDelta.invalid).toBe(true);
    component.form.patchValue({ targetDelta: 0 });
    expect(component.form.controls.targetDelta.invalid).toBe(true);
    component.form.patchValue({ targetDelta: 0.2 });
    expect(component.form.controls.targetDelta.valid).toBe(true);
  });

  // ── Exit policies + conditional fields ────────────────────────────────────

  it('renders exit policy multi-select', async () => {
    await configureWithStore();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="exit-policy-select"]')).toBeTruthy();
  });

  it('shows conditional parameter fields when CLOSE_AT_TARGET_GAIN is selected', async () => {
    await configureWithStore();
    component.selectedExitPolicies.set([ExitPolicy.CLOSE_AT_TARGET_GAIN]);
    fixture.detectChanges();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('input[formControlName="targetGainPct"]')).toBeTruthy();
  });

  it('shows conditional parameter fields when STOP_LOSS is selected', async () => {
    await configureWithStore();
    component.selectedExitPolicies.set([ExitPolicy.STOP_LOSS]);
    fixture.detectChanges();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('input[formControlName="stopLossPct"]')).toBeTruthy();
  });

  it('defaults trailing stop to stop loss value when both are selected', async () => {
    await configureWithStore();
    component.selectedExitPolicies.set([ExitPolicy.STOP_LOSS, ExitPolicy.TRAILING_STOP]);
    component.form.controls.stopLossPct.setValue(15);
    fixture.detectChanges();
    expect(component.form.controls.trailingStopPct.value).toBe(15);
  });

  it('defaults trailing stop to stop loss value when stop loss changes after both selected', async () => {
    await configureWithStore();
    component.selectedExitPolicies.set([ExitPolicy.STOP_LOSS, ExitPolicy.TRAILING_STOP]);
    component.form.controls.stopLossPct.setValue(10);
    fixture.detectChanges();
    expect(component.form.controls.trailingStopPct.value).toBe(10);
    component.form.controls.stopLossPct.setValue(25);
    fixture.detectChanges();
    expect(component.form.controls.trailingStopPct.value).toBe(25);
  });

  // ── Exit policy compatibility validation ──────────────────────────────────

  it('rejects HOLD_TO_EXPIRATION combined with an active exit policy', async () => {
    await configureWithStore();
    component.onExitPoliciesChange([ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.STOP_LOSS]);
    expect(component.exitPolicyError()).toContain('Incompatible');
  });

  it('rejects WHEEL_IF_ASSIGNED combined with HOLD_SHARES_IF_ASSIGNED', async () => {
    await configureWithStore();
    component.onExitPoliciesChange([ExitPolicy.WHEEL_IF_ASSIGNED, ExitPolicy.HOLD_SHARES_IF_ASSIGNED]);
    expect(component.exitPolicyError()).toContain('Incompatible');
  });

  it('rejects empty exit policy selection', async () => {
    await configureWithStore();
    component.onExitPoliciesChange([]);
    expect(component.exitPolicyError()).toContain('At least one');
  });

  it('accepts a single active exit policy', async () => {
    await configureWithStore();
    component.onExitPoliciesChange([ExitPolicy.STOP_LOSS]);
    expect(component.exitPolicyError()).toBeNull();
  });

  it('accepts compatible combinations (STOP_LOSS + TRAILING_STOP)', async () => {
    await configureWithStore();
    component.onExitPoliciesChange([ExitPolicy.STOP_LOSS, ExitPolicy.TRAILING_STOP]);
    expect(component.exitPolicyError()).toBeNull();
  });

  it('disables save button when exit policies are incompatible', async () => {
    await configureWithStore();
    component.onExitPoliciesChange([ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.STOP_LOSS]);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── Open time validation ──────────────────────────────────────────────────

  it('validates openTimePT must be HH:MM format', async () => {
    await configureWithStore();
    component.form.controls.openTimePT.setValue('noon');
    expect(component.form.controls.openTimePT.invalid).toBe(true);
    component.form.controls.openTimePT.setValue('25:00');
    expect(component.form.controls.openTimePT.invalid).toBe(true);
    component.form.controls.openTimePT.setValue('12:00');
    expect(component.form.controls.openTimePT.valid).toBe(true);
    component.form.controls.openTimePT.setValue('07:30');
    expect(component.form.controls.openTimePT.valid).toBe(true);
  });

  it('shows no parameter fields for HOLD_TO_EXPIRATION', async () => {
    await configureWithStore();
    component.selectedExitPolicies.set([ExitPolicy.HOLD_TO_EXPIRATION]);
    fixture.detectChanges();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('input[formControlName="targetGainPct"]')).toBeFalsy();
    expect(native.querySelector('input[formControlName="stopLossPct"]')).toBeFalsy();
  });

  // ── Save button + dispatch ────────────────────────────────────────────────

  it('renders save button', async () => {
    await configureWithStore();
    const native = fixture.nativeElement as HTMLElement;
    expect(native.querySelector('[data-testid="save-btn"]')).toBeTruthy();
  });

  it('disables save button when form is invalid', async () => {
    await configureWithStore();
    component.form.controls.symbol.setValue('');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('calls store.create() on save in create mode', async () => {
    await configureWithStore();
    component.form.patchValue({
      spreadType: PositionSpreadType.CASH_SECURED_PUT,
      symbol: 'QQQM',
      frequency: StrategyFrequency.DAILY,
      openTimePT: '12:00',
      targetDelta: 0.2,
      dteMin: 21,
      dteMax: 30,
    });
    component.selectedExitPolicies.set([ExitPolicy.HOLD_TO_EXPIRATION]);
    fixture.detectChanges();
    await component.save();
    expect(mockStore.create).toHaveBeenCalled();
  });

  it('calls store.update() on save in edit mode', async () => {
    const instance = makeInstance();
    await configureWithStore({}, { instance });
    component.form.patchValue({ symbol: 'SPY' });
    fixture.detectChanges();
    await component.save();
    expect(mockStore.update).toHaveBeenCalled();
  });

  it('closes dialog after save', async () => {
    await configureWithStore();
    component.form.patchValue({
      spreadType: PositionSpreadType.CASH_SECURED_PUT,
      symbol: 'QQQM',
      frequency: StrategyFrequency.DAILY,
      openTimePT: '12:00',
      targetDelta: 0.2,
      dteMin: 21,
      dteMax: 30,
    });
    component.selectedExitPolicies.set([ExitPolicy.HOLD_TO_EXPIRATION]);
    fixture.detectChanges();
    await component.save();
    expect(mockDialogRef.close).toHaveBeenCalledWith(true);
  });

  it('does not close dialog and shows error when store.create() fails', async () => {
    await configureWithStore();
    mockStore.error.set('Firestore permission denied');
    component.form.patchValue({
      spreadType: PositionSpreadType.CASH_SECURED_PUT,
      symbol: 'QQQM',
      frequency: StrategyFrequency.DAILY,
      openTimePT: '12:00',
      targetDelta: 0.2,
      dteMin: 21,
      dteMax: 30,
    });
    component.selectedExitPolicies.set([ExitPolicy.HOLD_TO_EXPIRATION]);
    fixture.detectChanges();
    await component.save();
    expect(mockDialogRef.close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.error-banner')).toBeTruthy();
  });

  // ── Edit mode pre-fill ────────────────────────────────────────────────────

  it('pre-fills all form fields from instance in edit mode', async () => {
    const instance = makeInstance({
      symbol: 'SPY',
      frequency: StrategyFrequency.WEEKLY,
      openTimePT: '09:30',
      phases: [{
        spreadType: PositionSpreadType.COVERED_CALL,
        targetDelta: 0.3,
        dteMin: 7,
        dteMax: 14,
      }],
      exitPolicies: [{ policy: ExitPolicy.STOP_LOSS, stopLossPct: 10 }],
    });
    await configureWithStore({}, { instance });
    expect(component.form.controls.symbol.value).toBe('SPY');
    expect(component.form.controls.frequency.value).toBe(StrategyFrequency.WEEKLY);
    expect(component.form.controls.openTimePT.value).toBe('09:30');
    expect(component.form.controls.spreadType.value).toBe(PositionSpreadType.COVERED_CALL);
    expect(component.form.controls.targetDelta.value).toBe(0.3);
    expect(component.form.controls.dteMin.value).toBe(7);
    expect(component.form.controls.dteMax.value).toBe(14);
    expect(component.isEditMode()).toBe(true);
  });

  it('is in create mode when no instance provided', async () => {
    await configureWithStore();
    expect(component.isEditMode()).toBe(false);
  });
});
