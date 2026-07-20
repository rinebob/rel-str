import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { RobinhoodMcpObservationService } from '../../services/robinhood-mcp-observation.service';
import {
  type RobinhoodToolDefinition,
  type ToolExecutionResult,
  type ToolExecutionSuccess,
} from '@rh-agent-mcp/contracts';
import { ObservationToolFormComponent } from './observation-tool-form.component';
import { ObservationResultPanelComponent } from './observation-result-panel.component';
import {
  type AccountInfo,
  type CallHistoryEntry,
  type ToolArgProperty,
  argsValid,
  buildArgProperties,
  cleanArgsForExecution,
  parseExtraRedactFields,
  selectDefaultAccount,
} from './observation-dashboard.model';

@Component({
  selector: 'app-observation-dashboard',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, RouterLink, ObservationToolFormComponent, ObservationResultPanelComponent],
  templateUrl: './observation-dashboard.component.html',
  styleUrl: './observation-dashboard.component.scss',
})
export class ObservationDashboardComponent implements OnInit, OnDestroy {
  private readonly observationService = inject(RobinhoodMcpObservationService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly uiStateService = inject(UiStateService);
  protected readonly appRoutes = AppRoutes;

  readonly tools = signal<RobinhoodToolDefinition[]>([]);
  readonly selectedToolName = signal<string>('');
  readonly extraRedactFields = signal<string>('');
  readonly result = signal<ToolExecutionResult | null>(null);
  readonly loading = signal<boolean>(false);
  readonly history = signal<CallHistoryEntry[]>([]);
  readonly showRaw = signal<boolean>(false);
  readonly showHistory = signal<boolean>(false);
  readonly accounts = signal<AccountInfo[]>([]);
  readonly argProperties = signal<ToolArgProperty[]>([]);
  readonly argValues = signal<Record<string, unknown>>({});

  readonly selectedTool = computed(() =>
    this.tools().find((tool) => tool.name === this.selectedToolName()),
  );

  async ngOnInit(): Promise<void> {
    this.uiStateService.setFullscreen(true);
    try {
      const loaded = await this.observationService.listTools();
      this.tools.set(loaded);
      if (loaded.length > 0) {
        this.selectedToolName.set(loaded[0].name);
        this.rebuildArgsForSelectedTool();
      }
    } catch (error) {
      this.showError('Failed to load tool list. Is the local API running?');
    }

    await this.loadAccounts();
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  onToolSelected(name: string): void {
    this.selectedToolName.set(name);
    this.result.set(null);
    this.rebuildArgsForSelectedTool();
  }

  updateArgValue({ name, value }: { name: string; value: unknown }): void {
    this.argValues.update((current) => ({ ...current, [name]: value }));
  }

  async execute(): Promise<void> {
    if (!argsValid(this.argProperties(), this.argValues())) {
      this.showError('Fill in all required arguments.');
      return;
    }

    const toolName = this.selectedToolName();
    if (!toolName) {
      this.showError('Select a tool first.');
      return;
    }

    const args = cleanArgsForExecution(this.argProperties(), this.argValues());

    this.loading.set(true);
    this.result.set(null);

    try {
      const response = await this.observationService.executeTool(toolName, {
        args,
        extraRedactFields: parseExtraRedactFields(this.extraRedactFields()),
      });
      this.result.set(response);
      this.history.update((entries) => [
        { tool: toolName, args, result: response, timestamp: new Date() },
        ...entries,
      ]);
      if (!response.success) {
        this.showError(response.error);
      }
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.set(false);
    }
  }

  loadHistoryEntry(entry: CallHistoryEntry): void {
    this.selectedToolName.set(entry.tool);
    this.result.set(entry.result);
    const tool = this.selectedTool();
    if (tool) {
      this.rebuildArgsForTool(tool, entry.args);
    }
  }

  clearHistory(): void {
    this.history.set([]);
  }

  toggleRaw(): void {
    this.showRaw.update((value) => !value);
  }

  toggleHistory(): void {
    this.showHistory.update((value) => !value);
  }

  private async loadAccounts(): Promise<void> {
    try {
      const result = await this.observationService.executeTool('get_accounts', { args: {} });
      if (!result.success) {
        return;
      }
      const parsed = (result as ToolExecutionSuccess).parsed;
      let accounts: AccountInfo[] | undefined;
      if (Array.isArray(parsed)) {
        accounts = parsed as AccountInfo[];
      } else if (parsed !== null && typeof parsed === 'object') {
        const parsedRecord = parsed as Record<string, unknown>;
        const data = parsedRecord['data'];
        if (data !== null && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['accounts'])) {
          accounts = (data as Record<string, unknown>)['accounts'] as AccountInfo[];
        } else if (Array.isArray(parsedRecord['accounts'])) {
          accounts = parsedRecord['accounts'] as AccountInfo[];
        }
      }
      if (accounts && accounts.length > 0) {
        this.accounts.set(accounts);
        this.rebuildArgsForSelectedTool();
      }
    } catch {
      // Account prefill is best-effort; the user can still type account numbers manually.
    }
  }

  private rebuildArgsForSelectedTool(): void {
    const tool = this.selectedTool();
    if (!tool) {
      return;
    }
    this.rebuildArgsForTool(tool, {});
  }

  private rebuildArgsForTool(
    tool: RobinhoodToolDefinition,
    overrides: Record<string, unknown>,
  ): void {
    const { properties, values } = buildArgProperties(
      tool,
      selectDefaultAccount(this.accounts()),
      this.accounts(),
    );
    for (const [name, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        values[name] = value;
      }
    }
    this.argProperties.set(properties);
    this.argValues.set(values);
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Dismiss', { duration: 6000 });
  }
}
