import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { PositionDoc } from '../../../core/models/position.types';
import { TruncPipe } from '../../decision-board/truncate.pipe';

@Component({
  selector: 'app-pv-open-card',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, TruncPipe],
  templateUrl: './open-card.component.html',
  styleUrls: ['./open-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvOpenCardComponent {
  position = input<PositionDoc>();
  mode = input<'open' | 'closed'>('open');
}
