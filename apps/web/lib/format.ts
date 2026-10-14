import { HOUR_MS, MINUTE_MS, SECOND_MS } from './time';

/** Ops time is UTC, like the feed. */
export function hhmm(iso: string | null | undefined): string {
  return utc(iso, 5);
}

export function hhmmss(iso: string | null | undefined): string {
  return utc(iso, 8);
}

function utc(iso: string | null | undefined, length: number): string {
  const epochMs = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(epochMs)
    ? new Date(epochMs).toISOString().slice(11, 11 + length)
    : '—';
}

export function delayMinutes(flight: { scheduled: string; estimated: string }): number {
  return Math.round((Date.parse(flight.estimated) - Date.parse(flight.scheduled)) / MINUTE_MS);
}

/** `83%`, or `—` when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : '—';
}

/** `ON_STAND` → `ON STAND`, `duplicate_seq` → `duplicate seq`. */
export function humanize(code: string): string {
  return code.replaceAll('_', ' ');
}

/** 90 000 → `1m 30s`; `2h 05m` once it runs into hours. */
export function duration(ms: number): string {
  const rounded = Math.max(0, Math.round(ms / SECOND_MS)) * SECOND_MS;
  const hours = Math.floor(rounded / HOUR_MS);
  const minutes = Math.floor((rounded % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((rounded % MINUTE_MS) / SECOND_MS);
  const twoDigits = (n: number) => String(n).padStart(2, '0');
  return hours ? `${hours}h ${twoDigits(minutes)}m` : `${minutes}m ${twoDigits(seconds)}s`;
}
