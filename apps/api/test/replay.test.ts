import { describe, expect, it } from 'vitest';
import { replayState } from '../src/domain/replay';
import type {
  FlightStatus,
  PositionRecord,
  StoredFlight,
  StoredPosition,
} from '../src/domain/types';
import { flight, position, stored } from './fixtures';

const AT_ISO = '2026-10-13T12:00:00.000Z';
const AT_MS = Date.parse(AT_ISO);
const VERSION_TS = '2026-10-13T11:59:00.000Z';

function replay(flights: StoredFlight[], positions: StoredPosition[] = []) {
  return replayState({
    link: {
      airport: { code: 'ALX', name: 'AirportLabs Field', lat: 40, lon: 20 },
      zones: null,
      feed: 'realistic',
      connectionEpoch: 1,
      lock: null,
    },
    flights,
    positions,
  });
}

describe('replay state at a past instant', () => {
  it('re-derives delayed alerts from the flight versions', () => {
    const state = replay([
      stored(flight({ flightId: 'LATE', delayMin: 25 }), VERSION_TS),
      stored(flight({ flightId: 'ONTIME' }), VERSION_TS),
      stored(flight({ flightId: 'DONE', delayMin: 25, status: 'ON_STAND' }), VERSION_TS),
    ]);
    expect(state.activeAlerts().map((a) => a.flightId)).toEqual(['LATE']);
    const rows = state.board(AT_MS).arrivals;
    expect(rows.find((r) => r.flightId === 'LATE')).toMatchObject({ delayed: true, phase: 'active' });
    expect(rows.find((r) => r.flightId === 'DONE')).toMatchObject({ delayed: false, phase: 'done' });
  });

  it('hides finished flights relative to the replay instant, not now', () => {
    const parked = (flightId: string, actual: string) =>
      stored(flight({ flightId, status: 'ON_STAND', actual }), VERSION_TS);
    const state = replay([
      parked('RECENT', '2026-10-13T11:50:00.000Z'),
      parked('OLD', '2026-10-13T11:30:00.000Z'),
    ]);
    expect(state.board(AT_MS).arrivals.map((r) => r.flightId)).toEqual(['RECENT']);
  });

  it('shows only aircraft still transmitting at the instant', () => {
    const state = replay(
      [stored(flight({ delayMin: 25 }), VERSION_TS)],
      [
        stored(position({ icao24: 'abc' }), '2026-10-13T11:59:55.000Z'),
        stored(position({ icao24: 'gone' }), '2026-10-13T11:58:00.000Z'),
      ],
    );
    const aircraft = state.mapView(AT_MS).aircraft;
    expect(aircraft.map((a) => a.icao24)).toEqual(['abc']);
    expect(aircraft[0]).toMatchObject({ kind: 'ARR', delayed: true, transmitting: true });
  });
});

describe('a turnaround: one aircraft, an arrival then a departure', () => {
  // One airframe, two flights: the arrival EK1, then the departure EK2.
  const arrival = (status: FlightStatus) =>
    stored(flight({ flightId: 'EK1', callsign: 'EK1', status, scheduled: '2026-10-13T11:50:00.000Z' }), VERSION_TS);
  const departure = (status: FlightStatus) =>
    stored(flight({ flightId: 'EK2', callsign: 'EK2', kind: 'DEP', status, scheduled: '2026-10-13T12:10:00.000Z' }), VERSION_TS);
  const lastHeard = (ts: string, overrides: Partial<PositionRecord>) =>
    stored(position({ callsign: 'EK1', ...overrides }), ts);

  it('flies the arrival until it is on stand, not the departure scheduled after it', () => {
    const state = replay(
      [arrival('APPROACH'), departure('SCHEDULED')],
      [lastHeard('2026-10-13T11:59:58.000Z', {})],
    );
    expect(state.mapView(AT_MS).aircraft[0]).toMatchObject({ callsign: 'EK1', kind: 'ARR' });
  });

  it('keeps a parked, silent aircraft on its stand under its next flight', () => {
    const state = replay(
      [arrival('ON_STAND'), departure('BOARDING')],
      [lastHeard('2026-10-13T11:57:00.000Z', { onGround: true, gs: 0 })],
    );
    expect(state.mapView(AT_MS).aircraft).toEqual([
      expect.objectContaining({ callsign: 'EK2', kind: 'DEP', transmitting: false }),
    ]);
  });

  it('links an arrival and its departure on the board', () => {
    const board = replay([arrival('ON_STAND'), departure('BOARDING')]).board(AT_MS);
    expect(board.arrivals[0]).toMatchObject({ flightId: 'EK1', turnaround: 'EK2' });
    expect(board.departures[0]).toMatchObject({ flightId: 'EK2', turnaround: 'EK1' });
  });

  it('orders by when each flight moves, not by schedule (late inbound)', () => {
    // The departure was scheduled before its own arrival; the delay moved its estimate.
    const lateArrival = stored(flight({ flightId: 'EK1', callsign: 'EK1', status: 'APPROACH', scheduled: '2026-10-13T11:50:00.000Z', estimated: '2026-10-13T12:05:00.000Z' }), VERSION_TS);
    const departure = stored(flight({ flightId: 'EK2', callsign: 'EK2', kind: 'DEP', status: 'SCHEDULED', scheduled: '2026-10-13T11:40:00.000Z', estimated: '2026-10-13T12:30:00.000Z' }), VERSION_TS);
    const state = replay([lateArrival, departure], [lastHeard('2026-10-13T11:59:58.000Z', {})]);
    expect(state.board(AT_MS).arrivals[0].turnaround).toBe('EK2');
    expect(state.mapView(AT_MS).aircraft[0]).toMatchObject({ callsign: 'EK1', kind: 'ARR' });
  });

  it('leaves a flight without its other half on the board unlinked', () => {
    const board = replay([departure('SCHEDULED')]).board(AT_MS);
    expect(board.departures[0].turnaround).toBeNull();
  });

  it('drops an aircraft that went silent in the air', () => {
    const state = replay(
      [departure('DEPARTED')],
      [lastHeard('2026-10-13T11:57:00.000Z', { onGround: false, gs: 220 })],
    );
    expect(state.mapView(AT_MS).aircraft).toEqual([]);
  });
});
