import { describe, expect, it } from 'vitest';
import { applyMessage } from '../src/domain/apply';
import { standUsePerHour } from '../src/domain/occupancy';
import { AirportState } from '../src/domain/state';
import type { FlightRecord, FlightStatus, StandOccupancy } from '../src/domain/types';
import { flight, hello, position } from './fixtures';

/** `HH:MM` on the fixtures' day, as ISO. */
const at = (hhmm: string) => `2026-10-13T${hhmm}:00.000Z`;

/** One aircraft's turnaround on A3: arrival EK1 (scheduled 12:00), then departure EK2. */
const arrival = (status: FlightStatus, overrides: Partial<FlightRecord> = {}) =>
  flight({ flightId: 'EK1', callsign: 'EK1', kind: 'ARR', status, stand: 'A3', ...overrides });
const departure = (status: FlightStatus) =>
  flight({
    flightId: 'EK2',
    callsign: 'EK2',
    kind: 'DEP',
    status,
    stand: 'A3',
    scheduled: at('12:40'),
    estimated: at('12:40'),
  });

function started(): AirportState {
  const state = new AirportState();
  applyMessage(state, hello('ALX'), 'ALX');
  return state;
}

const snapshot = (state: AirportState, ts: string, flights: FlightRecord[]) =>
  applyMessage(state, { type: 'snapshot', seq: 2, ts, flights }, 'ALX');
const update = (state: AirportState, ts: string, record: FlightRecord) =>
  applyMessage(state, { type: 'flight', seq: 3, ts, ...record }, 'ALX');
/** Any message stamped `ts`: here, another aircraft's position. */
const heard = (state: AirportState, ts: string, icao24: string) =>
  applyMessage(state, { type: 'position', seq: 4, ts, ...position({ icao24 }) }, 'ALX');

describe('on-time performance', () => {
  it('records each landing with the time it was scheduled', () => {
    const state = started();
    snapshot(state, at('11:50'), [arrival('APPROACH')]);
    const landed = update(state, at('12:20'), arrival('LANDED', { actual: at('12:20') }));
    expect(landed.movements).toEqual([
      expect.objectContaining({ kind: 'land', ts: at('12:20'), scheduled: at('12:00') }),
    ]);
  });
});

describe('stand occupancy', () => {
  it('runs from on-block to the departure starting pushback', () => {
    const state = started();
    snapshot(state, at('12:00'), [arrival('APPROACH'), departure('SCHEDULED')]);

    const landed = update(state, at('12:01'), arrival('LANDED', { actual: at('12:01') }));
    expect(landed.occupancies).toEqual([]);

    const onBlock = update(state, at('12:03'), arrival('ON_STAND', { actual: at('12:01') }));
    expect(onBlock.occupancies).toEqual([
      { flightId: 'EK1', stand: 'A3', from: at('12:03'), to: null },
    ]);

    // A reconnect's snapshot repeats the picture: nothing changes.
    const again = snapshot(state, at('12:04'), [
      arrival('ON_STAND', { actual: at('12:01') }),
      departure('SCHEDULED'),
    ]);
    expect(again.occupancies).toEqual([]);
    expect(update(state, at('12:08'), departure('BOARDING')).occupancies).toEqual([]);

    const offBlock = update(state, at('12:10'), departure('PUSHBACK'));
    expect(offBlock.occupancies).toEqual([
      { flightId: 'EK1', stand: 'A3', from: at('12:03'), to: at('12:10') },
    ]);
    expect(state.onStand.size).toBe(0);
  });

  it('ends a stay that ended during a gap in the feed, however long, when the feed was last heard', () => {
    const state = started();
    snapshot(state, at('12:00'), [arrival('ON_STAND'), departure('BOARDING')]);
    heard(state, at('12:02'), 'other');
    heard(state, at('12:01'), 'late'); // delivered late: the feed was still last heard at 12:02
    // Reconnected two hours on: the aircraft has left meanwhile, nobody saw when.
    const after = snapshot(state, at('14:00'), [
      arrival('ON_STAND'),
      departure('DEPARTED'),
    ]);
    expect(after.occupancies).toEqual([
      { flightId: 'EK1', stand: 'A3', from: at('12:00'), to: at('12:02') },
    ]);
  });
});

describe('stand utilisation per hour', () => {
  const stay = (stand: string, from: string, to: string | null): StandOccupancy => ({
    flightId: `${stand}@${from}`,
    stand,
    from: at(from),
    to: to && at(to),
  });

  it('splits a stay across the hours it spans', () => {
    expect(standUsePerHour([stay('A1', '12:50', '13:10')], at('12:00'), at('14:00'))).toEqual([
      { hour: at('12:00'), minutes: { A1: 10 } },
      { hour: at('13:00'), minutes: { A1: 10 } },
    ]);
  });

  it('counts an aircraft still on its stand up to the instant asked about', () => {
    expect(standUsePerHour([stay('A2', '13:20', null)], at('13:00'), at('13:30'))).toEqual([
      { hour: at('13:00'), minutes: { A2: 10 } },
    ]);
  });

  it('counts only what falls inside the window', () => {
    // Replay at 12:30: a stay that ended later is cut at the cursor.
    expect(
      standUsePerHour(
        [stay('A1', '11:30', '12:15'), stay('A2', '12:00', '12:40')],
        at('12:00'),
        at('12:30'),
      ),
    ).toEqual([{ hour: at('12:00'), minutes: { A1: 15, A2: 30 } }]);
  });

  it('counts a stand once while two aircraft are on it (a stand conflict)', () => {
    const conflict = [stay('A3', '12:00', '12:20'), stay('A3', '12:10', '12:30')];
    expect(standUsePerHour(conflict, at('12:00'), at('13:00'))).toEqual([
      { hour: at('12:00'), minutes: { A3: 30 } },
    ]);
  });
});
