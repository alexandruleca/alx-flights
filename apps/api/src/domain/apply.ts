import { closeAlert, delayedSubject, evaluateDelayed, evaluateStandConflicts } from './alerts';
import { movementHappened } from './flight';
import { evaluateOccupancy } from './occupancy';
import { inRange, RANGE_M } from './range';
import { standConflicts, standOccupants } from './stands';
import { isOutdated, type AirportState } from './state';
import type {
  AlertRecord,
  FeedMessage,
  FlightMessage,
  HelloMessage,
  IngestMemory,
  MovementRecord,
  PositionMessage,
  SnapshotMessage,
  StandOccupancy,
  StoredFlight,
  StoredPosition,
} from './types';

/** What applying one message changed — everything ingest has to persist. */
export interface ApplyEffects {
  /** New flight versions: upserted into `flights`, appended to `flightVersions`. */
  flights: StoredFlight[];
  /** A snapshot was applied: `flights` is the feed's complete list. */
  flightListComplete: boolean;
  positions: StoredPosition[];
  alerts: AlertRecord[];
  movements: MovementRecord[];
  /** Aircraft that came onto or left a stand: upserted into `standOccupancy`. */
  occupancies: StandOccupancy[];
  /** A hello changed the feed link (airport, lock, epoch). */
  linkChanged: boolean;
  /** Expected skips — not anomalies, the feed is fine — and why. */
  skipped?: { reason: 'stale_entity' | 'locked' | 'out_of_range'; detail: string };
}

/** The domain's single entry point: one trusted feed message in, effects out. */
export function applyMessage(
  state: AirportState,
  message: FeedMessage,
  expectedAirport: string,
): ApplyEffects {
  const effects: ApplyEffects = {
    flights: [],
    flightListComplete: false,
    positions: [],
    alerts: [],
    movements: [],
    occupancies: [],
    linkChanged: false,
  };
  if (message.type === 'hello') {
    return applyHello(state, message, expectedAirport, effects);
  }
  if (state.link.lock) {
    return skip(effects, 'locked', `Ignored ${message.type} seq=${message.seq} while misconfigured`);
  }
  const lastHeard = state.heardAt;
  state.heardAt = latest(lastHeard, message.ts);
  switch (message.type) {
    case 'snapshot':
      return applySnapshot(state, message, effects, lastHeard);
    case 'flight':
      return applyFlight(state, message, effects);
    case 'position':
      return applyPosition(state, message, effects);
  }
}

/** Every record of a land / take-off is keyed so it counts once. */
export function movementKey(movement: Pick<MovementRecord, 'flightId' | 'kind'>): string {
  return `${movement.flightId}:${movement.kind}`;
}

/** A restarted ingest picks up where the last run stopped, so it can close what that run opened. */
export function resumeFrom(state: AirportState, memory: IngestMemory): void {
  for (const alert of memory.alerts) state.alerts.set(alert.subject, alert);
  for (const movement of memory.movements) state.recordedMovements.add(movementKey(movement));
  for (const occupancy of memory.onStand) state.onStand.set(occupancy.flightId, occupancy);
  state.heardAt = memory.heardAt;
}

function applyHello(
  state: AirportState,
  hello: HelloMessage,
  expectedAirport: string,
  effects: ApplyEffects,
): ApplyEffects {
  const announced = hello.airport?.code;
  state.link.started = true;
  state.link.feed = hello.feed;
  state.link.lock =
    announced === expectedAirport
      ? null
      : { expected: expectedAirport, got: announced ?? '(missing)' };
  if (!state.link.lock) {
    state.airport = hello.airport;
    state.zones = hello.zones;
  }
  effects.linkChanged = true;
  return effects;
}

/**
 * The feed's full picture: replaces flights and aircraft wholesale. It follows
 * a gap of unknown length (a reconnect, or ingest down) after `lastHeard`.
 */
function applySnapshot(
  state: AirportState,
  snapshot: SnapshotMessage,
  effects: ApplyEffects,
  lastHeard: string | null,
): ApplyEffects {
  state.flights.clear();
  state.positions.clear();
  for (const flight of snapshot.flights) {
    putFlight(state, effects, stamp(flight, snapshot, state));
  }
  for (const position of snapshot.aircraft ?? []) {
    if (!inRange(position, state.airport)) continue;
    putPosition(state, effects, stamp(position, snapshot, state));
  }
  // A flight missing from the snapshot has left the feed, and its alert with it.
  for (const alert of state.alerts.values()) {
    if (alert.active && !state.flights.has(alert.flightId)) {
      recordAlert(state, effects, closeAlert(alert, snapshot.ts));
    }
  }
  // A stay that ended during the gap is counted only while it was watched.
  recordStands(state, effects, snapshot.ts, lastHeard ?? snapshot.ts);
  effects.flightListComplete = true;
  return effects;
}

function applyFlight(
  state: AirportState,
  message: FlightMessage,
  effects: ApplyEffects,
): ApplyEffects {
  if (isOutdated(message, state.flights.get(message.flightId))) {
    return skip(effects, 'stale_entity', `Stale flight ${message.flightId} seq=${message.seq}`);
  }
  putFlight(state, effects, stamp(withoutType(message), message, state));
  recordStands(state, effects, message.ts);
  return effects;
}

function applyPosition(
  state: AirportState,
  message: PositionMessage,
  effects: ApplyEffects,
): ApplyEffects {
  if (!inRange(message, state.airport)) {
    return skip(effects, 'out_of_range', `Position ${message.icao24} beyond ${RANGE_M / 1000} km`);
  }
  if (isOutdated(message, state.positions.get(message.icao24))) {
    return skip(effects, 'stale_entity', `Stale position ${message.icao24} seq=${message.seq}`);
  }
  putPosition(state, effects, stamp(withoutType(message), message, state));
  return effects;
}

function putFlight(state: AirportState, effects: ApplyEffects, flight: StoredFlight): void {
  state.flights.set(flight.flightId, flight);
  effects.flights.push(flight);
  recordMovement(state, effects, flight);
  const existing = state.alerts.get(delayedSubject(flight.flightId));
  const alert = evaluateDelayed(flight, existing, flight.ts);
  if (alert) recordAlert(state, effects, alert);
}

function putPosition(state: AirportState, effects: ApplyEffects, position: StoredPosition): void {
  state.positions.set(position.icao24, position);
  effects.positions.push(position);
}

/**
 * Stand rules span flights, so they are re-checked once the whole message is
 * applied. A stay found over ends at `stayEndedAt` (see `evaluateOccupancy`).
 */
function recordStands(
  state: AirportState,
  effects: ApplyEffects,
  nowIso: string,
  stayEndedAt = nowIso,
): void {
  const flights = [...state.flights.values()];
  const alerts = evaluateStandConflicts(standConflicts(flights), state.alerts.values(), nowIso);
  for (const alert of alerts) recordAlert(state, effects, alert);
  const occupants = standOccupants(flights);
  const occupancies = evaluateOccupancy(occupants, state.onStand, nowIso, stayEndedAt);
  for (const occupancy of occupancies) recordOccupancy(state, effects, occupancy);
}

function recordAlert(state: AirportState, effects: ApplyEffects, alert: AlertRecord): void {
  state.alerts.set(alert.subject, alert);
  effects.alerts.push(alert);
}

function recordOccupancy(state: AirportState, effects: ApplyEffects, occupancy: StandOccupancy): void {
  if (occupancy.to) state.onStand.delete(occupancy.flightId);
  else state.onStand.set(occupancy.flightId, occupancy);
  effects.occupancies.push(occupancy);
}

/** Record each landing / take-off once, however often the flight is re-sent. */
function recordMovement(state: AirportState, effects: ApplyEffects, flight: StoredFlight): void {
  if (!movementHappened(flight)) return;
  const movement: MovementRecord = {
    flightId: flight.flightId,
    kind: flight.kind === 'ARR' ? 'land' : 'takeoff',
    ts: flight.actual ?? flight.ts,
    scheduled: flight.scheduled,
    connectionEpoch: flight.connectionEpoch,
  };
  const key = movementKey(movement);
  if (state.recordedMovements.has(key)) return;
  state.recordedMovements.add(key);
  effects.movements.push(movement);
}

/** A record as stored: stamped with its message time, seq and connection. */
function stamp<T extends object>(
  record: T,
  message: { ts: string; seq: number },
  state: AirportState,
): T & { ts: string; seq: number; connectionEpoch: number } {
  return { ...record, ts: message.ts, seq: message.seq, connectionEpoch: state.link.connectionEpoch };
}

/** The later of two feed times: a late message never moves the clock back. */
function latest(heardAt: string | null, ts: string): string {
  return heardAt !== null && Date.parse(heardAt) >= Date.parse(ts) ? heardAt : ts;
}

function withoutType<T extends { type: string }>({ type: _type, ...record }: T): Omit<T, 'type'> {
  return record;
}

function skip(
  effects: ApplyEffects,
  reason: NonNullable<ApplyEffects['skipped']>['reason'],
  detail: string,
): ApplyEffects {
  effects.skipped = { reason, detail };
  return effects;
}
