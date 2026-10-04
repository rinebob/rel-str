// PROTOTYPE — throwaway "Today" surface. Three radically different variants
// of the same daily-session concept, switchable via ?variant=A|B|C.
// NOT production code — the winner gets rewritten properly; the losers die.
import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { MOCK_TODAY } from './prototype-today.data';
import { VariantMorningDeskComponent } from './variant-morning-desk.component';
import { VariantMissionControlComponent } from './variant-mission-control.component';
import { VariantGuidedFlowComponent } from './variant-guided-flow.component';

const VARIANTS = ['A', 'B', 'C'] as const;
const NAMES: Record<string, string> = {
  A: 'Morning desk — checklist rail',
  B: 'Mission control — status tiles',
  C: 'Guided flow — stepper',
};

@Component({
  selector: 'rs-prototype-today',
  imports: [VariantMorningDeskComponent, VariantMissionControlComponent, VariantGuidedFlowComponent],
  template: `
    <div class="proto-banner">PROTOTYPE — Today surface variants (mock data, read-only)</div>
    @if (variant() === 'A') { <rs-proto-variant-morning-desk [data]="data" /> }
    @if (variant() === 'B') { <rs-proto-variant-mission-control [data]="data" /> }
    @if (variant() === 'C') { <rs-proto-variant-guided-flow [data]="data" /> }

    <div class="switcher">
      <button (click)="cycle(-1)">←</button>
      <span>{{ variant() }} — {{ names[variant()] }}</span>
      <button (click)="cycle(1)">→</button>
    </div>
  `,
  styles: [`
    .proto-banner { background: #4a3400; color: #ffcc80; padding: 6px 12px; font-size: 12px; text-align: center; }
    .switcher { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 14px; background: #111; color: #eee;
      border: 1px solid #444; border-radius: 999px; padding: 8px 16px;
      box-shadow: 0 4px 16px #000a; z-index: 1000; }
    .switcher button { background: #333; color: #eee; border: none; border-radius: 999px;
      width: 32px; height: 32px; cursor: pointer; font-size: 15px; }
    .switcher span { font-size: 13px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrototypeTodayComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly data = MOCK_TODAY;
  readonly names = NAMES;
  private keys = [...VARIANTS];

  private param = toSignal(
    this.route.queryParamMap.pipe(map(m => (m.get('variant') ?? 'A').toUpperCase())),
    { initialValue: 'A' },
  );
  variant = computed(() => (this.keys as string[]).includes(this.param()) ? this.param() : 'A');

  cycle(dir: number) {
    const i = this.keys.indexOf(this.variant() as (typeof VARIANTS)[number]);
    const next = this.keys[(i + dir + this.keys.length) % this.keys.length];
    this.router.navigate([], { queryParams: { variant: next }, queryParamsHandling: 'merge' });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') this.cycle(-1);
    if (e.key === 'ArrowRight') this.cycle(1);
  }
}
