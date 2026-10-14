import type { ApplyEffects } from './apply';
import type { AirportState } from './state';
import type { FeedMessage, StoredAnomaly, TimelineEvent } from './types';

/**
 * The timeline rows one applied message produces: the scrubber's volume and
 * the replay event log. Only what actually changed is logged, so an ignored
 * snapshot (locked feed) never becomes a replay boundary.
 */
export function timelineOf(
  message: FeedMessage,
  effects: ApplyEffects,
  state: AirportState,
): TimelineEvent[] {
  const connectionEpoch = state.link.connectionEpoch;
  const rows: TimelineEvent[] = [];

  if (message.type === 'hello') {
    const lock = state.link.lock;
    rows.push({
      ts: message.ts,
      type: 'hello',
      connectionEpoch,
      seq: message.seq,
      summary: lock
        ? `hello ${lock.got} rejected (expected ${lock.expected})`
        : `hello ${message.airport.code} (${message.feed})`,
    });
  }
  if (message.type === 'snapshot' && effects.flightListComplete) {
    rows.push({
      ts: message.ts,
      type: 'snapshot',
      connectionEpoch,
      seq: message.seq,
      summary: `snapshot ${message.flights.length} flights`,
    });
  }
  for (const flight of effects.flights) {
    rows.push({
      ts: flight.ts,
      type: 'flight',
      connectionEpoch: flight.connectionEpoch,
      seq: flight.seq,
      summary: `${flight.callsign} ${flight.kind} → ${flight.status}`,
      flightId: flight.flightId,
      icao24: flight.icao24,
      callsign: flight.callsign,
      status: flight.status,
      kind: flight.kind,
    });
  }
  for (const position of effects.positions) {
    rows.push({
      ts: position.ts,
      type: 'position',
      connectionEpoch: position.connectionEpoch,
      seq: position.seq,
      summary: `${position.callsign} ${position.lat.toFixed(4)},${position.lon.toFixed(4)}`,
      icao24: position.icao24,
      callsign: position.callsign,
    });
  }
  for (const movement of effects.movements) {
    rows.push({
      ts: movement.ts,
      type: 'movement',
      connectionEpoch: movement.connectionEpoch,
      summary: `${movement.kind} ${movement.flightId}`,
      flightId: movement.flightId,
      kind: movement.kind,
    });
  }
  for (const alert of effects.alerts) {
    const change = !alert.active ? 'cleared' : alert.raisedAt === alert.ts ? 'raised' : 'updated';
    rows.push({
      ts: alert.ts,
      type: 'alert',
      connectionEpoch,
      summary: `${change}: ${alert.message}`,
      flightId: alert.flightId,
    });
  }
  return rows;
}

export function anomalyEvent(anomaly: StoredAnomaly): TimelineEvent {
  return {
    ts: anomaly.at,
    type: 'anomaly',
    connectionEpoch: anomaly.connectionEpoch,
    seq: anomaly.seq,
    summary: `${anomaly.reason}: ${anomaly.detail}`,
    reason: anomaly.reason,
  };
}
