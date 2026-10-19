import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DsGalleryComponent } from './ds-gallery.component';

describe('DsGalleryComponent', () => {
  let fixture: ComponentFixture<DsGalleryComponent>;
  let component: DsGalleryComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DsGalleryComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(DsGalleryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('renders one card per entries array element, each with a seen-in footnote', () => {
    const cards = fixture.nativeElement.querySelectorAll('section.card');
    expect(cards.length).toBe(component.entries.length + component.widgetEntries.length);
    expect(cards.length).toBeGreaterThanOrEqual(21);
    const footers = fixture.nativeElement.querySelectorAll('.seen-in');
    expect(footers.length).toBe(cards.length);
    for (const footer of footers) {
      expect(footer.textContent).toContain('seen in:');
      expect(footer.textContent.length).toBeGreaterThan('seen in:'.length + 3);
    }
  });

  it('renders all 7 color token swatches including up/down accents', () => {
    const swatches = fixture.nativeElement.querySelectorAll('.swatch-name');
    const names = [...swatches].map((s) => (s as HTMLElement).textContent);
    for (const token of [
      '--ds-surface', '--ds-on-surface', '--ds-surface-variant',
      '--ds-error', '--ds-border-subtle', '--ds-up', '--ds-down',
    ]) {
      expect(names).toContain(token);
    }
  });

  it('renders the Widgets section — 9 demo cards, one per mixin kind', () => {
    expect(component.widgetEntries.length).toBe(9);
    const kinds = component.widgetEntries.map((e) => e.kind);
    for (const k of [
      'pill-toggle', 'pill-btn', 'badge', 'icon-btn', 'toolbar-row',
      'nav-stepper', 'field-input', 'toggle-chip', 'dir-edge',
    ]) {
      expect(kinds).toContain(k);
    }
    const el = fixture.nativeElement as HTMLElement;
    const heading = Array.from(el.querySelectorAll('.section-title')).find((h) =>
      h.textContent?.includes('Widgets'),
    );
    expect(heading).toBeTruthy();
    for (const k of kinds) {
      expect(el.querySelector(`section.card[data-kind="${k}"]`)).toBeTruthy();
    }
  });

  it('widget demos use the canonical class contracts', () => {
    const el = fixture.nativeElement as HTMLElement;
    // pill-toggle — .pill options inside a group container
    expect(el.querySelector('[data-kind="pill-toggle"] .pill-group .pill')).toBeTruthy();
    // pill-btn — .pill-count child
    expect(el.querySelector('[data-kind="pill-btn"] .pill-count')).toBeTruthy();
    // badge — direction variants
    expect(el.querySelector('[data-kind="badge"] .dir-long')).toBeTruthy();
    expect(el.querySelector('[data-kind="badge"] .dir-short')).toBeTruthy();
    // toolbar-row — composed row with spacer
    expect(el.querySelector('[data-kind="toolbar-row"] .toolbar-spacer')).toBeTruthy();
    // nav-stepper — nav-btn + nav-position
    expect(el.querySelector('[data-kind="nav-stepper"] .nav-btn')).toBeTruthy();
    expect(el.querySelector('[data-kind="nav-stepper"] .nav-position')).toBeTruthy();
    // field-input — icon + input + clear
    expect(el.querySelector('[data-kind="field-input"] input')).toBeTruthy();
    expect(el.querySelector('[data-kind="field-input"] .clear')).toBeTruthy();
    // dir-edge — both direction markers on demo elements
    expect(el.querySelector('[data-kind="dir-edge"] .dir-edge-long')).toBeTruthy();
    expect(el.querySelector('[data-kind="dir-edge"] .dir-edge-short')).toBeTruthy();
  });

  it('demo toggles track active state', () => {
    const el = fixture.nativeElement as HTMLElement;
    const pill = el.querySelector<HTMLButtonElement>(
      '[data-kind="pill-toggle"] .pill-group:not(.flat) .pill',
    )!;
    expect(pill.classList.contains('active')).toBe(false);
    pill.click();
    fixture.detectChanges();
    expect(pill.classList.contains('active')).toBe(true);

    // Chip 0 starts selected — chip 1 exercises the inactive → active path.
    const chip = el.querySelectorAll<HTMLButtonElement>('[data-kind="toggle-chip"] .chip')[1];
    expect(chip.classList.contains('active')).toBe(false);
    chip.click();
    fixture.detectChanges();
    expect(chip.classList.contains('active')).toBe(true);
  });

  it('dark toggle flips [data-theme] on the host', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-theme')).toBeNull();
    component.toggleDark();
    fixture.detectChanges();
    expect(host.getAttribute('data-theme')).toBe('dark');
    component.toggleDark();
    fixture.detectChanges();
    expect(host.getAttribute('data-theme')).toBeNull();
  });
});
