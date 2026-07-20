import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { formatResultValue } from './observation-dashboard.model';
import type { CallHistoryEntry } from './observation-dashboard.model';
import type {
  ToolExecutionResult,
  ToolExecutionSuccess,
  ToolExecutionFailure,
} from '@rh-agent-mcp/contracts';

@Component({
  selector: 'app-observation-result-panel',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule],
  templateUrl: './observation-result-panel.component.html',
  styleUrl: './observation-result-panel.component.scss',
})
export class ObservationResultPanelComponent {
  readonly result = input<ToolExecutionResult | null>(null);
  readonly history = input<CallHistoryEntry[]>([]);
  readonly showRaw = input<boolean>(false);
  readonly showHistory = input<boolean>(false);

  readonly toggleRaw = output<void>();
  readonly toggleHistory = output<void>();
  readonly loadHistoryEntry = output<CallHistoryEntry>();
  readonly clearHistory = output<void>();

  readonly resultSuccess = computed<ToolExecutionSuccess | null>(() =>
    this.result()?.success ? (this.result() as ToolExecutionSuccess) : null,
  );
  readonly resultError = computed<ToolExecutionFailure | null>(() =>
    this.result() && !this.result()!.success
      ? (this.result() as ToolExecutionFailure)
      : null,
  );

  formatResult(value: unknown): string {
    return JSON.stringify(formatResultValue(value), null, 2);
  }

  onToggleRaw(): void {
    this.toggleRaw.emit();
  }

  onToggleHistory(): void {
    this.toggleHistory.emit();
  }

  onLoadHistoryEntry(entry: CallHistoryEntry): void {
    this.loadHistoryEntry.emit(entry);
  }

  onClearHistory(): void {
    this.clearHistory.emit();
  }
}
