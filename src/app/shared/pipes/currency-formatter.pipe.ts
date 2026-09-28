import { Pipe, PipeTransform } from '@angular/core';

/**
 * Compact USD formatting for dense CRM surfaces.
 *
 * Large sums collapse to a single scale suffix so a table column stays narrow:
 * `$2.4M`, `$750K`, `$0`. Amounts below the thousand threshold fall back to
 * `Intl.NumberFormat` so a sub-thousand remainder never renders as a misleading
 * bare `$0`.
 *
 * Exported as a pure function as well as a pipe, because a component that has to
 * build a `{ label, value }` array for another component needs the formatting
 * without a template pipe, and hand-constructing a pipe instance would be worse.
 */
export function formatCompactCurrency(value: number | null | undefined, compact = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (!compact) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  }

  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);

  if (magnitude < 1000) {
    return `${sign}$${magnitude.toLocaleString('en-US')}`;
  }
  if (magnitude < 1_000_000) {
    return `${sign}$${trimScale(magnitude / 1000)}K`;
  }
  if (magnitude < 1_000_000_000) {
    return `${sign}$${trimScale(magnitude / 1_000_000)}M`;
  }
  return `${sign}$${trimScale(magnitude / 1_000_000_000)}B`;
}

/**
 * Keeps at most one decimal and drops a trailing `.0`, so `1000K` renders as
 * `1M` and `1250K` as `1.3M` rather than `1.25M`, which is noise at a glance.
 */
function trimScale(scaled: number): string {
  const rounded = Math.round(scaled * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

@Pipe({ name: 'currencyFormatter' })
export class CurrencyFormatterPipe implements PipeTransform {
  public transform(value: number | null | undefined, compact = true): string {
    return formatCompactCurrency(value, compact);
  }
}
