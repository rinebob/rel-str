import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
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
  maskAccountNumber,
  parseArray,
} from './observation-dashboard.model';

@Component({
  selector: 'app-observation-tool-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatSelectModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
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

  readonly toolsByCategory = computed(() => {
    const grouped = new Map<string, RobinhoodToolDefinition[]>();
    for (const tool of this.tools()) {
      const category = tool.category ?? 'Other';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(tool);
    }
    return Array.from(grouped.entries()).map(([category, items]) => ({ category, items }));
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
    this.argValueChanged.emit({ name, value });
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
