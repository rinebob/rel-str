import { Component, OnInit, computed, inject, isDevMode } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DecisionBoardStore } from './decision-board.store';
import { DecisionBoardItem, PositionDoc } from './decision-board.service';
import { TruncPipe } from './truncate.pipe';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Collection, Subcollection } from '../../core/common/constants';

@Component({
  selector: 'app-decision-board-view',
  standalone: true,
  imports: [CommonModule, TruncPipe],
  templateUrl: './decision-board.view.html',
  styleUrls: ['./decision-board.view.scss'],
})
export class DecisionBoardViewComponent implements OnInit {
  readonly store = inject(DecisionBoardStore);
  private readonly fs = inject(Firestore);

  // Sort items within each section alphabetically by pair for display
  readonly daysSorted = computed(() =>
    this.store.daysDesc().map((d) => ({
      day: d.day,
      items: {
        newOpens: [...d.items.newOpens].sort((a, b) => a.pair.localeCompare(b.pair)),
        holds: [...d.items.holds].sort((a, b) => a.pair.localeCompare(b.pair)),
        newCloses: [...d.items.newCloses].sort((a, b) => a.pair.localeCompare(b.pair)),
      },
    }))
  );

  ngOnInit(): void {
    // Default to last 7 days WITH signals (expands range until 7 non-empty days)
    this.store.loadLastNWithSignals(7);
    if (isDevMode()) {
      // Dev-only seeding of refresh status doc
      void (async () => {
        try {
          const ref = doc(this.fs, Collection.APP, Subcollection.REFRESH_STATUS);
          await setDoc(ref as any, { runStatus: 'processing' }, { merge: true } as any);
          await setDoc(ref as any, {
            runStatus: 'completed',
            endTimeUTC: new Date(),
            nextRefreshAtUTC: new Date(Date.now() + 60 * 60 * 1000)
          }, { merge: true } as any);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[DecisionBoard] dev seeding failed', e);
        }
      })();
    }
  }

  onPresetToday(): void {
    // Today only (latest day)
    this.store.loadLastNDays(1);
  }

  onPreset7d(): void {
    // Most recent 7 days with signals
    this.store.loadLastNWithSignals(7);
  }

  onLoadMore(): void {
    this.store.appendMore(7);
  }

  // Debug: logs chip data during template render. Returns empty string for binding.
  logChip(
    kind: 'close' | 'hold' | 'open',
    day: string,
    item: DecisionBoardItem,
    pos?: PositionDoc,
    rs?: number,
    price?: number,
    delta?: number,
    pct?: number
  ): string {
    // eslint-disable-next-line no-console
    console.debug('[DecisionBoard][chip]', { kind, day, item, pos, rs, price, delta, pct });
    return '';
  }

  trackByDay = (_: number, d: { day: string }) => d.day;
  trackByItem = (_: number, it: { positionId: string }) => it.positionId;
}
