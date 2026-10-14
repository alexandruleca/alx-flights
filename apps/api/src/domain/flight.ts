import { MINUTE_MS } from './time';
import type { FlightPhase, FlightRecord, FlightStatus } from './types';

/**
 * The flight lifecycle in one place: every rule that depends on a status
 * (delays, movements, board visibility, which flight an airframe is flying)
 * is phrased in terms of these phases.
 */
const PHASE: Record<FlightStatus, FlightPhase> = {
  AIRBORNE: 'planned',
  SCHEDULED: 'planned',
  APPROACH: 'active',
  BOARDING: 'active',
  PUSHBACK: 'active',
  LANDED: 'ground',
  TAXI: 'ground',
  ON_STAND: 'done',
  DEPARTED: 'done',
  DIVERTED: 'irregular',
  CANCELLED: 'irregular',
};

/** Later than this after schedule is late: the Delayed alert, and not on time for the KPI. */
export const DELAY_THRESHOLD_MS = 15 * MINUTE_MS;

type Flight = Pick<FlightRecord, 'kind' | 'status'>;

export function phaseOf(flight: Pick<FlightRecord, 'status'>): FlightPhase {
  return PHASE[flight.status] ?? 'planned';
}

/** Nothing left to happen: on stand, departed, diverted or cancelled. */
export function hasEnded(flight: Flight): boolean {
  const phase = phaseOf(flight);
  return phase === 'done' || phase === 'irregular';
}

/** The landing (ARR) or take-off (DEP) the schedule refers to has happened. */
export function movementHappened(flight: Flight): boolean {
  const phase = phaseOf(flight);
  return flight.kind === 'ARR'
    ? phase === 'ground' || phase === 'done'
    : phase === 'done';
}

/**
 * When the flight's movement (landing for ARR, take-off for DEP) happens or is
 * expected: actual, else estimated. Unlike `scheduled`, this always puts an
 * aircraft's arrival before its departure — a delayed inbound pushes the
 * departure's estimate, never its schedule.
 */
export function movementTime(flight: Pick<FlightRecord, 'actual' | 'estimated'>): string {
  return flight.actual ?? flight.estimated;
}

export function delayMs(flight: Pick<FlightRecord, 'scheduled' | 'estimated'>): number {
  return Date.parse(flight.estimated) - Date.parse(flight.scheduled);
}

/** Delayed: estimated > 15 min after scheduled, while the movement is still to come. */
export function isDelayed(flight: FlightRecord): boolean {
  if (phaseOf(flight) === 'irregular' || movementHappened(flight)) return false;
  const delay = delayMs(flight);
  return Number.isFinite(delay) && delay > DELAY_THRESHOLD_MS;
}
