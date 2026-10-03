import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { CoreComponent } from './core.component';
import { HeaderComponent } from './comps/header/header.component';
import { SidenavMenuComponent } from './comps/sidenav-menu/sidenav-menu.component';
import { AuthStore } from './auth/auth.store';
import { UiStateService } from './services/ui-state.service';

describe('CoreComponent', () => {
  let component: CoreComponent;
  let fixture: ComponentFixture<CoreComponent>;
  let ui: UiStateService;

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CoreComponent],
      providers: [
        { provide: Router, useValue: { navigate: jest.fn().mockResolvedValue(true) } },
        {
          provide: AuthStore,
          useValue: { user: signal(null), isAuthenticated: signal(false), loading: signal(false), signOut: jest.fn() },
        },
      ],
    }).compileComponents();

    ui = TestBed.inject(UiStateService);
    ui.setFullscreen(false);

    fixture = TestBed.createComponent(CoreComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the header and no reveal chevron by default', () => {
    expect(el().querySelector('rs-header')).not.toBeNull();
    expect(el().querySelector('.header-reveal')).toBeNull();
  });

  it('hides the header and shows a floating reveal chevron when fullscreen', () => {
    ui.setFullscreen(true);
    fixture.detectChanges();

    expect(el().querySelector('rs-header')).toBeNull();
    const reveal = el().querySelector<HTMLButtonElement>('.header-reveal');
    expect(reveal).not.toBeNull();
    expect(reveal!.querySelector('mat-icon')?.textContent?.trim()).toBe('fullscreen_exit');
  });

  it('clicking the reveal chevron exits fullscreen and restores the header', () => {
    ui.setFullscreen(true);
    fixture.detectChanges();

    el().querySelector<HTMLButtonElement>('.header-reveal')!.click();
    fixture.detectChanges();

    expect(ui.fullscreen()).toBe(false);
    expect(el().querySelector('rs-header')).not.toBeNull();
    expect(el().querySelector('.header-reveal')).toBeNull();
  });

  it('binds --header-height to the app header height, or 0px in fullscreen', () => {
    const content = () => el().querySelector<HTMLElement>('mat-drawer-content')!;

    expect(content().style.getPropertyValue('--header-height')).toBe('var(--app-header-height)');

    ui.setFullscreen(true);
    fixture.detectChanges();
    expect(content().style.getPropertyValue('--header-height')).toBe('0px');
  });

  it('header openSidenav output opens the sidenav drawer', () => {
    const header = fixture.debugElement.query(By.directive(HeaderComponent)).componentInstance as HeaderComponent;
    const spy = jest.spyOn(component.sidenav, 'open');

    header.openSidenav.emit();
    expect(spy).toHaveBeenCalled();
  });

  it('sidenav navigate output routes to item.href and closes the drawer (#740)', () => {
    const menu = fixture.debugElement.query(By.directive(SidenavMenuComponent)).componentInstance as SidenavMenuComponent;
    const router = TestBed.inject(Router);
    const closeSpy = jest.spyOn(component.sidenav, 'close');

    menu.navigate.emit({ name: 'x', text: 'X', href: 'trading/live' });

    expect(router.navigate).toHaveBeenCalledWith(['trading/live']);
    expect(closeSpy).toHaveBeenCalled();
  });
});
