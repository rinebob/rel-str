import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { NewTradeDialogResult } from './new-trade.dialog';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';

function getTradeImportUrl(): string {
  if (environment.useEmulators) {
    return 'http://127.0.0.1:5002/rel-str/us-central1/importTrade';
  }

  // Prod: call the deployed Cloud Function directly
  return 'https://us-central1-rel-str.cloudfunctions.net/importTrade';
}

@Injectable({ providedIn: 'root' })
export class TradeJournalService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  async importTrade(result: NewTradeDialogResult, localTradeId: string): Promise<void> {
    const formData = new FormData();
    const url = getTradeImportUrl();

    formData.append('localTradeId', localTradeId);
    formData.append('symbol', result.symbol);
    formData.append('direction', result.direction);
    formData.append('status', result.status);
    formData.append('entryPrice', String(result.entryPrice ?? ''));
    formData.append('entryDate', result.entryDate ?? '');
    formData.append('entryTime', result.entryTime ?? '');

    for (const file of result.brokerCsvFiles ?? []) {
      formData.append('brokerCsvs', file, file.name);
    }

    for (const file of result.indicatorCsvFiles ?? []) {
      formData.append('indicatorCsvs', file, file.name);
    }

    for (const file of result.screenshotFiles ?? []) {
      formData.append('screenshots', file, file.name);
    }

    // Log payload for local debugging.
    // eslint-disable-next-line no-console
    console.log('[TradeJournalService] importTrade payload', {
      localTradeId,
      symbol: result.symbol,
      direction: result.direction,
      status: result.status,
      entryPrice: result.entryPrice,
      entryDate: result.entryDate,
      entryTime: result.entryTime,
      brokerCsvFileNames: result.brokerCsvFiles.map((f) => f.name),
      indicatorCsvFileNames: result.indicatorCsvFiles.map((f) => f.name),
      screenshotFileNames: result.screenshotFiles.map((f) => f.name),
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
}
