/// <reference types="jest" />
/**
 * Tests for ManageExportJsonComponent — the Export-to-JSON dialog
 * (#1548). Renders the registry-shaped variant JSON for copy-paste and
 * exposes a Copy button backed by the clipboard API.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManageExportJsonComponent } from './manage-export-json.component';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../shared/ds/ds-dialog';

describe('ManageExportJsonComponent', () => {
  let fixture: ComponentFixture<ManageExportJsonComponent>;
  let component: ManageExportJsonComponent;
  let mockRef: { close: jest.Mock };
  const data = {
    name: 'call debit spread 40 55-35',
    json: '{\n  "id": "cds-40-55-35"\n}',
  };

  function create(): void {
    mockRef = { close: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ManageExportJsonComponent],
      providers: [
        { provide: DsDialogRef, useValue: mockRef },
        { provide: DS_DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(ManageExportJsonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  it('renders the passed JSON in a readonly block', () => {
    create();
    const pre = el('json-block');
    expect(pre?.textContent).toContain('"id": "cds-40-55-35"');
    expect(el('variant-name')?.textContent).toContain(data.name);
  });

  it('copy writes the JSON to the clipboard and flips the label', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    create();
    (el('copy-btn') as HTMLButtonElement).click();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith(data.json);
    expect(el('copy-btn')?.textContent).toMatch(/copied/i);
  });

  it('close dismisses the dialog', () => {
    create();
    (el('close-btn') as HTMLButtonElement).click();
    expect(mockRef.close).toHaveBeenCalled();
  });
});
