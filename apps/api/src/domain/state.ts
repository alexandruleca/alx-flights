import type { BoardPayload, MapPayload } from '@alx/contracts';
import { isDelayed, phaseOf } from './flight';
import { currentFlight, rotations, turnaroundsOf } from './rotation';
import { flightsInConflict, standConflicts } from './stands';
import { MINUTE_MS, SECOND_MS } from './time';
import type {
  AirportInfo,
  AlertRecord,
  FeedLinkStatus,
  FeedLock,
  HealthPayload,
  MapAircraft,
  StandOccupancy,
  StoredFlight,
  StoredPosition,
  Zones,
} from './types';

/** Finished flights leave the board this long after they finished. */
const BOARD_HIDE_AFTER_MS = 20 * MINUTE_MS;

/**
 * No position for this long = not transmitting any more: parked on stand
 * (silent after ~15 s) or departed out of range (positions beyond 15 km are
 * ignored, and the feed goes quiet about there too).
 */
export const SIGNAL_LOST_MS = 30 * SECOND_MS;

/** The feed connection the picture comes from. */
interface FeedLink {
  feed: string | null;
  /** Bumps on every reconnect, because `seq` restarts at 1. */
  connectionEpoch: number;
  /** A hello has been seen. */
  started: boolean;
  lock: FeedLock | null;
}

/**
 * The airport picture and the feed link it came from. Ingest changes it via
 * `applyMessage`, the API mirrors it from Mongo, replay rebuilds it for a past
 * instant — and all three read it through the same projections below.
 */
export class AirportState {
  airport: AirportInfo | null = null;
  zones: Zones | null = null;
  readonly flights = new Map<string, StoredFlight>();
  readonly positions = new Map<string, StoredPosition>();
  /** Each subject's latest alert, open or closed (`AlertRecord.subject`). */
  readonly alerts = new Map<string, AlertRecord>();
  /** Ingest only: landings / take-offs already recorded (`movementKey`). */
  readonly recordedMovements = new Set<string>();
  /** Ingest only: the open occupancy of every aircraft on a stand, by arrival `flightId`. */
  readonly onStand = new Map<string, StandOccupancy>();
  /**
   * Ingest only: feed time of the newest message applied, the last moment the
   * picture was known to be current. A gap of any length can follow it
   * (a reconnect, ingest down); the next snapshot reads it.
   */
  heardAt: string | null = null;
  link: FeedLink = { feed: null, connectionEpoch: 1, started: false, lock: null };

  /** A new feed connection: records from now on carry a new epoch. */
  reconnected(): void {
    if (this.link.started) this.link.connectionEpoch += 1;
  }

  // ---------- Feed link: published by ingest, mirrored by the API ----------

  exportLink(): FeedLinkStatus {
    const { feed, connectionEpoch, lock } = this.link;
    return { airport: this.airport, zones: this.zones, feed, connectionEpoch, lock };
  }

  importLink(status: FeedLinkStatus): void {
    this.airport = status.airport;
    this.zones = status.zones;
    this.link = {
      feed: status.feed,
      connectionEpoch: status.connectionEpoch,
      started: true,
      lock: status.lock ?? null,
    };
  }

  // ---------- Projections: what the desk shows ----------

  health(): HealthPayload {
    const { feed, connectionEpoch, started, lock } = this.link;
    const known = {
      airport: this.airport ?? undefined,
      feed: feed ?? undefined,
      reconnects: connectionEpoch - 1,
    };
    if (lock) return { ...known, ok: false, locked: true, error: 'misconfigured', ...lock };
    if (!started) return { ...known, ok: false, locked: false, error: 'starting' };
    return { ...known, ok: true, locked: false };
  }

  /** The board as of `now`: wall clock live, the cursor in replay. */
  board(now = Date.now()): BoardPayload {
    const visible = [...this.flights.values()].filter((f) => onBoard(f, now));
    const partner = turnarounds(visible);
    const conflicted = flightsInConflict(standConflicts(this.flights.values()));
    const rows = visible
      .map((flight) => ({
        ...flight,
        phase: phaseOf(flight),
        delayed: isDelayed(flight),
        turnaround: partner.get(flight.flightId) ?? null,
        standConflict: conflicted.has(flight.flightId),
      }))
      .sort((a, b) => a.scheduled.localeCompare(b.scheduled));
    return {
      arrivals: rows.filter((row) => row.kind === 'ARR'),
      departures: rows.filter((row) => row.kind === 'DEP'),
    };
  }

  /**
   * Aircraft on the field as of `now`: those transmitting, plus parked ones —
   * the feed goes silent ~15 s after an aircraft reaches its stand, and an
   * aircraft last heard stopped on the ground with a flight still on the board
   * is still there. Silence in the air means it left coverage.
   * Live defaults to the feed's own clock (newest position), so local clock
   * skew cannot blank the map.
   */
  mapView(now = this.newestPositionMs()): MapPayload {
    const current = this.currentFlightByAirframe();
    const aircraft: MapAircraft[] = [];
    for (const position of this.positions.values()) {
      const flight = current.get(position.icao24);
      const transmitting = now - Date.parse(position.ts) <= SIGNAL_LOST_MS;
      const parked = !transmitting && flight !== undefined && position.onGround && position.gs === 0;
      if (transmitting || parked) aircraft.push(withFlight(position, flight, transmitting));
    }
    return { airport: this.airport, zones: this.zones, aircraft };
  }

  activeAlerts(): AlertRecord[] {
    return [...this.alerts.values()].filter((a) => a.active);
  }

  /** An arrival and its departure share an airframe: pick the one it is on now. */
  private currentFlightByAirframe(): Map<string, StoredFlight> {
    const current = new Map<string, StoredFlight>();
    for (const [icao24, rotation] of rotations(this.flights.values())) {
      current.set(icao24, currentFlight(rotation));
    }
    return current;
  }

  private newestPositionMs(): number {
    let newest = -Infinity;
    for (const position of this.positions.values()) {
      newest = Math.max(newest, Date.parse(position.ts));
    }
    return newest;
  }
}

/** Out-of-order guard: a version older than the one held is ignored. */
export function isOutdated(
  next: { ts: string },
  current: { ts: string } | undefined,
): boolean {
  return current !== undefined && Date.parse(next.ts) < Date.parse(current.ts);
}

/** Irregular flights never show; finished ones leave 20 min after finishing. */
function onBoard(flight: StoredFlight, now: number): boolean {
  const phase = phaseOf(flight);
  if (phase === 'irregular') return false;
  if (phase !== 'done') return true;
  return !(now - Date.parse(flight.actual ?? flight.ts) > BOARD_HIDE_AFTER_MS);
}

/** Arrival ↔ departure of each turnaround on the board: flightId ↔ flightId. */
function turnarounds(flights: StoredFlight[]): Map<string, string> {
  const partner = new Map<string, string>();
  for (const rotation of rotations(flights).values()) {
    for (const [arrival, departure] of turnaroundsOf(rotation)) {
      if (!departure) continue;
      partner.set(arrival.flightId, departure.flightId);
      partner.set(departure.flightId, arrival.flightId);
    }
  }
  return partner;
}

function withFlight(
  position: StoredPosition,
  flight: StoredFlight | undefined,
  transmitting: boolean,
): MapAircraft {
  return {
    ...position,
    // A parked aircraft's last report still carries its inbound callsign.
    callsign: flight?.callsign ?? position.callsign,
    transmitting,
    flightId: flight?.flightId ?? null,
    kind: flight?.kind ?? null,
    status: flight?.status ?? null,
    stand: flight?.stand ?? null,
    origin: flight?.origin ?? null,
    destination: flight?.destination ?? null,
    delayed: flight ? isDelayed(flight) : false,
  };
}
