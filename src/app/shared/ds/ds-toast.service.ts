/**
 * ds-toast — de-materified replacement for DsToastService (#1163 phase B/G).
 *
 * `open(message, action?, { duration })` renders a `.dse-toast` bar
 * bottom-center over a transparent overlay; the action button and the
 * duration both dismiss. One toast at a time — a new `open` replaces any
 * toast currently showing.
 */
import { ComponentRef, inject, Injectable } from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';
import { DsToastComponent } from './ds-toast.component';

/** Handle returned by {@link DsToastService.open}. */
export class DsToastRef {
  private readonly action$ = new Subject<void>();
  /** Emits once when the action button is pressed. */
  onAction() { return this.action$.asObservable(); }
  /** @internal — fired by the toast component's action button. */
  triggerAction() { this.action$.next(); this.action$.complete(); }
}

@Injectable({ providedIn: 'root' })
export class DsToastService {
  private readonly overlay = inject(Overlay);
  private overlayRef: OverlayRef | null = null;
  private componentRef: ComponentRef<DsToastComponent> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Show `message` bottom-center; `action` renders the action slot label. */
  open(message: string, action?: string, config?: { duration?: number }): DsToastRef {
    this.dismiss();
    const ref = new DsToastRef();

    this.overlayRef = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .global()
        .bottom('24px')
        .centerHorizontally(),
      scrollStrategy: this.overlay.scrollStrategies.noop(),
    });
    this.componentRef = this.overlayRef.attach(
      new ComponentPortal(DsToastComponent),
    );
    this.componentRef.setInput('message', message);
    this.componentRef.setInput('action', action ?? null);
    this.componentRef.instance.actionClick.subscribe(() => {
      ref.triggerAction();
      this.dismiss();
    });

    const duration = config?.duration ?? 4000;
    if (duration > 0) {
      this.timer = setTimeout(() => this.dismiss(), duration);
    }
    return ref;
  }

  /** Remove the current toast, if any. */
  dismiss(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.componentRef = null;
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }
}
