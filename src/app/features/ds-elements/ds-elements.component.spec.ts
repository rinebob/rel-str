import { readFileSync } from 'node:fs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DsElementsComponent } from './ds-elements.component';

const SITES = JSON.parse(
  readFileSync('docs/topics/1024-design-system/ui-element-sites.json', 'utf8'),
) as { sites: { archetype: string; count: number }[] };
const JSON_COUNTS = new Map<string, number>();
for (const s of SITES.sites) {
  JSON_COUNTS.set(s.archetype, (JSON_COUNTS.get(s.archetype) ?? 0) + s.count);
}

describe('DsElementsComponent — /dev/ds-elements zoo (#1348)', () => {
  let fixture: ComponentFixture<DsElementsComponent>;
  let component: DsElementsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DsElementsComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(DsElementsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('has a section per #1348 family (buttons, forms, overlays, data, layout, icons, cdk, syncfusion, ds, natives)', () => {
    const titles = component.families.map((f) => f.title.toLowerCase());
    for (const want of ['button', 'form', 'overlay', 'data display', 'layout',
      'icon', 'cdk', 'syncfusion', 'savant-ds', 'native']) {
      expect({ want, found: titles.some((t) => t.includes(want)) })
        .toEqual({ want, found: true });
    }
    const families = fixture.nativeElement.querySelectorAll('section.family');
    expect(families.length).toBe(component.families.length);
  });

  it('renders one card per specimen, each with count, plan chip, and provenance', () => {
    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('article.card');
    const expected = component.families.reduce((n, f) => n + f.items.length, 0);
    expect(cards.length).toBe(expected);
    expect(cards.length).toBeGreaterThanOrEqual(45);

    for (const card of Array.from(cards)) {
      expect(card.querySelector('.card-count')!.textContent).toMatch(/\d+×/);
      expect(card.querySelector('.plan-chip')!.textContent)
        .toMatch(/REPLACE|ADOPT|NEW|KEEP|DECISION|DROP/);
      // NOW | DS TODAY | TARGET panes
      expect(card.querySelectorAll('.pane').length).toBe(3);
      const foot = card.querySelector('.zoo-foot')!.textContent!;
      expect(foot).toContain('seen in:');
      expect(foot.length).toBeGreaterThan('seen in:'.length + 3);
    }
  });

  it('every card renders a non-empty NOW pane — no unhandled specimen kinds', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.specimen-missing')).toBeNull();
    const items = component.families.flatMap((f) => f.items);
    const cards = el.querySelectorAll('article.card');
    expect(cards.length).toBe(items.length);
    for (const card of Array.from(cards)) {
      const now = card.querySelector('.pane')!;
      // pane-label + at least one rendered specimen node
      const specimenNodes = Array.from(now.childNodes).filter(
        (n) => !(n instanceof Text && !n.textContent!.trim())
          && !(n as HTMLElement).classList?.contains('pane-label'));
      expect(specimenNodes.length).toBeGreaterThan(0);
    }
  });

  it('every archetype has a real target — no placeholder sketches remain', () => {
    const items = component.families.flatMap((f) => f.items);
    for (const i of items) {
      expect(Boolean(i.target?.kind || i.target?.note)).toBe(true);
    }
  });

  it('covers every archetype kind exactly once', () => {
    const kinds = component.families.flatMap((f) => f.items.map((i) => i.kind));
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('card counts pin to ui-element-sites.json (snapshot guard)', () => {
    const items = component.families.flatMap((f) => f.items);
    const covered = new Set<string>();
    for (const i of items) {
      const want = i.archetypes.reduce((n, a) => n + (JSON_COUNTS.get(a) ?? 0), 0);
      expect({ name: i.name, count: i.count, want })
        .toEqual({ name: i.name, count: want, want });
      for (const a of i.archetypes) {
        expect(covered.has(a)).toBe(false);
        covered.add(a);
      }
    }
    // Every nonzero archetype in the JSON has a card.
    for (const [a, n] of JSON_COUNTS) {
      if (n > 0) expect({ archetype: a, covered: covered.has(a) })
        .toEqual({ archetype: a, covered: true });
    }
    // Header totals = the JSON totals.
    const jsonTotal = [...JSON_COUNTS.values()].reduce((a, b) => a + b, 0);
    expect(component.totalUsages).toBe(jsonTotal);
    expect(component.archetypeCount)
      .toBe([...JSON_COUNTS.values()].filter((n) => n > 0).length);
    expect(component.cardCount).toBe(items.length);
  });

  it('renders real Material specimens', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mat-form-field input[matinput]')).toBeTruthy();
    // mat-form-field-parts error state is a REAL control state, not
    // class-faked — the form-field must carry the invalid marker.
    expect(el.querySelector('.mat-mdc-form-field.mat-form-field-invalid')).toBeTruthy();
    expect(el.querySelector('mat-error')).toBeTruthy();
    expect(el.querySelector('mat-select')).toBeTruthy();
    expect(el.querySelector('table[mat-table]')).toBeTruthy();
    expect(el.querySelector('mat-expansion-panel')).toBeTruthy();
    expect(el.querySelector('mat-tab-group')).toBeTruthy();
    expect(el.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(el.querySelector('button[mat-button]')).toBeTruthy();
  });

  it('the NOW mat-table is not styled by dense-table', () => {
    const el = fixture.nativeElement as HTMLElement;
    const wrap = el.querySelector('table[mat-table]')!.closest('div')!;
    expect(wrap.classList.contains('demo-table')).toBe(false);
    // ds-dense-table's plain table still carries the class
    const dense = Array.from(el.querySelectorAll('table')).find(
      (t) => !t.hasAttribute('mat-table'));
    expect(dense?.classList.contains('demo-table')).toBe(true);
  });

  it('renders the DS-widget baseline via canonical class contracts', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pill-group .pill')).toBeTruthy();
    expect(el.querySelector('.pill-btn .pill-count')).toBeTruthy();
    expect(el.querySelector('.badge.dir-long')).toBeTruthy();
    expect(el.querySelector('.icon-btn .dse-icon')).toBeTruthy();
    expect(el.querySelector('.demo-toolbar .toolbar-spacer')).toBeTruthy();
    expect(el.querySelector('.dir-edge-long')).toBeTruthy();
    expect(el.querySelector('.chip')).toBeTruthy();
    expect(el.querySelector('app-rh-select-menu')).toBeTruthy();
    // ds-btn (#1163 phase A) renders as a TARGET-pane specimen
    expect(el.querySelector('.ds-btn.fill')).toBeTruthy();
    expect(el.querySelector('.ds-btn.outline')).toBeTruthy();
  });

  it('theme controls flip data-theme and push the derived accent family onto the host', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-theme')).toBe('dark');
    component.toggleDark();
    fixture.detectChanges();
    expect(host.getAttribute('data-theme')).toBe('light');
    component.toggleDark();
    fixture.detectChanges();

    component.setAccent('mint');
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--ds-accent')).toBe('#00ff9d');
    expect(host.style.getPropertyValue('--mat-sys-primary')).toBe('#00ff9d');
    // Derived family — the whole point of the accent preview.
    for (const v of ['--ds-on-accent', '--ds-accent-container',
      '--ds-on-accent-container', '--ds-accent-glow', '--ds-accent-text']) {
      expect(host.style.getPropertyValue(v)).not.toBe('');
    }
    component.setAccent('current');
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--ds-accent')).toBe('');
    expect(host.style.getPropertyValue('--ds-accent-container')).toBe('');
    expect(host.style.getPropertyValue('--ds-accent-text')).toBe('');
  });

  it('light-mode accent derivations deepen accent + accent-text', () => {
    component.setAccent('cyan');
    component.dark.set(false);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const accent = host.style.getPropertyValue('--ds-accent');
    const accentText = host.style.getPropertyValue('--ds-accent-text');
    expect(accent).not.toBe('#22d3ee'); // deepened for light surfaces
    expect(accentText).not.toBe('#22d3ee');
    expect(accent).toContain('color-mix');
    expect(accentText).toContain('color-mix');
  });

  it('pill-toggle and toggle-chip demos track active state', () => {
    const el = fixture.nativeElement as HTMLElement;
    const pill = el.querySelector<HTMLButtonElement>('.pill-group:not(.flat) .pill')!;
    pill.click();
    fixture.detectChanges();
    expect(pill.classList.contains('active')).toBe(true);

    const chip = el.querySelectorAll<HTMLButtonElement>('.chip')[1];
    chip.click();
    fixture.detectChanges();
    expect(chip.classList.contains('active')).toBe(true);
  });
});
