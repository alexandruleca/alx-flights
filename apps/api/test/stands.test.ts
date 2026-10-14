import { describe, expect, it } from 'vitest';
import { applyMessage } from '../src/domain/apply';
import { replayState } from '../src/domain/replay';
import { AirportState } from '../src/domain/state';
import { standConflicts } from '../src/domain/stands';
import type { FlightRecord, FlightStatus, StoredFlight } from '../src/domain/types';
import { flight, hello, stored } from './fixtures';

const T = '2026-10-13T12:00:00.000Z';

/** One aircraft's turnaround on `stand`: arrival `<id>A`, departure `<id>D`. */
function turnaround(
  id: string,
  stand: string,
  arrival: FlightStatus,
  departure: FlightStatus | null,
  landsAt = '2026-10-13T11:40:00.000Z',
): FlightRecord[] {
  const base = { icao24: id, stand, scheduled: landsAt, estimated: landsAt };
  const arrivalFlight = flight({ ...base, flightId: `${id}A`, callsign: `${id}A`, kind: 'ARR', status: arrival });
  if (!departure) return [arrivalFlight];
  const takesOff = new Date(Date.parse(landsAt) + 40 * 60_000).toISOString();
  return [
    arrivalFlight,
    flight({
      ...base,
      flightId: `${id}D`,
      callsign: `${id}D`,
      kind: 'DEP',
      status: departure,
      // A late inbound: the departure was scheduled before its own arrival.
      scheduled: '2026-10-13T11:00:00.000Z',
      estimated: takesOff,
    }),
  ];
}

const standAlerts = (alerts: { type: string }[]) => alerts.filter((a) => a.type === 'stand_conflict');

const conflictsOf = (...flights: FlightRecord[][]) =>
  standConflicts(flights.flat().map((f) => stored(f, T)));

describe('stand conflicts', () => {
  it('flags an arrival taxiing onto a stand whose aircraft is still boarding', () => {
    const [c] = conflictsOf(
      turnaround('OLD', 'A3', 'ON_STAND', 'BOARDING'),
      turnaround('NEW', 'A3', 'TAXI', 'SCHEDULED', '2026-10-13T11:55:00.000Z'),
    );
    expect(c).toMatchObject({ stand: 'A3' });
    expect(c.occupant.arrival.flightId).toBe('OLDA');
    expect(c.incoming.arrival.flightId).toBe('NEWA');
  });

  it('flags two aircraft on the same stand', () => {
    expect(
      conflictsOf(
        turnaround('OLD', 'A3', 'ON_STAND', null),
        turnaround('NEW', 'A3', 'ON_STAND', null, '2026-10-13T11:55:00.000Z'),
      ),
    ).toHaveLength(1);
  });

  it('accepts normal sequencing: the occupant is already pushing back', () => {
    expect(
      conflictsOf(turnaround('OLD', 'A3', 'ON_STAND', 'PUSHBACK'), turnaround('NEW', 'A3', 'TAXI', null)),
    ).toEqual([]);
  });

  it('waits for the landing: an arrival still on approach can be reassigned', () => {
    expect(
      conflictsOf(turnaround('OLD', 'A3', 'ON_STAND', 'BOARDING'), turnaround('NEW', 'A3', 'APPROACH', null)),
    ).toEqual([]);
  });

  it('is not a conflict for an aircraft and its own departure', () => {
    expect(conflictsOf(turnaround('OLD', 'A3', 'ON_STAND', 'BOARDING'))).toEqual([]);
  });
});

describe('stand conflict alert', () => {
  it('is raised when the arrival lands and closed when the occupant pushes back', () => {
    const state = new AirportState();
    applyMessage(state, hello('ALX'), 'ALX');
    const [occupantArr, occupantDep] = turnaround('OLD', 'A3', 'ON_STAND', 'BOARDING');
    const [incoming] = turnaround('NEW', 'A3', 'APPROACH', null, '2026-10-13T11:55:00.000Z');
    applyMessage(state, { type: 'snapshot', seq: 2, ts: T, flights: [occupantArr, occupantDep, incoming] }, 'ALX');
    expect(standAlerts(state.activeAlerts())).toEqual([]);

    const update = (seq: number, record: FlightRecord) =>
      applyMessage(
        state,
        { type: 'flight', seq, ts: `2026-10-13T12:0${seq}:00.000Z`, ...record },
        'ALX',
      );

    const landed = update(3, { ...incoming, status: 'LANDED' });
    expect(standAlerts(landed.alerts)).toEqual([
      expect.objectContaining({
        subject: 'stand:A3',
        type: 'stand_conflict',
        flightId: 'NEWA',
        active: true,
        message: 'Stand A3: NEWA landed, OLDA (departing as OLDD, boarding) still there',
      }),
    ]);

    const pushback = update(4, { ...occupantDep, status: 'PUSHBACK' });
    expect(standAlerts(pushback.alerts)).toEqual([
      expect.objectContaining({ subject: 'stand:A3', active: false }),
    ]);
  });

  it('is re-derived in replay, with the involved rows flagged', () => {
    const state = replayState({
      link: null,
      flights: [
        ...turnaround('OLD', 'A3', 'ON_STAND', 'BOARDING'),
        ...turnaround('NEW', 'A3', 'TAXI', null, '2026-10-13T11:55:00.000Z'),
      ].map((f) => stored(f, T)),
      positions: [],
    });
    expect(standAlerts(state.activeAlerts())).toEqual([expect.objectContaining({ subject: 'stand:A3' })]);
    const rows = [...state.board(Date.parse(T)).arrivals, ...state.board(Date.parse(T)).departures];
    expect(rows.filter((r) => r.standConflict).map((r) => r.flightId).sort()).toEqual(['NEWA', 'OLDA', 'OLDD']);
  });
});
