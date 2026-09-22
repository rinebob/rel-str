/**
 * Symbol List Actions
 *
 * Primary / secondary / neutral / avoid / hide / monitor toggle buttons
 * for a single symbol.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SymbolListName } from '../../common/constants';

@Component({
  selector: 'app-symbol-list-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './symbol-list-actions.component.html',
  styleUrl: './symbol-list-actions.component.scss',
})
export class SymbolListActionsComponent {
  symbol = input.required<string>();
  /** Map of list name -> symbols in that list. */
  symbolLists = input.required<Record<string, string[]>>();
  readonly ListName = SymbolListName;

  toggleList = output<{ symbol: string; listName: SymbolListName }>();
  monitor = output<string>();

  isInList(listName: string): boolean {
    return (this.symbolLists()[listName] ?? []).includes(this.symbol().toUpperCase());
  }
}
