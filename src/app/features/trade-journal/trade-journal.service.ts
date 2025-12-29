import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Firestore, collection, doc, getDoc, getDocs } from '@angular/fire/firestore';
import { Storage, getDownloadURL, ref } from '@angular/fire/storage';
import { NewTradeDialogResult } from './new-trade.dialog';
import { environment } from '../../../environments/environment';
import { Collection, Subcollection, TradeDirection, TradeStatus } from '../../core/common/constants';
import { AuthService } from '../../core/auth/auth.service';
import { TradeImportPayload, TradeJournalListItem, TradeUpsertDto } from './trade-journal.types';
/**
 * Legacy URL builder for the Busboy-based importTrade Cloud Function.
 *
 * @deprecated Prefer getTradeManagerUrl() with JSON DTOs and client-side
 * Storage uploads.
 */
function getTradeImportUrl(): string {
  if (environment.useEmulators) {
    return 'http://127.0.0.1:5002/rel-str/us-central1/importTrade';
  }

  // Prod: call the deployed Cloud Function directly
  return 'https://us-central1-rel-str.cloudfunctions.net/importTrade';
}

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

  /**
   * Legacy multipart/form-data trade import that posts to the importTrade
   * Cloud Function.
   *
   * @deprecated Prefer createTrade with JSON DTOs and client-side Storage
   * uploads via tradeJournalManager.
   */
  async importTradeDeprecated(payload: TradeImportPayload): Promise<void> {
    const formData = new FormData();
    const url = getTradeImportUrl();

    const { trade, entryDate, entryTime, brokerCsvFiles, indicatorCsvFiles, screenshotFiles } = payload;

    formData.append('localTradeId', trade.id);
    formData.append('symbol', trade.symbol);
    formData.append('direction', trade.direction);
    formData.append('status', trade.status);
    formData.append('entryPrice', String(trade.entryPrice ?? ''));
    formData.append('entryDate', entryDate ?? '');
    formData.append('entryTime', entryTime ?? '');

    for (const file of brokerCsvFiles ?? []) {
      formData.append('brokerCsvs', file, file.name);
    }

    for (const file of indicatorCsvFiles ?? []) {
      formData.append('indicatorCsvs', file, file.name);
    }

    for (const file of screenshotFiles ?? []) {
      formData.append('screenshots', file, file.name);
    }

    // Log payload for local debugging.
    // eslint-disable-next-line no-console
    console.log('[TradeJournalService] importTrade payload', {
      localTradeId: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      status: trade.status,
      entryPrice: trade.entryPrice,
      entryDate,
      entryTime,
      brokerCsvFileNames: brokerCsvFiles.map((f) => f.name),
      indicatorCsvFileNames: indicatorCsvFiles.map((f) => f.name),
      screenshotFileNames: screenshotFiles.map((f) => f.name),
    });

    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      // eslint-disable-next-line no-console
      console.warn('[TradeJournalService] importTrade skipped: unauthenticated user');
      return;
    }

    const token = await this.authService.getIdToken(user);

    await firstValueFrom(
      this.http.post<void>(url, formData, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }

  /**
   * Legacy multipart/form-data trade edit that posts to the importTrade
   * Cloud Function.
   *
   * @deprecated Prefer editTrade with JSON DTOs and client-side Storage
   * uploads via tradeJournalManager.
   */
  async editTradeDeprecated(payload: TradeImportPayload): Promise<void> {
    const formData = new FormData();
    const url = getTradeImportUrl();

    const {
      trade,
      entryDate,
      entryTime,
      brokerCsvFiles,
      indicatorCsvFiles,
      screenshotFiles,
      deletedBrokerCsvPaths,
      deletedIndicatorCsvPaths,
      deletedScreenshotPaths,
    } = payload;

    formData.append('localTradeId', trade.id);
    formData.append('symbol', trade.symbol);
    formData.append('direction', trade.direction);
    formData.append('status', trade.status);
    formData.append('entryPrice', String(trade.entryPrice ?? ''));
    formData.append('entryDate', entryDate ?? '');
    formData.append('entryTime', entryTime ?? '');

    // Deleted paths metadata for backend cleanup
    if (deletedBrokerCsvPaths?.length) {
      formData.append('deletedBrokerCsvPaths', JSON.stringify(deletedBrokerCsvPaths));
    }
    if (deletedIndicatorCsvPaths?.length) {
      formData.append('deletedIndicatorCsvPaths', JSON.stringify(deletedIndicatorCsvPaths));
    }
    if (deletedScreenshotPaths?.length) {
      formData.append('deletedScreenshotPaths', JSON.stringify(deletedScreenshotPaths));
    }

    for (const file of brokerCsvFiles ?? []) {
      formData.append('brokerCsvs', file, file.name);
    }

    for (const file of indicatorCsvFiles ?? []) {
      formData.append('indicatorCsvs', file, file.name);
    }

    for (const file of screenshotFiles ?? []) {
      formData.append('screenshots', file, file.name);
    }

    const user = await firstValueFrom(this.authService.user$);
    if (!user) {
      // eslint-disable-next-line no-console
      console.warn('[TradeJournalService] editTrade skipped: unauthenticated user');
      return;
    }

    const token = await this.authService.getIdToken(user);

    await firstValueFrom(
      this.http.post<void>(url, formData, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
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

    const items = await Promise.all(
      snap.docs.map(async (docSnap) => {
        const data = docSnap.data() as any;
        const entry = data.entry || {};

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

        return {
          id: data.tradeId || docSnap.id,
          symbol: String(data.symbol || '').trim().toUpperCase(),
          direction,
          status,
          entryDate: entryDateTime || datePart,
          entryPrice: price,
          screenshotUrl,
          brokerCsvPaths: (data.brokerCsvPaths as string[] | undefined) ?? null,
          indicatorCsvPaths: (data.indicatorCsvPaths as string[] | undefined) ?? null,
          screenshotPaths: screenshotPaths ?? null,
        } satisfies TradeJournalListItem;
      }),
    );

    return items;
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
