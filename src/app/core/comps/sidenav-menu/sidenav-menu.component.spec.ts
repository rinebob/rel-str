import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal, WritableSignal } from '@angular/core';
import { User } from '@angular/fire/auth';

import { SidenavMenuComponent } from './sidenav-menu.component';
import { AuthStore } from '../../auth/auth.store';
import { NAV_SECTIONS } from '../../common/constants';
import { NavItem } from '../../common/interfaces';

describe('SidenavMenuComponent', () => {
  let component: SidenavMenuComponent;
  let fixture: ComponentFixture<SidenavMenuComponent>;
  let user: WritableSignal<User | null>;

  const el = () => fixture.nativeElement as HTMLElement;
  const itemTexts = () =>
    Array.from(el().querySelectorAll('.nav-menu-item')).map((n) =>
      n.textContent?.trim(),
    );
  const labelTexts = () =>
    Array.from(el().querySelectorAll('.nav-section-label')).map((n) =>
      n.textContent?.trim(),
    );

  beforeEach(async () => {
    user = signal<User | null>(null);

    await TestBed.configureTestingModule({
      imports: [SidenavMenuComponent],
      providers: [
        {
          provide: AuthStore,
          useValue: {
            user,
            isAuthenticated: computed(() => !!user()),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidenavMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('signed in', () => {
    beforeEach(() => {
      user.set({ uid: 'u1', email: 'a@b.c' } as User);
      fixture.detectChanges();
    });

    it('renders every top-level item from NAV_SECTIONS (submenu triggers included)', () => {
      const topLevel = NAV_SECTIONS.flatMap((s) => s.items);
      const texts = itemTexts();
      expect(texts).toHaveLength(topLevel.length);
      expect(texts).toEqual(topLevel.map((i) => i.text));
    });

    it('Dev submenu trigger opens a menu listing the dev routes', async () => {
      const trigger = Array.from(
        el().querySelectorAll<HTMLButtonElement>('.nav-menu-item'),
      ).find((n) => n.textContent?.trim() === 'Dev')!;
      expect(trigger.classList.contains('nav-submenu-trigger')).toBe(true);

      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();

      const menuItems = Array.from(
        document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel .mat-mdc-menu-item'),
      ).map((n) => n.textContent?.trim());
      expect(menuItems).toEqual([
        'Flex Chart Sandbox',
        'Gallery (Dev)',
        'Screenshot (Dev)',
      ]);
    });

    it('clicking a Dev submenu item emits navigate with that child', async () => {
      const emitted: NavItem[] = [];
      component.navigate.subscribe((i) => emitted.push(i));

      const trigger = Array.from(
        el().querySelectorAll<HTMLButtonElement>('.nav-menu-item'),
      ).find((n) => n.textContent?.trim() === 'Dev')!;
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();

      document
        .querySelector<HTMLElement>('.mat-mdc-menu-panel .mat-mdc-menu-item')!
        .click();
      fixture.detectChanges();

      expect(emitted).toEqual([
        {
          name: 'flex-chart-sandbox',
          text: 'Flex Chart Sandbox',
          href: 'dev/flex-chart',
        },
      ]);
    });

    it('renders group labels in NAV_SECTIONS order, skipping the unlabeled tail', () => {
      expect(labelTexts()).toEqual(
        NAV_SECTIONS.filter((s) => s.label).map((s) => s.label),
      );
    });

    it('emits navigate with the clicked item', () => {
      const emitted: NavItem[] = [];
      component.navigate.subscribe((i) => emitted.push(i));

      const target = NAV_SECTIONS[0].items[0];
      const nodes = Array.from(
        el().querySelectorAll('button.nav-menu-item'),
      );
      nodes
        .find((n) => n.textContent?.trim() === target.text)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(emitted).toEqual([target]);
    });
  });

  describe('signed out', () => {
    it('renders only the auth items — no feature nav or section labels', () => {
      expect(itemTexts()).toEqual(['Log in', 'Sign up']);
      expect(labelTexts()).toEqual([]);
    });

    it('emits navigate for the auth items', () => {
      const emitted: NavItem[] = [];
      component.navigate.subscribe((i) => emitted.push(i));

      const nodes = el().querySelectorAll('button.nav-menu-item');
      nodes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      nodes[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(emitted).toEqual([
        { name: 'login', text: 'Log in', href: 'login' },
        { name: 'signup', text: 'Sign up', href: 'signup' },
      ]);
    });
  });

  it('swaps sections when auth state changes', () => {
    user.set({ uid: 'u1', email: 'a@b.c' } as User);
    fixture.detectChanges();
    expect(itemTexts()).toHaveLength(
      NAV_SECTIONS.flatMap((s) => s.items).length,
    );

    user.set(null);
    fixture.detectChanges();
    expect(itemTexts()).toEqual(['Log in', 'Sign up']);
    expect(labelTexts()).toEqual([]);
  });

  it('emits closeSidenav from the close button', () => {
    let emitted = false;
    component.closeSidenav.subscribe(() => (emitted = true));

    el()
      .querySelector<HTMLButtonElement>('.menu-button')!
      .click();

    expect(emitted).toBe(true);
  });
});
