/**
 * Scanner gateway — Savant Trader RH Scanner page (#1098/#1139).
 *
 * Thin seam over `RobinhoodMcpClient` + AngularFire proposal persistence.
 *
 * - `runScan` → `client.previewScan` (one preview_scan call).
 * - `evaluateTracked` → TWO `evaluateUniverse` passes per #1138's
 *   live-probed semantics: a coverage pass (scope + columns, NO filters —
 *   every scanner-covered symbol returns with its metric values) then the
 *   filtered pass (passers only). The store unions both `unevaluated`
 *   lists and hands both row sets to `comparePrune`.
 * - Latest-run cache: discovery successes also persist to
 *   `st-scanner/latest-runs/items/{recipeId}` — one doc per recipe,
 *   warn-only so a cache failure can't fail the run (#1232/#1257).
 * - Proposals persist to `st-scanner/proposals/items` (anchored pattern,
 *   #1132); wire shape via the shared `serializeCurationProposal`,
 *   reads validated by `parseCurationProposal` — drift-tolerant on both
 *   read paths (a drifted doc skips out of the list / reads as absent),
 *   since one malformed doc must not brick proposal history.
 *
 * Tool allowlist: only `preview_scan` crosses the MCP boundary —
 * enforced by construction (no other tool has a spec here; the service
 * exposes no path to any other RobinhoodMcpClient method).
 */
import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';

import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import type { ScanRunResult, UniverseEvalResult } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import type { CurationProposal, ScanLatestRun, ScanRecipe } from '@st/scanner';
import type { PreviewScanResult } from '@robinhood-mcp/contracts';
import { isScanTruncated, parseCurationProposal, serializeCurationProposal, serializeScanLatestRun } from '@st/scanner';
import { stScannerLatestRunDocPath, stScannerProposalDocPath, stScannerProposalsPath } from '@st/collections';
import { requireUserId } from './firestore-helpers';

/** A persisted proposal plus its Firestore doc id (history rows, openProposal). */
export interface StoredProposal {
  id: string;
  proposal: CurationProposal;
}

/** The two-eval prune output — coverage + matched eval results. */
export interface PruneEval {
  coverage: UniverseEvalResult;
  matched: UniverseEvalResult;
}

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private readonly client = inject(RobinhoodMcpClient);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** One unscoped preview_scan run for a recipe. */
  runScan(recipe: ScanRecipe): Promise<ScanRunResult> {
    return this.client.previewScan(recipe);
  }

  /** Same call, raw wire shape — the auto-run overview's per-recipe
   *  tables render `PreviewScanResult` directly (#1198). */
  previewScanRaw(recipe: ScanRecipe): Promise<PreviewScanResult> {
    return this.client.previewScanRaw(recipe);
  }

  /**
   * Two-eval prune: coverage pass carries `filters: []` (the ANY_OF scope
   * is appended by evaluateUniverseSpec — a coverage pass is scope +
   * columns only), then the filtered pass. `onProgress` reports combined
   * progress — `done`/`total` where total counts chunks across both evals.
   */
  async evaluateTracked(
    recipe: ScanRecipe,
    symbols: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<PruneEval> {
    const coverage = await this.client.evaluateUniverse(
      { ...recipe, filters: [] },
      symbols,
      (done, total) => onProgress?.(done, total * 2),
    );
    const matched = await this.client.evaluateUniverse(
      recipe,
      symbols,
      (done, total) => onProgress?.(total + done, total * 2),
    );
    return { coverage, matched };
  }

  // ── latest-run cache ───────────────────────────────────────────────────

  /**
   * Cache a discovery result as the recipe's latest run — one doc per
   * recipeId (deterministic id → setDoc overwrite, #1232/#1257). Wired
   * into the discovery paths only; evaluateTracked never calls it.
   *
   * Fire-and-forget by design: a cache failure warns, never fails the
   * run — the scan result the user sees is unaffected either way.
   */
  async saveLatestRun(recipeId: string, result: PreviewScanResult): Promise<void> {
    try {
      const run: ScanLatestRun = {
        recipeId,
        ranAt: new Date().toISOString(),
        totalItems: result.total_items,
        truncated: isScanTruncated(result),
        rows: result.results,
      };
      await this.authed(() =>
        setDoc(
          doc(this.firestore, stScannerLatestRunDocPath(recipeId)),
          serializeScanLatestRun(run),
        ),
      );
    } catch (e) {
      // Warn-only — the cache must never fail a scan (construction is
      // inside the try so even a malformed result can't reject a `void`
      // call). serialize passes `columns` keys through unvalidated, so a
      // recipe display name with a Firestore-illegal char lands here too.
      console.warn('[ScannerService] saveLatestRun failed — run unaffected', e);
    }
  }

  // ── proposals ──────────────────────────────────────────────────────────

  /** Persist a completed compare as a curation proposal; resolves to the doc id. */
  async saveProposal(proposal: CurationProposal): Promise<string> {
    return this.authed(async () => {
      const ref = await addDoc(
        collection(this.firestore, stScannerProposalsPath()),
        serializeCurationProposal(proposal),
      );
      return ref.id;
    });
  }

  /** Proposal history, newest first — drifted docs are skipped, not fatal. */
  async listProposals(): Promise<StoredProposal[]> {
    return this.authed(async () => {
      const snap = await getDocs(
        query(
          collection(this.firestore, stScannerProposalsPath()),
          orderBy('ranAt', 'desc'),
        ),
      );
      const out: StoredProposal[] = [];
      for (const d of snap.docs) {
        try {
          out.push({ id: d.id, proposal: parseCurationProposal(d.data()) });
        } catch {
          // drifted doc — skip rather than fail the whole history list
        }
      }
      return out;
    });
  }

  /** One proposal by doc id — null when absent or shape-drifted. */
  async getProposal(id: string): Promise<StoredProposal | null> {
    return this.authed(async () => {
      const snap = await getDoc(
        doc(this.firestore, stScannerProposalDocPath(id)),
      );
      if (!snap.exists()) return null;
      try {
        return { id: snap.id, proposal: parseCurationProposal(snap.data()) };
      } catch {
        return null; // drifted doc — treat as absent rather than throw
      }
    });
  }

  /** Auth-gated Firestore op — requireUserId (presence gate only; rules
   *  scope by request.auth != null, no uid is persisted) + injection
   *  context for the modular API calls. */
  private async authed<T>(fn: () => Promise<T>): Promise<T> {
    await firstValueFrom(requireUserId(this.auth, this.injector));
    return runInInjectionContext(this.injector, fn);
  }
}
