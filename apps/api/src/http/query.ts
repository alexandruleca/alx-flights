import { BadRequestException } from '@nestjs/common';
import { HOUR_MS } from '../domain/time';

/** An ISO instant from a query param, or `fallback` when absent; 400 when unparseable. */
export function instant(value: string | undefined, fallback: Date): string {
  if (!value) return fallback.toISOString();
  const epochMs = Date.parse(value);
  if (Number.isNaN(epochMs)) throw new BadRequestException(`Not a timestamp: ${value}`);
  return new Date(epochMs).toISOString();
}

/** A `from`/`to` range from query params; defaults to the last hour. */
export function rangeOf(from?: string, to?: string): { from: string; to: string } {
  const toIso = instant(to, new Date());
  return { from: instant(from, new Date(Date.parse(toIso) - HOUR_MS)), to: toIso };
}
