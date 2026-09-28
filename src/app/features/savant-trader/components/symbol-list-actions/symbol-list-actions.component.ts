/**
 * Symbol List Actions
 *
 * Icon toggle buttons for the fixed built-in system lists (triage buckets +
 * Monitor) for a single symbol. User-created lists are managed through
 * the list dropdowns and management UI, not chips.
 */
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  SYSTEM_LIST_KEYS,
  USER_LIST_ORDER_START,
  type SymbolListDef,
} from '../../common/symbol-list-defs';

/** Mat-icon ligature per system list key. */
const SYSTEM_LIST_ICONS: Record<string, string> = {
  [SYSTEM_LIST_KEYS.NEW]: 'fiber_new',
  [SYSTEM_LIST_KEYS.PRIMARY]: 'star',
  [SYSTEM_LIST_KEYS.SECONDARY]: 'visibility',
  [SYSTEM_LIST_KEYS.NEUTRAL]: 'remove_circle_outline',
  [SYSTEM_LIST_KEYS.AVOID]: 'trending_down',
  [SYSTEM_LIST_KEYS.HIDE]: 'block',
  [SYSTEM_LIST_KEYS.MONITOR]: 'history',
};

@Component({
  selector: 'app-symbol-list-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './symbol-list-actions.component.html',
  styleUrl: './symbol-list-actions.component.scss',
})
export class SymbolListActionsComponent {
  symbol = input.required<string>();
  listCatalog = input.required<SymbolListDef[]>();

  readonly systemActionLists = computed(() =>
    this.listCatalog().filter(
      (list) => list.order < USER_LIST_ORDER_START && !list.hidden,
    ),
  );

  toggleList = output<{ symbol: string; listKey: string }>();

  isInList(list: SymbolListDef): boolean {
    return list.symbols.includes(this.symbol().toUpperCase());
  }

  /** Icon for a list — MONITOR flips to history_off while active. */
  iconName(list: SymbolListDef): string {
    if (list.key === SYSTEM_LIST_KEYS.MONITOR && this.isInList(list)) {
      return 'history_off';
    }
    return SYSTEM_LIST_ICONS[list.key] ?? 'label';
  }
}
