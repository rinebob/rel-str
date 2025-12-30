import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Firestore, collection, deleteDoc, doc, getDoc, getDocs } from '@angular/fire/firestore';
import { Storage, getDownloadURL, ref } from '@angular/fire/storage';
import { NewTradeDialogResult } from './new-trade.dialog';
import { environment } from '../../../environments/environment';
import { Collection, Subcollection, TradeDirection, TradeStatus } from '../../core/common/constants';
import { AuthService } from '../../core/auth/auth.service';
import { TradeJournalListItem, TradeUpsertDto } from './trade-journal.types';

function getTradeManagerUrl(): string {
  if (environment.useEmulators) {
    return 'http://127.0.0.1:5002/rel-str/us-central1/tradeJournalManager';
  }

  return 'https://us-central1-rel-str.cloudfunctions.net/tradeJournalManager';
}

@Injectable({ providedIn: 'root' })
export class TradeJournalService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);

  private async loadSymbolPrices(symbols: string[]): Promise<Record<string, { price: number | null }>> {
    const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase())));
    const result: Record<string, { price: number | null }> = {};

    await Promise.all(
      unique.map(async (symbol) => {
        const ref = doc(this.firestore, `${Collection.SYMBOL_DATA}/${symbol}`);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          result[symbol] = { price: null };
          return;
        }

        const data = snap.data() as { currentPrice?: { price?: number } };
        const price = typeof data.currentPrice?.price === 'number' ? data.currentPrice.price : null;
        result[symbol] = { price };
      }),
    );

    return result;
  }

  async loadTrades(): Promise<TradeJournalListItem[]> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      return [];
    }

    const tradesCol = collection(
      this.firestore,
      `${Collection.USERS}/${user.uid}/${Subcollection.TRADES}`,
    );
    let snap;
    try {
      snap = await getDocs(tradesCol);
      // eslint-disable-next-line no-console
      console.log('[TradeJournalService] loadTrades: snap size', snap.size);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[TradeJournalService] loadTrades: getDocs error', err);
      throw err;
    }

    const items: TradeJournalListItem[] = await Promise.all(
      snap.docs.map(async (docSnap) => {
        const data = docSnap.data() as any;
        const entry = data.entry || {};
        const exit = data.exit || {};

        const rawDirection = String(data.direction || '').toUpperCase();
        const direction = rawDirection === TradeDirection.SHORT ? TradeDirection.SHORT : TradeDirection.LONG;

        const rawStatus = String(data.status || '').toUpperCase();
        const status =
          rawStatus === TradeStatus.CLOSED
            ? TradeStatus.CLOSED
            : rawStatus === TradeStatus.CANCELED
            ? TradeStatus.CANCELED
            : rawStatus === TradeStatus.QUEUED
            ? TradeStatus.QUEUED
            : rawStatus === TradeStatus.SETUP
            ? TradeStatus.SETUP
            : TradeStatus.OPEN;

        const datePart: string = entry.date || '';
        const timePart: string = entry.time || '';
        const entryDateTime = `${datePart} ${timePart}`.trim();

        const price = typeof entry.price === 'number' ? entry.price : null;

        const exitPrice = typeof exit.price === 'number' ? exit.price : null;

        let screenshotUrl: string | null = null;
        const screenshotPaths: string[] | undefined = data.screenshotPaths;
        const firstPath = screenshotPaths && screenshotPaths[0];
        if (firstPath) {
          try {
            const storageRef = ref(this.storage, firstPath);
            screenshotUrl = await getDownloadURL(storageRef);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[TradeJournalService] loadTrades: getDownloadURL failed', err);
          }
        }

        const item: TradeJournalListItem = {
          id: data.tradeId || docSnap.id,
          symbol: String(data.symbol || '').trim().toUpperCase(),
          direction,
          status,
          entryDate: entryDateTime || datePart,
          entryPrice: price,
          exitDate: exit.date || null,
          exitPrice,
          screenshotUrl,
          brokerCsvPaths: (data.brokerCsvPaths as string[] | undefined) ?? null,
          indicatorCsvPaths: (data.indicatorCsvPaths as string[] | undefined) ?? null,
          screenshotPaths: screenshotPaths ?? null,
        } satisfies TradeJournalListItem;

        return item;
      }),
    );
    const pricesBySymbol = await this.loadSymbolPrices(items.map((t) => t.symbol));

    const enriched = items.map((t) => {
      const symbolKey = t.symbol.trim().toUpperCase();
      const currentPrice = pricesBySymbol[symbolKey]?.price ?? null;

      // Use exitPrice once trade is closed; otherwise use current live price.
      const effectivePrice =
        t.status === TradeStatus.CLOSED && t.exitPrice != null ? t.exitPrice : currentPrice;

      let pnlPct: number | null = t.pnlPct ?? null;

      if (pnlPct == null && t.entryPrice != null && effectivePrice != null) {
        const diff = effectivePrice - t.entryPrice;
        const raw = (diff / t.entryPrice) * 100;
        // For SHORT trades, invert the sign so falling price is positive PnL
        pnlPct = t.direction === TradeDirection.SHORT ? -raw : raw;
      }

      return { ...t, currentPrice, pnlPct } satisfies TradeJournalListItem;
    });

    return enriched;
  }

  async loadPrimaryScreenshotUrl(tradeId: string): Promise<string | null> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      return null;
    }

    const tradeDocRef = doc(
      this.firestore,
      `${Collection.USERS}/${user.uid}/${Subcollection.TRADES}/${tradeId}`,
    );
    const snap = await getDoc(tradeDocRef);
    if (!snap.exists()) {
      return null;
    }

    const data = snap.data() as { screenshotPaths?: string[] };
    const firstPath = data.screenshotPaths && data.screenshotPaths[0];
    if (!firstPath) {
      return null;
    }

    const storageRef = ref(this.storage, firstPath);
    const url = await getDownloadURL(storageRef);
    return url;
  }

  async deleteTrade(tradeId: string): Promise<void> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      throw new Error('[TradeJournalService] deleteTrade called without authenticated user');
    }

    const tradeDocRef = doc(
      this.firestore,
      `${Collection.USERS}/${user.uid}/${Subcollection.TRADES}/${tradeId}`,
    );

    await deleteDoc(tradeDocRef);
  }

  /**
   * JSON-based create endpoint using client-side Storage uploads and TradeUpsertDto.
   * Returns the tradeId from the backend; callers are expected to reload trades
   * from Firestore via loadTrades for fresh state.
   */
  async createTrade(dto: TradeUpsertDto): Promise<string> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      throw new Error('[TradeJournalService] createTrade called without authenticated user');
    }

    const token = await this.authService.getIdToken(user);
    const url = getTradeManagerUrl();

    const response = await firstValueFrom(
      this.http.post<{ tradeId: string }>(url, dto, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    return response.tradeId;
  }

  /**
   * JSON-based edit endpoint using client-side Storage uploads and TradeUpsertDto.
   * Returns the tradeId from the backend; callers are expected to reload trades
   * from Firestore via loadTrades for fresh state.
   */
  async editTrade(dto: TradeUpsertDto): Promise<string> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      throw new Error('[TradeJournalService] editTrade called without authenticated user');
    }

    const token = await this.authService.getIdToken(user);
    const url = getTradeManagerUrl();

    const response = await firstValueFrom(
      this.http.post<{ tradeId: string }>(url, dto, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }),
    );

    return response.tradeId;
  }
}
