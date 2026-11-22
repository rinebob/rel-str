import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import {
  DS_DIALOG_DATA,
  DsDialogRef,
} from '../../../../shared/ds/ds-dialog';

/**
 * @task #1548 — FE: Export-to-JSON dialog. Shows the ad hoc variant
 * serialized in registry shape (the MANAGE_VARIANTS entry form) for
 * copy-paste into the curated catalog artifact.
 */

export interface ExportJsonData {
  name: string;
  json: string;
}

@Component({
  selector: 'app-manage-export-json',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">Export Variant JSON</h2>
    <div class="content">
      <p class="export-name" data-testid="variant-name">{{ data.name }}</p>
      <pre class="json-block" data-testid="json-block">{{ data.json }}</pre>
      <p class="field-hint">
        Paste into the variant registry (MANAGE_VARIANTS in
        shared/manage-variant-catalog.ts) to make this variant permanent.
      </p>
    </div>
    <div class="actions" align="end">
      <button class="ds-btn outline" type="button" data-testid="close-btn"
              (click)="ref.close()">Close</button>
      <button class="ds-btn fill" type="button" data-testid="copy-btn"
              (click)="copy()">{{ copied() ? 'Copied' : copyFailed() ? 'Copy failed' : 'Copy JSON' }}</button>
    </div>
  `,
  styleUrl: './manage-export-json.component.scss',
})
export class ManageExportJsonComponent {
  protected readonly ref = inject(DsDialogRef);
  protected readonly data = inject(DS_DIALOG_DATA) as ExportJsonData;
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.data.json);
      this.copied.set(true);
    } catch {
      this.copyFailed.set(true);
    }
  }
}
