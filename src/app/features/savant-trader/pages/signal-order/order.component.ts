/**
 * Savant Trader Signal Order Component
 *
 * Master-detail layout for the signal order screen.
 * Left panel: OrderQueueComponent (staged intents grouped by status).
 * Right panel: ticket placeholder (FE-C1b will replace with OrderTicketComponent).
 *
 * URL: /signal-order
 */
import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { OrderStagingStore } from '../../stores/order-staging.store';
import { OrderQueueComponent } from '../../components/order-queue/order-queue.component';
import { OrderTicketComponent } from '../../components/order-ticket/order-ticket.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { OrderIntent } from '../../services/order-intent.types';

@Component({
  selector: 'app-signal-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, OrderQueueComponent, OrderTicketComponent],
  templateUrl: './order.component.html',
  styleUrl: './order.component.scss',
})
export class OrderComponent implements OnInit {
  readonly stagingStore = inject(OrderStagingStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  /** Currently selected intent id. */
  readonly selectedIntentId = signal<string | null>(null);

  /** All intents from the store. */
  readonly allIntents = computed(() => Object.values(this.stagingStore.intents()));

  /** The currently selected intent object. */
  readonly selectedIntent = computed<OrderIntent | null>(() => {
    const id = this.selectedIntentId();
    if (!id) return null;
    return this.stagingStore.intents()[id] ?? null;
  });

  /** Total intent count for header. */
  readonly intentCount = computed(() => this.allIntents().length);

  /** Loading state from store. */
  readonly loading = computed(() => this.stagingStore.loading());

  /** Error state from store. */
  readonly error = computed(() => this.stagingStore.error());

  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.stagingStore.loadIntents();
  }

  /** Handle row selection from the queue. */
  onIntentSelected(id: string): void {
    this.selectedIntentId.set(id);
  }

  /** Handle batch remove from the queue. */
  onRemoveIntents(ids: string[]): void {
    for (const id of ids) {
      this.stagingStore.removeIntent(id);
    }
    // Clear selection if the selected intent was removed
    if (this.selectedIntentId() && ids.includes(this.selectedIntentId()!)) {
      this.selectedIntentId.set(null);
    }
  }

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }
}
