import { delayMs, isDelayed } from './flight';
import type { StandClaim, StandConflict } from './stands';
import { MINUTE_MS } from './time';
import type { AlertRecord, FlightRecord } from './types';

/** What an alert is about and what it says; the lifecycle below adds the rest. */
type AlertContent = Pick<AlertRecord, 'subject' | 'type' | 'flightId' | 'message'>;

// ---------- Lifecycle, shared by every alert type ----------

/** A newly raised alert. */
export function openAlert(content: AlertContent, nowIso: string): AlertRecord {
  const id = `${content.subject}@${nowIso}`;
  return { ...content, id, ts: nowIso, active: true, raisedAt: nowIso, closedAt: null };
}

/**
 * Raise `content`, or update the open alert it continues (which keeps the time
 * it was raised). Once closed, an alert stays in the log as it was: the same
 * subject alerting again is a new alert. `null` when nothing changed, so an
 * unchanged alert is not rewritten on every feed message.
 */
function raiseOrUpdate(
  content: AlertContent,
  previous: AlertRecord | undefined,
  nowIso: string,
): AlertRecord | null {
  if (!previous?.active) return openAlert(content, nowIso);
  if (previous.message === content.message && previous.flightId === content.flightId) return null;
  return { ...previous, ...content, ts: nowIso };
}

export function closeAlert(alert: AlertRecord, nowIso: string): AlertRecord {
  return { ...alert, active: false, ts: nowIso, closedAt: nowIso };
}

// ---------- Delayed ----------

export function delayedSubject(flightId: string): string {
  return `delayed:${flightId}`;
}

/**
 * A flight's Delayed alert after a new version of it: raised or updated while
 * it is delayed, closed once it no longer is. `null` means nothing to record.
 */
export function evaluateDelayed(
  flight: FlightRecord,
  existing: AlertRecord | undefined,
  nowIso: string,
): AlertRecord | null {
  if (isDelayed(flight)) return raiseOrUpdate(delayedContent(flight), existing, nowIso);
  return existing?.active ? closeAlert(existing, nowIso) : null;
}

function delayedContent(flight: FlightRecord): AlertContent {
  const minutes = Math.round(delayMs(flight) / MINUTE_MS);
  return {
    subject: delayedSubject(flight.flightId),
    type: 'delayed',
    flightId: flight.flightId,
    message: `${flight.callsign} delayed ~${minutes} min (${flight.kind})`,
  };
}

// ---------- Stand conflict ----------

export function standSubject(stand: string): string {
  return `stand:${stand}`;
}

/**
 * Stand-conflict alerts after a change: one per conflicted stand, raised or
 * updated when its story changes, closed once the conflict is over. Returns
 * only what changed.
 */
export function evaluateStandConflicts(
  conflicts: StandConflict[],
  alerts: Iterable<AlertRecord>,
  nowIso: string,
): AlertRecord[] {
  const open = new Map(
    [...alerts].filter((a) => a.type === 'stand_conflict' && a.active).map((a) => [a.subject, a]),
  );
  const changes: AlertRecord[] = [];
  for (const conflict of conflicts) {
    const content = standConflictContent(conflict);
    const change = raiseOrUpdate(content, open.get(content.subject), nowIso);
    open.delete(content.subject);
    if (change) changes.push(change);
  }
  for (const ended of open.values()) changes.push(closeAlert(ended, nowIso));
  return changes;
}

export function standConflictContent({ stand, occupant, incoming }: StandConflict): AlertContent {
  return {
    subject: standSubject(stand),
    type: 'stand_conflict',
    flightId: incoming.arrival.flightId,
    message: `Stand ${stand}: ${incoming.arrival.callsign} ${ARRIVING[incoming.arrival.status] ?? 'inbound'}, ${describe(occupant)} still there`,
  };
}

const ARRIVING: Partial<Record<string, string>> = {
  LANDED: 'landed',
  TAXI: 'taxiing in',
  ON_STAND: 'on stand',
};

function describe({ arrival, departure }: StandClaim): string {
  return departure
    ? `${arrival.callsign} (departing as ${departure.callsign}, ${departure.status.toLowerCase()})`
    : arrival.callsign;
}
