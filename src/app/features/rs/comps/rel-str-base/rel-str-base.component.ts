import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'rs-rel-str-base',
  standalone: true,
  imports: [],
  template: `
    <p>
      rel-str-base works!
    </p>
  `,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RelStrBaseComponent {
}
