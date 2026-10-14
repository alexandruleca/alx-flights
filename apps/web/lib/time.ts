/**
 * Units of time, in milliseconds. The API has the same file (apps/api/src/domain/time.ts):
 * the shared contract package is types only, so the two apps share no runtime code.
 */
export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

/** Start of the UTC clock hour containing `ms` (epoch ms are UTC, so whole hours divide evenly). */
export function startOfHour(ms: number): number {
  return ms - (ms % HOUR_MS);
}
