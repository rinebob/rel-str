import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'trunc', standalone: true })
export class TruncPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals: number = 2): string {
    if (value === null || value === undefined || isNaN(value as number)) return '—';
    const d = Math.max(0, Math.floor(decimals));
    const factor = Math.pow(10, d);
    const truncated = (value >= 0)
      ? Math.trunc((value as number) * factor) / factor
      : -Math.trunc(Math.abs(value as number) * factor) / factor;
    return truncated.toFixed(d);
  }
}
