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
    expect(cards.length).toBe(component.entries.length);
    expect(cards.length).toBeGreaterThanOrEqual(12);
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
