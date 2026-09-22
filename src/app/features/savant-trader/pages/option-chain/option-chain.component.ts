/**
 * Option Chain Page
 *
 * Single-session option chain browser. Renders a full chain in
 * strikes x expirations matrix form — the pct-change grid's visual
 * layout — showing mark price, change vs the prior session, delta,
 * and IV per contract, with the full payload on hover.
 *
 * Skeleton shell (task #497): route + page + nav entry only. The
 * store, grid, and controls land in later tasks.
 */
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-option-chain',
  standalone: true,
  imports: [],
  templateUrl: './option-chain.component.html',
  styleUrl: './option-chain.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChainComponent {}
