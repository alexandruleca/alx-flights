import { hasEnded, movementTime } from './flight';
import type { StoredFlight } from './types';

/**
 * Each aircraft's flights in the order it flies them — by when each lands or
 * takes off, not by schedule (a late inbound's departure can be scheduled
 * before it). Keyed by `icao24`.
 */
export function rotations(flights: Iterable<StoredFlight>): Map<string, StoredFlight[]> {
  const byAircraft = new Map<string, StoredFlight[]>();
  for (const flight of flights) {
    const rotation = byAircraft.get(flight.icao24);
    if (rotation) rotation.push(flight);
    else byAircraft.set(flight.icao24, [flight]);
  }
  for (const rotation of byAircraft.values()) {
    rotation.sort((a, b) => movementTime(a).localeCompare(movementTime(b)));
  }
  return byAircraft;
}

/** The flight an aircraft is on now: the first not yet ended (else its last). */
export function currentFlight(rotation: StoredFlight[]): StoredFlight {
  return rotation.find((f) => !hasEnded(f)) ?? rotation[rotation.length - 1];
}

/** Each arrival with the departure its aircraft flies next: a turnaround. */
export function turnaroundsOf(rotation: StoredFlight[]): [StoredFlight, StoredFlight | null][] {
  return rotation.flatMap((flight, index) => {
    if (flight.kind !== 'ARR') return [];
    const next = rotation[index + 1];
    return [[flight, next?.kind === 'DEP' ? next : null] as [StoredFlight, StoredFlight | null]];
  });
}
