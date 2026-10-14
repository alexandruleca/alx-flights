import { evaluateDelayed, openAlert, standConflictContent } from './alerts';
import { standConflicts } from './stands';
import { AirportState } from './state';
import type { FeedLinkStatus, StoredFlight, StoredPosition } from './types';

/** The latest stored version of everything that mattered at one instant. */
export interface Picture {
  link: FeedLinkStatus | null;
  flights: StoredFlight[];
  positions: StoredPosition[];
}

/**
 * The airport state at a past instant, so replay reads it through the same
 * projections as live. Alerts are pure functions of the flights (Delayed per
 * flight, stand conflicts across them), so they are re-derived, not read back.
 */
export function replayState(picture: Picture): AirportState {
  const state = new AirportState();
  if (picture.link) state.importLink(picture.link);
  for (const flight of picture.flights) {
    state.flights.set(flight.flightId, flight);
    const alert = evaluateDelayed(flight, undefined, flight.ts);
    if (alert) state.alerts.set(alert.subject, alert);
  }
  for (const conflict of standConflicts(picture.flights)) {
    const alert = openAlert(standConflictContent(conflict), conflict.incoming.arrival.ts);
    state.alerts.set(alert.subject, alert);
  }
  for (const position of picture.positions) state.positions.set(position.icao24, position);
  return state;
}
