import { movementTime } from './flight';
import { rotations, turnaroundsOf } from './rotation';
import type { FlightStatus, StoredFlight } from './types';

/** An arrival on the ground heading onto its stand, or already on it. */
const BOUND_FOR_STAND: ReadonlySet<FlightStatus> = new Set(['LANDED', 'TAXI', 'ON_STAND']);
/** From pushback on, the departing aircraft is vacating its stand. */
const VACATING: ReadonlySet<FlightStatus> = new Set(['PUSHBACK', 'TAXI', 'DEPARTED', 'CANCELLED']);

/** An aircraft's claim on a stand: its arrival, and its next departure if known. */
export interface StandClaim {
  stand: string;
  arrival: StoredFlight;
  departure: StoredFlight | null;
}

export interface StandConflict {
  stand: string;
  /** Still on the stand, not yet pushing back. */
  occupant: StandClaim;
  /** Landed, taxiing in, or on the stand too. */
  incoming: StandClaim;
}

/**
 * Every aircraft's claim on its stand. An aircraft holds its stand from landing
 * (it is then committed to it) until its departure starts pushing back.
 */
function standClaims(flights: Iterable<StoredFlight>): StandClaim[] {
  const claims: StandClaim[] = [];
  for (const rotation of rotations(flights).values()) {
    for (const [arrival, departure] of turnaroundsOf(rotation)) {
      if (!arrival.stand || !BOUND_FOR_STAND.has(arrival.status)) continue;
      if (departure && VACATING.has(departure.status)) continue;
      claims.push({ stand: arrival.stand, arrival, departure });
    }
  }
  return claims;
}

/**
 * Stand conflicts: two aircraft on — or one on and one heading onto — the same
 * stand.
 *
 * Deliberately not "assigned to an occupied stand": inbound flights are routinely
 * assigned a stand whose aircraft leaves before they arrive, and stands can still
 * change while inbound. Waiting for the landing flags real conflicts only, still
 * minutes before both aircraft are on the stand.
 */
export function standConflicts(flights: Iterable<StoredFlight>): StandConflict[] {
  const claims = new Map<string, StandClaim[]>();
  for (const claim of standClaims(flights)) {
    const onStand = claims.get(claim.stand);
    if (onStand) onStand.push(claim);
    else claims.set(claim.stand, [claim]);
  }
  const conflicts: StandConflict[] = [];
  for (const [stand, onStand] of claims) {
    if (onStand.length < 2) continue;
    onStand.sort((a, b) => movementTime(a.arrival).localeCompare(movementTime(b.arrival)));
    conflicts.push({ stand, occupant: onStand[0], incoming: onStand[onStand.length - 1] });
  }
  return conflicts;
}

/** Aircraft on their stand now: arrived on it, and not yet pushing back. */
export function standOccupants(flights: Iterable<StoredFlight>): StandClaim[] {
  return standClaims(flights).filter((c) => c.arrival.status === 'ON_STAND');
}

/** Every flight involved in a conflict (both aircraft's arrivals and departures). */
export function flightsInConflict(conflicts: StandConflict[]): Set<string> {
  return new Set(
    conflicts.flatMap(({ occupant, incoming }) =>
      [occupant.arrival, occupant.departure, incoming.arrival, incoming.departure]
        .filter((f): f is StoredFlight => f !== null)
        .map((f) => f.flightId),
    ),
  );
}
