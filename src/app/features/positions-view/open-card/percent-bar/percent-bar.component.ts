import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PositionDirection } from '../../../../core/models/fe-position.types';

@Component({
  selector: 'app-pv-percent-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './percent-bar.component.html',
  styleUrls: ['./percent-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvPercentBarComponent {
  direction = input.required<PositionDirection>();
  /** Raw price percent change (price-based, before direction adjustment). */
  percent = input.required<number>();

  readonly maxMagnitude = 10; // +/-10% range for the track labels

  readonly signedPercent = computed(() => {
    const raw = this.percent();
    const p = Number.isFinite(raw as number) ? (raw as number) : 0;
    return p;
  });

  readonly clampedMagnitude = computed(() => {
    const v = this.signedPercent();
    const abs = Math.abs(v);
    return abs > this.maxMagnitude ? this.maxMagnitude : abs;
  });

  readonly isPositive = computed(() => this.signedPercent() > 0);

  readonly barTransform = computed(() => {
    const mag = this.clampedMagnitude();
    const ratio = this.maxMagnitude > 0 ? mag / this.maxMagnitude : 0;
    let scale = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    if (mag > 0 && scale < 0.25) {
      scale = 0.25;
    }
    return `scaleX(${scale})`;
  });
}
