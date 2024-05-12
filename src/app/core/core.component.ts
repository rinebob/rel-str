import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'rs-core',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './core.component.html',
  styleUrl: './core.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CoreComponent {

}
