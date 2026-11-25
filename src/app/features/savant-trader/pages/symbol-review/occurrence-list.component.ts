/**
 * Occurrence list — the dumb-view half of the symbol-review detail pane
 * (#553/#1117, task #1654). One row per signal occurrence: a checkbox
 * whose state IS ledger membership (checked = a signal-scoped PaperTrade
 * claims the occurrence), the bar date, signal type, direction, and an
 * INTERIM/CONFIRMED chip. Toggles are confirmed server-side — the box
 * disables while the row's mint/delete is in flight and the per-row
 * error line carries mint `error` / delete `failed` reasons (e.g. cohort
 * refusals) so a refusal reads as an answer, not a bug.
 *
 * The "new since last visit" divider renders at the store-computed
 * `dividerIndex` — the count of rows whose barDate postdates the prior
 * pane-open stamp. All-new (`index === length`) and all-old (`0`) lists
 * render no divider: there is nothing to separate.
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

import type { SignalReviewOccurrence } from '@paper-trading/contracts';

@Component({
  selector: 'app-occurrence-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './occurrence-list.component.html',
  styleUrl: './occurrence-list.component.scss',
})
export class OccurrenceListComponent {
  /** Newest-first occurrence rows from the loaded bundle. */
  readonly occurrences = input.required<SignalReviewOccurrence[]>();
  /** Count of "new" rows — the divider sits before this index. */
  readonly dividerIndex = input.required<number>();
  /** Per-row in-flight toggles, keyed by occurrenceId. */
  readonly togglePending = input<Record<string, true>>({});
  /** Per-row failure messages, keyed by occurrenceId. */
  readonly rowErrors = input<Record<string, string>>({});
  /** Emits the tapped row — the page forwards its id to the store. */
  readonly toggle = output<SignalReviewOccurrence>();

  /** Confirmed toggles own the checkbox: a native click flips the DOM
   *  immediately, but the store only patches `checked` on the server's
   *  answer — and `[checked]` never rewrites the DOM when the bound
   *  value is unchanged. Snapping the element back to model state on
   *  every tap means a refused delete never renders unchecked and a
   *  failed mint never renders checked. */
  protected onBoxChange(occ: SignalReviewOccurrence, event: Event): void {
    (event.target as HTMLInputElement).checked = occ.checked;
    this.toggle.emit(occ);
  }

  protected isPending(occ: SignalReviewOccurrence): boolean {
    return this.togglePending()[occ.occurrenceId] === true;
  }

  protected rowError(occ: SignalReviewOccurrence): string | undefined {
    return this.rowErrors()[occ.occurrenceId];
  }
}
