import type { HourStandUse } from '@alx/contracts';
import type { StandClaim } from './stands';
import { HOUR_MS, MINUTE_MS, startOfHour } from './time';
import type { StandOccupancy } from './types';

/**
 * Occupancies after a change seen at `nowIso`: opened when an aircraft is first
 * seen on its stand, closed once it no longer is (its departure is pushing back,
 * or it left the feed). `open` holds the occupancies still running.
 *
 * A stay found over ends at `endedAt`. A flight message reports the change as it
 * happens, so that is now. A snapshot after a gap in the feed only shows that it
 * happened during the gap, so the stay ends when the feed was last heard: time
 * nobody watched is never counted, however long the gap. Returns only what changed.
 */
export function evaluateOccupancy(
  onStand: StandClaim[],
  open: ReadonlyMap<string, StandOccupancy>,
  nowIso: string,
  endedAt = nowIso,
): StandOccupancy[] {
  const changes: StandOccupancy[] = [];
  const stillOnStand = new Set<string>();
  for (const { stand, arrival } of onStand) {
    stillOnStand.add(arrival.flightId);
    if (!open.has(arrival.flightId)) {
      changes.push({ flightId: arrival.flightId, stand, from: nowIso, to: null });
    }
  }
  for (const stay of open.values()) {
    if (!stillOnStand.has(stay.flightId)) changes.push({ ...stay, to: endedAt });
  }
  return changes;
}

/**
 * Minutes each stand was occupied per UTC hour, between `sinceIso` and `untilIso`.
 * An occupancy still open runs until `untilIso`. Two aircraft on one stand at
 * once (a stand conflict) occupy it once: each stand's stays are merged first.
 */
export function standUsePerHour(
  occupancies: StandOccupancy[],
  sinceIso: string,
  untilIso: string,
): HourStandUse[] {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  const stays = new Map<string, Interval[]>();
  for (const occupancy of occupancies) {
    const from = Math.max(Date.parse(occupancy.from), since);
    const to = Math.min(occupancy.to ? Date.parse(occupancy.to) : until, until);
    if (to <= from) continue;
    const onStand = stays.get(occupancy.stand);
    if (onStand) onStand.push([from, to]);
    else stays.set(occupancy.stand, [[from, to]]);
  }

  const byHour = new Map<number, Record<string, number>>();
  for (const [stand, intervals] of stays) {
    for (const [from, to] of union(intervals)) {
      for (let hour = startOfHour(from); hour < to; hour += HOUR_MS) {
        const overlapMs = Math.min(to, hour + HOUR_MS) - Math.max(from, hour);
        const minutes = byHour.get(hour) ?? {};
        minutes[stand] = (minutes[stand] ?? 0) + overlapMs / MINUTE_MS;
        byHour.set(hour, minutes);
      }
    }
  }
  return [...byHour]
    .sort(([a], [b]) => a - b)
    .map(([hour, minutes]) => ({ hour: new Date(hour).toISOString(), minutes }));
}

type Interval = [from: number, to: number];

/** The same time covered, with overlapping intervals merged; in order. */
function union(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}
