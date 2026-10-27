import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DsGalleryComponent } from './ds-gallery.component';

describe('DsGalleryComponent', () => {
  let fixture: ComponentFixture<DsGalleryComponent>;
  let component: DsGalleryComponent;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [DsGalleryComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(DsGalleryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    // App-preview specs set data-theme on <html> — never leak it to the
    // next spec even when an assertion fails mid-test.
    delete document.documentElement.dataset.theme;
  });

  it('saves and restores palette choices and swatches through local storage', () => {
    component.setAccent('mint');
    component.setUp('neon');
    component.setDown('coral');
    component.dark.set(false);
    component.paletteName.set('Mint light');
    fixture.detectChanges();
    component.saveAccent();
    component.savePalette();
    const restored = TestBed.createComponent(DsGalleryComponent);
    expect(restored.componentInstance.savedAccents()).toEqual(['#00ff9d']);
    const palette = restored.componentInstance.savedPalettes()[0];
    expect(palette.name).toBe('Mint light');
    restored.componentInstance.applyPalette(palette);
    expect(restored.componentInstance.pickerAccent()).toBe('#00ff9d');
    expect(restored.componentInstance.upHex()).toBe('#00e676');
    expect(restored.componentInstance.downHex()).toBe('#ff7a5e');
    expect(restored.componentInstance.dark()).toBe(false);
    restored.destroy();
  });

  it('replaces named palettes and exposes saved colors for comparison', () => {
    component.paletteName.set('Candidate');
    component.savePalette();
    component.setAccent('cyan');
    fixture.detectChanges();
    component.savePalette();
    expect(component.savedPalettes()).toHaveLength(1);
    component.compareName.set('Candidate');
    expect(component.comparedPalette()?.accent).toBe('#22d3ee');
    expect(Object.keys(component.comparedPalette()!.colors)).toContain('--mat-sys-error-container');
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

  it('dark toggle flips [data-theme] on the host — always explicit (dark|light)', () => {
    // #1211 — the host never sits attributeless: 'light' must be emitted
    // explicitly so the shipped [data-theme="light"] --mat-sys block and
    // the host's own --ds-* light restate engage even while the app root
    // carries data-theme="dark" (no app-state leak into the preview).
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('data-theme')).toBe('light');
    component.toggleDark();
    fixture.detectChanges();
    expect(host.getAttribute('data-theme')).toBe('dark');
    component.toggleDark();
    fixture.detectChanges();
    expect(host.getAttribute('data-theme')).toBe('light');
  });

  it('locks the selected palette and restores the lock after refresh', () => {
    component.setAccent('mint');
    component.setUp('neon');
    component.setDown('coral');
    component.dark.set(true);
    fixture.detectChanges();
    component.lockPalette();
    const lock = component.lockedPalette()!;
    expect(lock.accent).toBe('#00ff9d');
    expect(lock.up).toBe('#00e676');
    expect(lock.down).toBe('#ff7a5e');
    expect(lock.dark).toBe(true);

    const restored = TestBed.createComponent(DsGalleryComponent);
    expect(restored.componentInstance.lockedPalette()).toEqual(lock);
    restored.destroy();
  });

  it('clears the palette lock', () => {
    component.lockPalette();
    expect(component.lockedPalette()).not.toBeNull();
    component.clearPaletteLock();
    expect(component.lockedPalette()).toBeNull();
    const restored = TestBed.createComponent(DsGalleryComponent);
    expect(restored.componentInstance.lockedPalette()).toBeNull();
    restored.destroy();
  });

  it('flags green-family accents adjacent to --ds-up (direction-badge check)', () => {
    // Mint accent vs Neon up — both green-family, Δhue well under the band.
    component.setAccent('mint');
    component.setUp('neon');
    fixture.detectChanges();
    const adj = component.upAdjacency();
    expect(adj.warn).toBe(true);
    expect(adj.delta).toBeLessThan(50);

    // Magenta is on the opposite side of the wheel — clear.
    component.setAccent('magenta');
    fixture.detectChanges();
    expect(component.upAdjacency().warn).toBe(false);
  });

  it('computes circular hue distances', () => {
    expect(DsGalleryComponent.hueOf('#00ff9d')).toBeCloseTo(157, 0);
    expect(DsGalleryComponent.hueDistance('#ff0000', '#00ff00')).toBeCloseTo(120, 0);
    // Wrap-around: 350° vs 10° is 20° apart, not 340°.
    expect(DsGalleryComponent.hueDistance('#ff0040', '#ff4000')).toBeLessThan(60);
  });

  it('app-accent preview pushes --ds-accent onto <html> and cleans up', () => {
    const el = document.documentElement;
    el.dataset.theme = 'dark';
    component.setAccent('cyan');
    fixture.detectChanges();
    component.toggleAppAccentPreview();
    expect(component.appAccentPreview()).toBe(true);
    expect(el.style.getPropertyValue('--ds-accent')).toBe('#22d3ee');
    expect(el.style.getPropertyValue('--mat-sys-primary')).toBe('#22d3ee');
    // data-theme is read, never written — only color custom properties.
    expect(el.dataset.theme).toBe('dark');

    component.toggleAppAccentPreview();
    expect(component.appAccentPreview()).toBe(false);
    expect(el.style.getPropertyValue('--ds-accent')).toBe('');
    expect(el.style.getPropertyValue('--mat-sys-primary')).toBe('');
    delete el.dataset.theme;
  });

  it('app-accent preview self-clears on destroy', () => {
    const el = document.documentElement;
    el.dataset.theme = 'dark';
    component.setAccent('mint');
    component.toggleAppAccentPreview();
    expect(el.style.getPropertyValue('--ds-accent')).toBe('#00ff9d');
    fixture.destroy();
    expect(el.style.getPropertyValue('--ds-accent')).toBe('');
  });

  it('app-accent preview follows accent changes while on', () => {
    const el = document.documentElement;
    el.dataset.theme = 'dark';
    component.setAccent('cyan');
    component.toggleAppAccentPreview();
    expect(el.style.getPropertyValue('--ds-accent')).toBe('#22d3ee');
    component.setAccent('mint');
    fixture.detectChanges();
    expect(el.style.getPropertyValue('--ds-accent')).toBe('#00ff9d');
    component.toggleAppAccentPreview();
  });
});
