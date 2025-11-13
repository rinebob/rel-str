import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, EnvironmentInjector, runInInjectionContext, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RefreshStatusStore } from './refresh-status.store';

@Component({
  selector: 'rs-refresh-time',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './refresh-time.component.html',
  styleUrl: './refresh-time.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshTimeComponent implements OnInit, OnDestroy {
  private readonly refresh = inject(RefreshStatusStore);
  private readonly envInj = inject(EnvironmentInjector);

  vm = this.refresh.vm;

  ngOnInit(): void {
    console.debug('[RefreshTimeComponent] ngOnInit');
    runInInjectionContext(this.envInj, () => {
      this.refresh.start();
    });
  }

  ngOnDestroy(): void {
    this.refresh.stop();
  }
}
