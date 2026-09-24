import { signal } from '@angular/core';

/**
 * Config for {@link DelegatedCellHover} — the grid supplies the pieces
 * that vary (cell-id attribute, icon selector, payload lookup, and what
 * "icon enter/leave" means); the class owns the mechanical parts that
 * are identical across the pct-change and chain grids: delegated
 * mouseover/mouseout, intra-cell suppression, and the single-icon
 * invariant.
 */
export interface DelegatedCellHoverConfig<TCell> {
  /** data- attribute on each cell element holding its id
   *  ('data-cid' on the chain grid, 'data-cell-key' on pct-change). */
  cellIdAttr: string;
  /** CSS selector for the icon button ('.popup-icon-btn', '.chart-icon-btn'). */
  iconSelector: string;
  /** Resolve a cell id to its payload — null ignores the event. */
  cellFor: (id: string) => TCell | null;
  /** Pointer entered the icon → open/preview the overlay anchored to the
   *  cell element (the icon is transient; the cell survives teardown). */
  onIconEnter: (cell: TCell, cellEl: HTMLElement) => void;
  /** Pointer left the icon for a non-icon element → close/schedule close. */
  onIconLeave: (to: HTMLElement | null) => void;
}

/**
 * Delegated pointer-hover controller shared by the option grids. Both
 * grids show one icon at a time in the hovered cell and open an overlay
 * when the pointer reaches that icon; the pointer plumbing was copy-pasted
 * between them and had already drifted (the chain grid forgot pct-change's
 * icon-clear-on-rebuild). The two components now keep only their
 * open/close payloads; this class owns the shared mechanics.
 */
export class DelegatedCellHover<TCell> {
  /** Id of the cell currently showing the icon — at most one icon exists
   *  in a grid at a time. */
  readonly iconCellId = signal<string | null>(null);

  constructor(private readonly cfg: DelegatedCellHoverConfig<TCell>) {}

  /** Delegated mouseover — bind on the scroll container. Icon hover opens
   *  the overlay via onIconEnter; a real cell entry reveals the icon.
   *  Intra-cell moves (mark → chg span) are suppressed so a single cell
   *  visit is one logical enter. */
  over(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>(`[${this.cfg.cellIdAttr}]`);
    const id = el?.getAttribute(this.cfg.cellIdAttr);
    if (!el || !id) return;

    // The icon lives inside its cell — check before the intra-cell guard.
    if (target?.closest(this.cfg.iconSelector)) {
      const cell = this.cfg.cellFor(id);
      if (cell) this.cfg.onIconEnter(cell, el);
      return;
    }

    const from = event.relatedTarget as HTMLElement | null;
    if (from && el.contains(from)) return;
    if (this.iconCellId() !== id) this.iconCellId.set(id);
  }

  /** Delegated mouseout — bind on the scroll container. Leaving the icon
   *  for a non-icon element fires onIconLeave (icon → own cell body counts
   *  as a leave); leaving a cell entirely clears its icon — the
   *  destination cell's over() re-arms it. */
  out(event: MouseEvent): void {
    const from = event.target as HTMLElement | null;
    const to = event.relatedTarget as HTMLElement | null;

    if (from?.closest(this.cfg.iconSelector) && !to?.closest(this.cfg.iconSelector)) {
      this.cfg.onIconLeave(to);
    }

    const el = from?.closest<HTMLElement>(`[${this.cfg.cellIdAttr}]`);
    if (!el) return;
    if (to && el.contains(to)) return;
    const id = el.getAttribute(this.cfg.cellIdAttr);
    if (this.iconCellId() === id && to?.closest(`[${this.cfg.cellIdAttr}]`) !== el) {
      this.iconCellId.set(null);
    }
  }

  /** Delegated click — bind on the scroll container. Clicking a cell
   *  reveals its icon without pointer hover (touch/keyboard); clicking
   *  the icon opens the overlay directly (touch: tap icon → popup). */
  click(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>(`[${this.cfg.cellIdAttr}]`);
    const id = el?.getAttribute(this.cfg.cellIdAttr);
    if (!el || !id) return;
    if (target?.closest(this.cfg.iconSelector)) {
      const cell = this.cfg.cellFor(id);
      if (cell) this.cfg.onIconEnter(cell, el);
      return;
    }
    this.iconCellId.set(id);
  }

  /** Delegated focusin — the icon is a <button>, so once it's armed a
   *  keyboard user can Tab to it; focus opens the overlay like hover. */
  focusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(this.cfg.iconSelector)) return;
    const el = target.closest<HTMLElement>(`[${this.cfg.cellIdAttr}]`);
    const id = el?.getAttribute(this.cfg.cellIdAttr);
    if (!el || !id) return;
    const cell = this.cfg.cellFor(id);
    if (cell) this.cfg.onIconEnter(cell, el);
  }

  /** Delegated focusout — moving focus off the icon closes the overlay
   *  unless focus lands on another icon. */
  focusOut(event: FocusEvent): void {
    const from = event.target as HTMLElement | null;
    const to = event.relatedTarget as HTMLElement | null;
    if (from?.closest(this.cfg.iconSelector) && !to?.closest(this.cfg.iconSelector)) {
      this.cfg.onIconLeave(to);
    }
  }

  /** Reveal a cell's icon without pointer entry (click/touch). */
  revealIcon(id: string): void {
    this.iconCellId.set(id);
  }

  /** The model rebuilt — the rendered cell (and icon element) is gone. */
  reset(): void {
    this.iconCellId.set(null);
  }
}
