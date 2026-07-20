import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import type { RobinhoodToolDefinition } from '@rh-agent-mcp/contracts';
import type { AccountInfo, ToolArgProperty } from './observation-dashboard.model';
import {
  argsValid,
  formatArray,
  isSymbolField,
  maskAccountNumber,
  normalizeSymbolValue,
  parseArray,
} from './observation-dashboard.model';
import {
  RhSelectMenuComponent,
  type RhSelectOption,
  type RhSelectOptionGroup,
} from '../../components/rh-select-menu/rh-select-menu.component';

const TOOL_CATEGORY_ORDER = [
  'Account & Performance',
  'Orders',
  'Market Data & Research',
  'Options',
  'Scanners',
  'Watchlists',
];

@Component({
  selector: 'app-observation-tool-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    RhSelectMenuComponent,
  ],
  templateUrl: './observation-tool-form.component.html',
  styleUrl: './observation-tool-form.component.scss',
})
export class ObservationToolFormComponent {
  readonly tools = input<RobinhoodToolDefinition[]>([]);
  readonly selectedToolName = input<string>('');
  readonly argProperties = input<ToolArgProperty[]>([]);
  readonly argValues = input<Record<string, unknown>>({});
  readonly accounts = input<AccountInfo[]>([]);
  readonly extraRedactFields = input<string>('');
  readonly loading = input<boolean>(false);

  readonly toolSelected = output<string>();
  readonly argValueChanged = output<{ name: string; value: unknown }>();
  readonly extraRedactFieldsChanged = output<string>();
  readonly execute = output<void>();

  readonly confirmationState = signal<'idle' | 'confirming'>('idle');
  readonly confirmationText = signal<string>('');

  readonly selectedTool = computed(() =>
    this.tools().find((tool) => tool.name === this.selectedToolName()),
  );

  readonly toolGroupOptions = computed<RhSelectOptionGroup[]>(() => {
    const grouped = new Map<string, RobinhoodToolDefinition[]>();
    for (const tool of this.tools()) {
      const category = tool.category ?? 'Other';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(tool);
    }
    const entries = Array.from(grouped.entries());
    entries.sort(([a], [b]) => {
      const indexA = TOOL_CATEGORY_ORDER.indexOf(a);
      const indexB = TOOL_CATEGORY_ORDER.indexOf(b);
      if (indexA === -1 && indexB === -1) return a.localeCompare(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
    return entries.map(([label, items]) => ({
      label,
      options: items.map((tool) => ({ value: tool.name, label: tool.name, description: tool.description })),
    }));
  });

  readonly needsConfirmation = computed(() => {
    const tool = this.selectedTool();
    return !!(tool && (tool.mutation || tool.simulation));
  });

  readonly financialMutation = computed(() => !!this.selectedTool()?.financialMutation);

  readonly argsValid = computed(() => argsValid(this.argProperties(), this.argValues()));

  readonly canExecute = computed(() => {
    if (this.loading()) {
      return false;
    }
    if (!this.argsValid()) {
      return false;
    }
    if (!this.needsConfirmation()) {
      return true;
    }
    if (this.confirmationState() === 'idle') {
      // First click reveals the confirmation panel.
      return true;
    }
    if (this.financialMutation()) {
      return this.confirmationText().trim() === this.selectedToolName();
    }
    return true;
  });

  onToolSelected(name: string): void {
    this.confirmationState.set('idle');
    this.confirmationText.set('');
    this.toolSelected.emit(name);
  }

  updateArgValue(name: string, value: unknown): void {
    const normalized = isSymbolField(name) ? normalizeSymbolValue(value) : value;
    this.argValueChanged.emit({ name, value: normalized });
  }

  formatArray(value: unknown): string {
    return formatArray(value);
  }

  parseArray(value: string): string[] {
    return parseArray(value);
  }

  parseNumber(value: unknown): number | null {
    if (typeof value !== 'string' || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  parseDate(value: string): string {
    // Keep the raw ISO date string from the date input.
    return value;
  }

  maskAccountNumber(value: string): string {
    return maskAccountNumber(value);
  }

  enumOptions(values: string[] | undefined): RhSelectOption[] {
    return (values ?? []).map((value) => ({ value, label: value }));
  }

  accountOptions(useRhsAccountNumber: boolean | undefined): RhSelectOption[] {
    return this.accounts().map((account) => {
      const value = useRhsAccountNumber
        ? (account.rhs_account_number ?? account.account_number)
        : account.account_number;
      const label = `${account.nickname ?? account.brokerage_account_type ?? account.type} — ${this.maskAccountNumber(value)}`;
      const badges: string[] = [];
      if (account.agentic_allowed) badges.push('agentic');
      if (account.is_default) badges.push('default');
      return { value, label, badges };
    });
  }

  selectedValue(value: unknown): string {
    return value != null ? String(value) : '';
  }

  onExecute(): void {
    if (this.needsConfirmation() && this.confirmationState() === 'idle') {
      this.confirmationState.set('confirming');
      return;
    }
    this.execute.emit();
    this.confirmationState.set('idle');
    this.confirmationText.set('');
  }
}
