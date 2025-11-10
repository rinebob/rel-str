import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RefreshStatusStore } from './refresh-status.store';

@Component({
  selector: 'rs-refresh-time',
  standalone: true,
  imports: [CommonModule],
  providers: [RefreshStatusStore],
  templateUrl: './refresh-time.component.html',
  styleUrl: './refresh-time.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshTimeComponent implements OnInit, OnDestroy {
  private readonly refresh = inject(RefreshStatusStore);

  vm = this.refresh.vm;

  ngOnInit(): void {
    const isMock = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mockRefresh') === '1';
    if (isMock) {
      this.refresh.startMock();
    } else {
      this.refresh.start();
    }
  }

  ngOnDestroy(): void {
    this.refresh.stop();
  }
}
