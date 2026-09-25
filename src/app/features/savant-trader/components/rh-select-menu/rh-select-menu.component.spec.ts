/// <reference types="jest" />
/**
 * RhSelectMenuComponent — generic option typing + grouped rendering.
 * Flat `options` render ungrouped at the top (sentinel slot); groups
 * render with non-selectable headers beneath them.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';

import {
  RhSelectMenuComponent,
  RhSelectOption,
  RhSelectOptionGroup,
} from './rh-select-menu.component';

type Filter = 'ALL' | 'PRIMARY' | 'custom-key';

const FLAT: RhSelectOption<Filter>[] = [{ value: 'ALL', label: 'All' }];
const GROUPS: RhSelectOptionGroup<Filter>[] = [
  { label: 'Triage', options: [{ value: 'PRIMARY', label: 'Primary' }] },
  { label: 'My lists', options: [{ value: 'custom-key', label: 'Custom' }] },
];

describe('RhSelectMenuComponent', () => {
  let fixture: ComponentFixture<RhSelectMenuComponent<Filter>>;
  let component: RhSelectMenuComponent<Filter>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RhSelectMenuComponent, MatMenuModule],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(RhSelectMenuComponent<Filter>);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'List');
    fixture.componentRef.setInput('value', 'PRIMARY');
    fixture.componentRef.setInput('options', FLAT);
    fixture.componentRef.setInput('optionGroups', GROUPS);
    fixture.detectChanges();
  });

  function openMenu(): HTMLElement[] {
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-item'));
  }

  it('renders the flat sentinel before group headers in the open menu', () => {
    const items = openMenu();
    const texts = items.map((el) => el.textContent?.trim());
    expect(texts).toEqual(['All', 'Triage', 'Primary', 'My lists', 'Custom']);
    // Group headers are disabled, options are clickable.
    expect(items[1].hasAttribute('disabled')).toBe(true);
    expect(items[2].hasAttribute('disabled')).toBe(false);
  });

  it('activeLabel resolves from flat and grouped options', () => {
    expect(component.activeLabel()).toBe('Primary');
    fixture.componentRef.setInput('value', 'ALL');
    expect(component.activeLabel()).toBe('All');
  });

  it('valueChange emits the option value, typed', () => {
    const picked: Filter[] = [];
    component.valueChange.subscribe((v) => picked.push(v));
    openMenu();
    const custom = openMenu().find((el) => el.textContent?.includes('Custom'));
    custom?.click();
    expect(picked).toEqual(['custom-key']);
  });
});
